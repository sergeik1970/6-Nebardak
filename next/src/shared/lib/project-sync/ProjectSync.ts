import { ApiError } from "@/services/apiClient";
import type { ProjectsApi } from "@/services/projectsService";
import { STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY } from "@/shared/lib/furniture-planner/project-draft";
import {
    normalizeProjectDocument,
    readProjectDocument,
    summarizeProjectDocument,
    writeProjectDocument,
    type ProjectDocument,
} from "@/shared/lib/project-scope/document";
import {
    DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY,
    type KeyValueStorage,
} from "@/shared/lib/project-scope/storage";

/**
 * Keeps one cloud project in step with its local copy.
 *
 * The pages write the project's keys synchronously, as they always did; this
 * engine notices those writes, waits for a pause, assembles the document and
 * saves it with the revision it last saw. Local storage is the source of
 * truth on this device, so nothing is lost while offline or signed out; the
 * server revision decides whether another tab or device got there first.
 */
export type SyncStatus =
    | "loading"
    | "saved"
    | "pending"
    | "saving"
    | "offline"
    | "conflict"
    | "auth"
    | "error"
    | "not-found";

export interface SyncState {
    status: SyncStatus;
    /** Ready means the local copy can be shown (loaded or cached). */
    ready: boolean;
    name: string | null;
    lastSavedAt: number | null;
    /** Another tab of this browser saved a newer revision. */
    updatedElsewhere: boolean;
    message: string | null;
}

interface SyncMeta {
    revision: number;
    syncedHash: string | null;
    dirty: boolean;
}

export const SYNC_META_KEY = "stylefinder:project-sync:v1";
export const SAVE_DEBOUNCE_MS = 1_500;
export const SAVE_MAX_WAIT_MS = 10_000;
export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 60_000;
/** Browsers cap all in-flight keepalive bodies at 64 KB. */
export const KEEPALIVE_LIMIT_BYTES = 60_000;
/** A hung request (flaky network) must not freeze autosave in "saving". */
export const SAVE_TIMEOUT_MS = 20_000;

const DOCUMENT_KEYS = new Set([
    STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
    DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY,
]);

