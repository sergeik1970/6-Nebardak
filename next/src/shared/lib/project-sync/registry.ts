import { projectsService } from "@/services/projectsService";
import {
    PROJECT_STORAGE_PREFIX,
    createNamespacedStorage,
    getGuestStorage,
    projectStorageNamespace,
} from "@/shared/lib/project-scope/storage";
import { ProjectSync, type BroadcastLike } from "./ProjectSync";

/**
 * One engine per open project, kept across the steps of the flow so moving
 * from the questionnaire to the planner neither reloads the project nor races
 * a save that is still in flight.
 */
let current: ProjectSync | null = null;
let windowListenersInstalled = false;

const createBroadcast = (): BroadcastLike | null =>
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("stylefinder-projects");

const installWindowListeners = () => {
    if (windowListenersInstalled || typeof window === "undefined") return;
    windowListenersInstalled = true;
    window.addEventListener("online", () => current?.retryNow());
    // `pagehide` fires on reload, tab close and bfcache; keepalive lets the
    // last save finish after the page is gone.
    window.addEventListener("pagehide", () => void current?.flush({ keepalive: true }));
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void current?.flush({ keepalive: true });
    });
};

/** Returns the engine for `projectId`, closing the previous project's engine. */
export const getProjectSync = (projectId: string): ProjectSync | null => {
    if (current?.projectId === projectId) return current;
    const base = getGuestStorage();
    if (!base) return null;

    const previous = current;
    current = new ProjectSync({
        projectId,
        base: createNamespacedStorage(base, projectStorageNamespace(projectId)),
        api: projectsService,
        broadcast: createBroadcast(),
        online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    });
    if (previous) void previous.flush().finally(() => previous.dispose());
    installWindowListeners();
    return current;
};

export const getCurrentProjectSync = (): ProjectSync | null => current;

/** Saves whatever is pending before the session ends. */
export const flushProjectSync = async (): Promise<void> => {
    await current?.flush().catch(() => undefined);
};

const removeKeys = (prefix: string): void => {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    if (!storage) return;
    try {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(prefix)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
    } catch {
        // Blocked storage has nothing cached to remove.
    }
};

/** Drops the local copy of a project that was deleted from the account. */
export const forgetProjectCache = (projectId: string): void => {
    if (current?.projectId === projectId) {
        current.dispose();
        current = null;
    }
    removeKeys(projectStorageNamespace(projectId));
};

/**
 * Forgets every cached project on this device — on sign-out, so the next
 * person at a shared computer cannot open them from the local copy.
 */
export const purgeProjectCaches = (): void => {
    current?.dispose();
    current = null;
    removeKeys(PROJECT_STORAGE_PREFIX);
};
