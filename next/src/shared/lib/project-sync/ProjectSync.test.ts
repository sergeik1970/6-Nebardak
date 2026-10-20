import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/apiClient";
import type { ProjectDetail, ProjectsApi } from "@/services/projectsService";
import { saveProjectDraft } from "@/shared/lib/furniture-planner/project-draft";
import { readProjectDocument } from "@/shared/lib/project-scope/document";
import { DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY } from "@/shared/lib/project-scope/storage";
import {
    MemoryStorage,
    createFixtureDraft,
    fixtureDrawing,
} from "@/shared/lib/project-scope/test-fixtures";
import {
    KEEPALIVE_LIMIT_BYTES,
    ProjectSync,
    SAVE_DEBOUNCE_MS,
    SAVE_MAX_WAIT_MS,
    SAVE_TIMEOUT_MS,
    SYNC_META_KEY,
    type BroadcastLike,
} from "./ProjectSync";

const PROJECT_ID = "3f0c2a52-9a43-4c2b-8f3e-2b1d7c9e4a10";

const serverDocument = () => ({ ...createFixtureDraft(), version: 5, drawing: fixtureDrawing });

const detail = (revision: number, document: unknown = serverDocument()): ProjectDetail => ({
    id: PROJECT_ID,
    name: "Гостиная",
    summary: {},
    documentVersion: 5,
    revision,
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    document: document as Record<string, unknown>,
});

const makeApi = (revision = 3) => {
    let serverRevision = revision;
    const api = {
        get: vi.fn(async () => detail(serverRevision)),
        create: vi.fn(async () => ({ ...detail(1), id: "copy-id" })),
        saveDocument: vi.fn(
            async (
                _id: string,
                input: { baseRevision: number },
                _options?: { keepalive?: boolean; signal?: AbortSignal },
            ) => {
                if (input.baseRevision !== serverRevision) {
                    throw new ApiError(409, "conflict", { currentRevision: serverRevision });
                }
                serverRevision += 1;
                return { revision: serverRevision, updatedAt: "2026-10-20T10:01:00Z" };
            },
        ),
    };
    return {
        api,
        setServerRevision: (next: number) => {
            serverRevision = next;
        },
        get serverRevision() {
            return serverRevision;
        },
    };
};

/** Simulates a page editing the questionnaire (style label only, so the draft stays consistent). */
const editDraft = (sync: ProjectSync, count: 1 | 2 = 1, label = "Лофт") => {
    const draft = createFixtureDraft();
    const result = saveProjectDraft(
        {
            ...draft,
            questionnaire: {
                ...draft.questionnaire,
                meta: { styleKey: "loft", styleLabel: `${label}${count}` },
            },
        },
        { storage: sync.storage },
    );
    expect(result.status).toBe("success");
};

const loaded = async (options: { revision?: number; base?: MemoryStorage } = {}) => {
    const server = makeApi(options.revision);
    const base = options.base ?? new MemoryStorage();
    const sync = new ProjectSync({ projectId: PROJECT_ID, base, api: server.api });
    await sync.load();
    return { sync, base, server };
};

