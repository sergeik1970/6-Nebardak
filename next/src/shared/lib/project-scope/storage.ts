/**
 * Where the planner pages keep their state.
 *
 * Every page (test, questionnaire, room editor, planner) reads and writes a
 * small synchronous key-value store. A guest uses plain `localStorage`, exactly
 * as before accounts existed. A saved project gets the same keys under its own
 * prefix, so several projects can live side by side in one browser and the
 * pages never need to know which one they are editing.
 */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export const PROJECT_STORAGE_PREFIX = "stylefinder:project:";

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Only server-issued v4 UUIDs select a project scope; anything else is a guest. */
export const parseProjectId = (value: unknown): string | null => {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate !== "string") return null;
    const normalized = candidate.trim().toLowerCase();
    return PROJECT_ID_PATTERN.test(normalized) ? normalized : null;
};

export const projectStorageNamespace = (projectId: string): string =>
    `${PROJECT_STORAGE_PREFIX}${projectId}:`;

export const createNamespacedStorage = (
    base: KeyValueStorage,
    namespace: string,
): KeyValueStorage => ({
    getItem: (key) => base.getItem(namespace + key),
    setItem: (key, value) => base.setItem(namespace + key, value),
    removeItem: (key) => base.removeItem(namespace + key),
});

const browserLocalStorage = (): KeyValueStorage | null => {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        // Privacy modes can throw on access; callers treat null as "unavailable".
        return null;
    }
};

/** The guest draft, regardless of which project is open (e.g. to import it). */
export const getGuestStorage = (): KeyValueStorage | null => browserLocalStorage();

/** Room-editor scene; part of the project document, not just a hand-off. */
export const DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY = "stylefinder:draw-room-editor:v1";

interface ActiveScope {
    projectId: string | null;
    storage: KeyValueStorage | null;
}

let activeScope: ActiveScope | null = null;

const storageListeners = new Set<() => void>();
const observedStores = new WeakMap<KeyValueStorage, KeyValueStorage>();

const notifyStorageListeners = () => storageListeners.forEach((listener) => listener());

/** Passes every call through and tells subscribers that the project changed. */
const observe = (storage: KeyValueStorage | null): KeyValueStorage | null => {
    if (!storage) return null;
    let observed = observedStores.get(storage);
    if (!observed) {
        observed = {
            getItem: (key) => storage.getItem(key),
            setItem: (key, value) => {
                storage.setItem(key, value);
                notifyStorageListeners();
            },
            removeItem: (key) => {
                storage.removeItem(key);
                notifyStorageListeners();
            },
        };
        observedStores.set(storage, observed);
    }
    return observed;
};

/**
 * The store for the project currently on screen. Without an explicit scope
 * (tests, pages outside the project flow) it is the guest store.
 */
export const getProjectStorage = (): KeyValueStorage | null =>
    observe(activeScope ? activeScope.storage : browserLocalStorage());

/** Called after any page writes to the project through `getProjectStorage()`. */
export const subscribeProjectStorage = (listener: () => void): (() => void) => {
    storageListeners.add(listener);
    return () => {
        storageListeners.delete(listener);
    };
};

export const getActiveProjectId = (): string | null => activeScope?.projectId ?? null;

/** Selects the scope; `null` returns to the guest store. Idempotent. */
export const activateProjectScope = (
    projectId: string | null,
    storage?: KeyValueStorage | null,
): void => {
    if (projectId === null && storage === undefined) {
        activeScope = null;
        return;
    }
    const base = browserLocalStorage();
    activeScope = {
        projectId,
        storage:
            storage !== undefined
                ? storage
                : projectId && base
                  ? createNamespacedStorage(base, projectStorageNamespace(projectId))
                  : base,
    };
};

/** Adds `?project=` to an in-app link while a saved project is open. */
export const withProjectParam = (
    href: string,
    projectId: string | null = getActiveProjectId(),
): string => {
    if (!projectId) return href;
    const [pathAndQuery, hash = ""] = href.split("#", 2);
    const [path, query = ""] = pathAndQuery.split("?", 2);
    const params = new URLSearchParams(query);
    params.set("project", projectId);
    return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
};

/** Same as `withProjectParam`, for Next.js `{ pathname, query }` links. */
export const withProjectQuery = <T extends Record<string, string | string[] | undefined>>(
    query: T,
    projectId: string | null = getActiveProjectId(),
): T & { project?: string } => (projectId ? { ...query, project: projectId } : query);