/** JSON with object keys sorted: PostgreSQL's jsonb and the pages order them differently. */
const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value)
            .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
            .sort()
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
            )
            .join(",")}}`;
    }
    return JSON.stringify(value);
};

/**
 * Content identity of a document. Ignores `updatedAt` (pages bump it even
 * when nothing changed) and key order, so merely opening a page that
 * re-writes the same state never creates a revision.
 */
export const hashProjectDocument = (document: ProjectDocument): string => {
    const { updatedAt: _ignored, ...content } = document;
    return canonicalJson(content);
};

export interface BroadcastLike {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    close(): void;
}

export interface ProjectSyncOptions {
    projectId: string;
    /** The project's namespaced local copy. */
    base: KeyValueStorage;
    api: ProjectsApi;
    broadcast?: BroadcastLike | null;
    now?: () => number;
    online?: () => boolean;
}

type Listener = (state: SyncState) => void;

const isNetworkFailure = (error: unknown) =>
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status === 429 ||
    error.status >= 500;

export class ProjectSync {
    readonly projectId: string;
    /** What the pages write through; changes to document keys schedule a save. */
    readonly storage: KeyValueStorage;

    private readonly base: KeyValueStorage;
    private readonly api: ProjectsApi;
    private readonly broadcast: BroadcastLike | null;
    private readonly now: () => number;
    private readonly online: () => boolean;
    private listeners = new Set<Listener>();
    private state: SyncState = {
        status: "loading",
        ready: false,
        name: null,
        lastSavedAt: null,
        updatedElsewhere: false,
        message: null,
    };
    /** The revision this tab is building on; deliberately not shared with other tabs. */
    private revision: number | null = null;
    private loadPromise: Promise<void> | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private retryAttempt = 0;
    private firstPendingChangeAt: number | null = null;
    private saving: Promise<void> | null = null;
    private changedDuringSave = false;
    private disposed = false;

    constructor(options: ProjectSyncOptions) {
        this.projectId = options.projectId;
        this.base = options.base;
        this.api = options.api;
        this.broadcast = options.broadcast ?? null;
        this.now = options.now ?? Date.now;
        this.online = options.online ?? (() => true);
        this.storage = {
            getItem: (key) => this.base.getItem(key),
            setItem: (key, value) => {
                this.base.setItem(key, value);
                if (DOCUMENT_KEYS.has(key)) this.notifyChange();
            },
            removeItem: (key) => {
                this.base.removeItem(key);
                if (DOCUMENT_KEYS.has(key)) this.notifyChange();
            },
        };
        this.broadcast?.addEventListener("message", (event) => this.onBroadcast(event.data));
    }

    getState(): SyncState {
        return this.state;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Loads once; later page mounts of the same project reuse the result. */
    load(): Promise<void> {
        if (!this.loadPromise) this.loadPromise = this.loadFromServer();
        return this.loadPromise;
    }

    /** Called for every write the pages make to the project's keys. */
    notifyChange(): void {
        if (this.disposed || !this.state.ready) return;
        const meta = this.readMeta();
        if (meta && !meta.dirty) this.writeMeta({ ...meta, dirty: true });
        if (this.saving) {
            this.changedDuringSave = true;
            return;
        }
        if (this.isBlocked()) return;

        const now = this.now();
        this.firstPendingChangeAt ??= now;
        this.setState({ status: "pending" });
        this.clearDebounce();
        const waitedTooLong = now - this.firstPendingChangeAt >= SAVE_MAX_WAIT_MS;
        this.debounceTimer = setTimeout(
            () => void this.save(),
            waitedTooLong ? 0 : SAVE_DEBOUNCE_MS,
        );
    }

    /** Saves now (e.g. before leaving the page). `keepalive` survives unload. */
    async flush(options: { keepalive?: boolean } = {}): Promise<void> {
        this.clearDebounce();
        if (this.saving) await this.saving;
        if (this.readMeta()?.dirty && !this.isBlocked()) await this.save(options);
    }

    /** Retries after signing in again, a network outage or a failed save. */
    resume(): void {
        if (["auth", "offline", "error"].includes(this.state.status)) {
            this.setState({ status: "pending", message: null });
            void this.save();
        }
    }

    /**
     * Resolves a revision conflict:
     * - `theirs` replaces the local copy with the server version;
     * - `mine` overwrites the server with this device's version;
     * - `copy` saves this device's version as a new project, then takes theirs here.
     */
    async resolveConflict(
        choice: "theirs" | "mine" | "copy",
    ): Promise<{ reload: boolean; copyProjectId?: string }> {
        const local = readProjectDocument(this.base);
        const server = await this.api.get(this.projectId);

        if (choice === "mine") {
            if (local.status !== "success") throw new Error("Локальная версия повреждена");
            this.revision = server.revision;
            this.setState({ status: "pending", message: null, updatedElsewhere: false });
            await this.save();
            return { reload: false };
        }

        let copyProjectId: string | undefined;
        if (choice === "copy") {
            if (local.status !== "success") throw new Error("Локальная версия повреждена");
            const copy = await this.api.create({
                name: `${server.name.slice(0, 64)} (моя версия)`,
                document: local.value,
                summary: summarizeProjectDocument(local.value),
            });
            copyProjectId = copy.id;
        }

        this.hydrate(server.document, server.revision);
        this.setState({ status: "saved", message: null, updatedElsewhere: false });
        return { reload: true, copyProjectId };
    }

    dispose(): void {
        this.disposed = true;
        this.clearDebounce();
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.broadcast?.close();
        this.listeners.clear();
    }

    private async loadFromServer(): Promise<void> {
        const meta = this.readMeta();
        try {
            const server = await this.api.get(this.projectId);
            this.setState({ name: server.name });
            const local = readProjectDocument(this.base);

            if (meta?.dirty && local.status === "success") {
                // Unsaved work from an earlier visit (crash, closed tab, offline).
                this.revision = meta.revision;
                if (meta.revision === server.revision) {
                    this.setState({ ready: true, status: "pending" });
                    void this.save();
                } else if (this.matchesServer(server.document, hashProjectDocument(local.value))) {
                    // Our own last save (sent while the previous page unloaded) landed.
                    this.adopt(server.revision, hashProjectDocument(local.value));
                    this.setState({ ready: true, status: "saved" });
                } else {
                    this.setState({
                        ready: true,
                        status: "conflict",
                        message:
                            "Пока изменения на этом устройстве ждали отправки, проект изменили в другом месте.",
                    });
                }
                return;
            }

            if (!this.hydrate(server.document, server.revision)) {
                this.setState({
                    ready: false,
                    status: "error",
                    message: "Проект на сервере повреждён или создан более новой версией сайта.",
                });
                return;
            }
            this.setState({ ready: true, status: "saved" });
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                this.setState({ status: "not-found", message: "Проект не найден" });
            } else if (error instanceof ApiError && error.status === 401) {
                this.setState({ status: "auth", message: "Войдите, чтобы открыть проект" });
            } else if (meta && readProjectDocument(this.base).status === "success") {
                // Offline with a cached copy: keep working, sync later.
                this.revision = meta.revision;
                this.setState({
                    ready: true,
                    status: "offline",
                    message: "Нет сети — работаем с копией на этом устройстве.",
                });
            } else {
                this.setState({
                    status: "error",
                    message: error instanceof Error ? error.message : "Не удалось открыть проект",
                });
            }
        }
    }

    /** Replaces the local copy with a server document; false if it is unusable. */
    private hydrate(document: unknown, revision: number): boolean {
        const written = writeProjectDocument(this.base, document);
        if (written.status !== "success") return false;
        const local = readProjectDocument(this.base);
        this.revision = revision;
        this.writeMeta({
            revision,
            syncedHash: local.status === "success" ? hashProjectDocument(local.value) : null,
            dirty: false,
        });
        return true;
    }

    private save(options: { keepalive?: boolean } = {}): Promise<void> {
        if (this.saving) {
            this.changedDuringSave = true;
            return this.saving;
        }
        this.saving = this.performSave(options).finally(() => {
            this.saving = null;
            if (this.changedDuringSave && !this.disposed && !this.isBlocked()) {
                this.changedDuringSave = false;
                this.notifyChange();
            }
        });
        return this.saving;
    }

    private async performSave(options: { keepalive?: boolean }): Promise<void> {
        this.clearDebounce();
        this.changedDuringSave = false;
        const meta = this.readMeta();
        const local = readProjectDocument(this.base);
        if (local.status !== "success" || this.revision === null) {
            this.setState({
                status: "error",
                message: "Не удалось прочитать проект на этом устройстве.",
            });
            return;
        }

        const hash = hashProjectDocument(local.value);
        if (meta?.syncedHash === hash) {
            this.writeMeta({ revision: this.revision, syncedHash: hash, dirty: false });
            this.firstPendingChangeAt = null;
            this.setState({ status: "saved", message: null });
            return;
        }

        const body = {
            document: local.value,
            baseRevision: this.revision,
            summary: summarizeProjectDocument(local.value),
        };
        const keepalive = options.keepalive && JSON.stringify(body).length <= KEEPALIVE_LIMIT_BYTES;

        this.setState({ status: "saving" });
        const controller = typeof AbortController === "undefined" ? null : new AbortController();
        const timeout = controller ? setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS) : null;
        try {
            const saved = await this.api.saveDocument(this.projectId, body, {
                keepalive,
                signal: controller?.signal,
            });
            this.revision = saved.revision;
            this.retryAttempt = 0;
            this.firstPendingChangeAt = null;
            this.writeMeta({ revision: saved.revision, syncedHash: hash, dirty: false });
            this.broadcast?.postMessage({
                type: "saved",
                projectId: this.projectId,
                revision: saved.revision,
            });
            this.setState({
                status: "saved",
                message: null,
                lastSavedAt: this.now(),
            });
        } catch (error) {
            if (
                error instanceof ApiError &&
                error.status === 409 &&
                (await this.sameAsServer(hash))
            ) {
                this.setState({ status: "saved", message: null, lastSavedAt: this.now() });
                return;
            }
            this.handleSaveError(error);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    private handleSaveError(error: unknown): void {
        if (error instanceof ApiError && error.status === 409) {
            this.setState({
                status: "conflict",
                message: "Проект изменили в другой вкладке или на другом устройстве.",
            });
        } else if (error instanceof ApiError && error.status === 401) {
            this.setState({
                status: "auth",
                message:
                    "Сессия закончилась. Изменения сохранены на этом устройстве — войдите снова.",
            });
        } else if (error instanceof ApiError && error.status === 404) {
            this.setState({ status: "not-found", message: "Проект удалён" });
        } else if (isNetworkFailure(error)) {
            this.setState({
                status: "offline",
                message: "Нет сети — изменения сохранены на этом устройстве.",
            });
            this.scheduleRetry();
        } else {
            this.setState({
                status: "error",
                message: error instanceof Error ? error.message : "Не удалось сохранить проект",
            });
        }
    }

    /** True when the server already holds exactly this content. */
    private matchesServer(document: unknown, hash: string): boolean {
        const normalized = normalizeProjectDocument(document);
        return normalized.status === "success" && hashProjectDocument(normalized.value) === hash;
    }

    private adopt(revision: number, hash: string): void {
        this.revision = revision;
        this.retryAttempt = 0;
        this.firstPendingChangeAt = null;
        this.writeMeta({ revision, syncedHash: hash, dirty: false });
    }

    /**
     * A 409 is only a real conflict if the content differs: another tab may
     * have saved the very same state (it shares this browser's storage).
     */
    private async sameAsServer(hash: string): Promise<boolean> {
        try {
            const server = await this.api.get(this.projectId);
            if (!this.matchesServer(server.document, hash)) return false;
            this.adopt(server.revision, hash);
            return true;
        } catch {
            return false;
        }
    }

    private scheduleRetry(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        const delay = Math.min(RETRY_BASE_MS * 2 ** this.retryAttempt, RETRY_MAX_MS);
        this.retryAttempt += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.state.status === "offline") void this.save();
        }, delay);
    }

    /** Called by the scope when the browser reports it is back online. */
    retryNow(): void {
        if (this.state.status !== "offline" || !this.online()) return;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        void this.save();
    }

    private onBroadcast(data: unknown): void {
        if (
            typeof data !== "object" ||
            data === null ||
            (data as { type?: unknown }).type !== "saved" ||
            (data as { projectId?: unknown }).projectId !== this.projectId
        ) {
            return;
        }
        const revision = (data as { revision?: unknown }).revision;
        if (typeof revision === "number" && this.revision !== null && revision > this.revision) {
            this.setState({ updatedElsewhere: true });
        }
    }

    private isBlocked(): boolean {
        return ["conflict", "auth", "not-found", "loading"].includes(this.state.status);
    }

    private clearDebounce(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
    }

    private readMeta(): SyncMeta | null {
        try {
            const parsed = JSON.parse(
                this.base.getItem(SYNC_META_KEY) ?? "null",
            ) as SyncMeta | null;
            return parsed && typeof parsed.revision === "number" ? parsed : null;
        } catch {
            return null;
        }
    }

    private writeMeta(meta: SyncMeta): void {
        try {
            this.base.setItem(SYNC_META_KEY, JSON.stringify(meta));
        } catch {
            // A full or blocked store only loses crash recovery, not the save itself.
        }
    }

    private setState(patch: Partial<SyncState>): void {
        if (this.disposed) return;
        this.state = { ...this.state, ...patch };
        this.listeners.forEach((listener) => listener(this.state));
    }
}