describe("ProjectSync", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("hydrates the local copy from the server and reports saved", async () => {
        const { sync, base } = await loaded();

        expect(sync.getState()).toMatchObject({ status: "saved", ready: true, name: "Гостиная" });
        expect(readProjectDocument(base)).toMatchObject({
            status: "success",
            value: { questionnaire: { meta: { styleLabel: "Прованс" } } },
        });
        expect(base.getItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY)).toContain("Спальня");
    });

    it("waits for a pause and saves many edits as one request on the known revision", async () => {
        const { sync, server } = await loaded();

        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(500);
        editDraft(sync, 2);
        expect(sync.getState().status).toBe("pending");
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        expect(server.api.saveDocument).toHaveBeenCalledTimes(1);
        const [, body] = server.api.saveDocument.mock.calls[0];
        expect(body).toMatchObject({
            baseRevision: 3,
            document: { version: 5, questionnaire: { meta: { styleLabel: "Лофт2" } } },
            summary: { styleLabel: "Лофт2", furnitureCount: 2 },
        });
        expect(sync.getState()).toMatchObject({ status: "saved" });
        expect(JSON.parse(sync.storage.getItem(SYNC_META_KEY)!)).toMatchObject({
            revision: 4,
            dirty: false,
        });
    });

    it("does not let continuous editing postpone saving forever", async () => {
        const { sync, server } = await loaded();

        for (let elapsed = 0; elapsed <= SAVE_MAX_WAIT_MS + 1_000; elapsed += 1_000) {
            editDraft(sync, (elapsed / 1_000) % 2 === 0 ? 1 : 2, `Лофт${elapsed}`);
            await vi.advanceTimersByTimeAsync(1_000);
        }

        expect(server.api.saveDocument).toHaveBeenCalled();
    });

    it("skips the request when only the timestamp changed", async () => {
        const { sync, server } = await loaded();

        saveProjectDraft(
            { ...createFixtureDraft(), updatedAt: 1_800_000_000_000 },
            {
                storage: sync.storage,
            },
        );
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        expect(server.api.saveDocument).not.toHaveBeenCalled();
        expect(sync.getState().status).toBe("saved");
    });

    it("saves again when the page kept editing during a request", async () => {
        const { sync, server } = await loaded();
        let release: () => void = () => undefined;
        server.api.saveDocument.mockImplementationOnce(
            (_id, input) =>
                new Promise((resolve) => {
                    release = () => resolve({ revision: input.baseRevision + 1, updatedAt: "" });
                }),
        );
        server.setServerRevision(3);

        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        editDraft(sync, 2);
        server.setServerRevision(4);
        release();
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);

        expect(server.api.saveDocument).toHaveBeenCalledTimes(2);
        expect(server.api.saveDocument.mock.calls[1][1]).toMatchObject({
            baseRevision: 4,
            document: { questionnaire: { meta: { styleLabel: "Лофт2" } } },
        });
    });

    it("stops on a revision conflict and keeps the local edits", async () => {
        const { sync, server } = await loaded();
        server.setServerRevision(7);

        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        expect(sync.getState().status).toBe("conflict");

        editDraft(sync, 2);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
        expect(server.api.saveDocument).toHaveBeenCalledTimes(1);
        expect(readProjectDocument(sync.storage)).toMatchObject({
            value: { questionnaire: { meta: { styleLabel: "Лофт2" } } },
        });
    });

    it("resolves a conflict by keeping this device's version", async () => {
        const { sync, server } = await loaded();
        server.setServerRevision(7);
        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        await expect(sync.resolveConflict("mine")).resolves.toEqual({ reload: false });

        expect(server.api.saveDocument).toHaveBeenLastCalledWith(
            PROJECT_ID,
            expect.objectContaining({ baseRevision: 7 }),
            expect.anything(),
        );
        expect(sync.getState().status).toBe("saved");
    });

    it("resolves a conflict by taking the server version", async () => {
        const { sync, server } = await loaded();
        server.setServerRevision(7);
        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        await expect(sync.resolveConflict("theirs")).resolves.toEqual({
            reload: true,
            copyProjectId: undefined,
        });

        expect(readProjectDocument(sync.storage)).toMatchObject({
            value: { questionnaire: { meta: { styleLabel: "Прованс" } } },
        });
        editDraft(sync, 2);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        expect(server.api.saveDocument).toHaveBeenLastCalledWith(
            PROJECT_ID,
            expect.objectContaining({ baseRevision: 7 }),
            expect.anything(),
        );
    });

    it("resolves a conflict by saving this version as a new project", async () => {
        const { sync, server } = await loaded();
        server.setServerRevision(7);
        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        await expect(sync.resolveConflict("copy")).resolves.toEqual({
            reload: true,
            copyProjectId: "copy-id",
        });

        expect(server.api.create).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Гостиная (моя версия)",
                document: expect.objectContaining({
                    questionnaire: expect.objectContaining({
                        meta: { styleKey: "loft", styleLabel: "Лофт1" },
                    }),
                }),
            }),
        );
        expect(readProjectDocument(sync.storage)).toMatchObject({
            value: { questionnaire: { meta: { styleLabel: "Прованс" } } },
        });
    });

    it("goes offline on network failure, keeps the edit and retries with back-off", async () => {
        const { sync, server } = await loaded();
        server.api.saveDocument
            .mockRejectedValueOnce(new ApiError(0, "offline"))
            .mockRejectedValueOnce(new ApiError(503, "unavailable"));

        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        expect(sync.getState().status).toBe("offline");

        await vi.advanceTimersByTimeAsync(2_000);
        expect(server.api.saveDocument).toHaveBeenCalledTimes(2);
        expect(sync.getState().status).toBe("offline");

        await vi.advanceTimersByTimeAsync(4_000);
        expect(server.api.saveDocument).toHaveBeenCalledTimes(3);
        expect(sync.getState().status).toBe("saved");
    });

    it("pauses on an expired session and resumes after signing in", async () => {
        const { sync, server } = await loaded();
        server.api.saveDocument.mockRejectedValueOnce(new ApiError(401, "Требуется вход"));

        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        expect(sync.getState().status).toBe("auth");

        editDraft(sync, 2);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        expect(server.api.saveDocument).toHaveBeenCalledTimes(1);

        sync.resume();
        await vi.advanceTimersByTimeAsync(0);
        expect(server.api.saveDocument).toHaveBeenCalledTimes(2);
        expect(sync.getState().status).toBe("saved");
    });

    it("pushes edits left unsaved by a closed tab on the same revision", async () => {
        const base = new MemoryStorage();
        const first = await loaded({ base });
        first.server.api.saveDocument.mockRejectedValue(new ApiError(0, "offline"));
        editDraft(first.sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        first.sync.dispose();

        const second = await loaded({ base });

        await vi.advanceTimersByTimeAsync(0);
        expect(second.server.api.saveDocument).toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({ baseRevision: 3 }),
            expect.anything(),
        );
        expect(readProjectDocument(base)).toMatchObject({
            value: { questionnaire: { meta: { styleLabel: "Лофт1" } } },
        });
    });

    it("reports a conflict instead of overwriting when the server moved on meanwhile", async () => {
        const base = new MemoryStorage();
        const first = await loaded({ base });
        first.server.api.saveDocument.mockRejectedValue(new ApiError(0, "offline"));
        editDraft(first.sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        first.sync.dispose();

        const second = await loaded({ base, revision: 9 });

        expect(second.sync.getState().status).toBe("conflict");
        expect(second.server.api.saveDocument).not.toHaveBeenCalled();
        expect(readProjectDocument(base)).toMatchObject({
            value: { questionnaire: { meta: { styleLabel: "Лофт1" } } },
        });
    });

    it("opens the cached copy offline but refuses without one", async () => {
        const base = new MemoryStorage();
        (await loaded({ base })).sync.dispose();

        const offlineApi = makeApi();
        offlineApi.api.get.mockRejectedValue(new ApiError(0, "offline"));
        const cached = new ProjectSync({ projectId: PROJECT_ID, base, api: offlineApi.api });
        await cached.load();
        expect(cached.getState()).toMatchObject({ ready: true, status: "offline" });

        const empty = new ProjectSync({
            projectId: PROJECT_ID,
            base: new MemoryStorage(),
            api: offlineApi.api,
        });
        await empty.load();
        expect(empty.getState()).toMatchObject({ ready: false, status: "error" });
    });

    it("never shows another user's or a deleted project", async () => {
        const server = makeApi();
        server.api.get.mockRejectedValue(new ApiError(404, "Проект не найден"));
        const sync = new ProjectSync({
            projectId: PROJECT_ID,
            base: new MemoryStorage(),
            api: server.api,
        });

        await sync.load();

        expect(sync.getState()).toMatchObject({ ready: false, status: "not-found" });
    });

    it("notices a newer save from another tab of this browser", async () => {
        let deliver: (data: unknown) => void = () => undefined;
        const broadcast: BroadcastLike = {
            postMessage: vi.fn(),
            addEventListener: (_type, listener) => {
                deliver = (data) => listener({ data });
            },
            close: vi.fn(),
        };
        const server = makeApi();
        const sync = new ProjectSync({
            projectId: PROJECT_ID,
            base: new MemoryStorage(),
            api: server.api,
            broadcast,
        });
        await sync.load();

        deliver({ type: "saved", projectId: "other", revision: 99 });
        expect(sync.getState().updatedElsewhere).toBe(false);
        deliver({ type: "saved", projectId: PROJECT_ID, revision: 4 });
        expect(sync.getState().updatedElsewhere).toBe(true);
    });

    it("uses keepalive on page exit only for bodies the browser will accept", async () => {
        const { sync, server } = await loaded();

        editDraft(sync, 1);
        await sync.flush({ keepalive: true });
        expect(server.api.saveDocument.mock.calls[0][2]).toMatchObject({ keepalive: true });

        const longWall = Array.from({ length: 1_000 }, (_, index) => ({
            id: `segment-${index}`,
            start: { x: index * 10, y: 0 },
            end: { x: index * 10 + 10, y: 0 },
        }));
        sync.storage.setItem(
            DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY,
            JSON.stringify({ ...fixtureDrawing, segments: longWall }),
        );
        await sync.flush({ keepalive: true });

        const body = JSON.stringify(server.api.saveDocument.mock.calls[1][1]);
        expect(body.length).toBeGreaterThan(KEEPALIVE_LIMIT_BYTES);
        expect(server.api.saveDocument.mock.calls[1][2]).toMatchObject({ keepalive: false });
    });

    it("treats a re-written document with reordered keys as unchanged", async () => {
        const { sync, server } = await loaded();
        const stored = JSON.parse(sync.storage.getItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY)!);
        const reordered = Object.fromEntries(Object.entries(stored).reverse());

        sync.storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(reordered));
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        expect(server.api.saveDocument).not.toHaveBeenCalled();
        expect(sync.getState().status).toBe("saved");
    });

    it("gives up on a hung request and retries instead of saving forever", async () => {
        const { sync, server } = await loaded();
        server.api.saveDocument.mockImplementationOnce(
            (_id, _input, options) =>
                new Promise((_resolve, reject) => {
                    options?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError")),
                    );
                }),
        );

        editDraft(sync, 1);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + SAVE_TIMEOUT_MS);
        expect(sync.getState().status).toBe("offline");

        await vi.advanceTimersByTimeAsync(2_000);
        expect(sync.getState().status).toBe("saved");
    });

    it("accepts its own unload save instead of reporting a conflict", async () => {
        const base = new MemoryStorage();
        const first = await loaded({ base });
        editDraft(first.sync, 1);
        // The page unloads: its keepalive save reaches the server, but no code
        // is left to record the new revision locally.
        const document = readProjectDocument(base);
        first.sync.dispose();

        const server = makeApi(4);
        server.api.get.mockResolvedValue(
            detail(4, document.status === "success" ? document.value : null),
        );
        const second = new ProjectSync({ projectId: PROJECT_ID, base, api: server.api });
        await second.load();

        expect(second.getState().status).toBe("saved");
        editDraft(second, 2);
        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
        expect(server.api.saveDocument).toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({ baseRevision: 4 }),
            expect.anything(),
        );
    });

    it("treats a 409 for identical content as already saved", async () => {
        const { sync, server } = await loaded();
        editDraft(sync, 1);
        const local = readProjectDocument(sync.storage);
        server.setServerRevision(8);
        server.api.get.mockResolvedValueOnce(
            detail(8, local.status === "success" ? local.value : null),
        );

        await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

        expect(sync.getState().status).toBe("saved");
    });
});
