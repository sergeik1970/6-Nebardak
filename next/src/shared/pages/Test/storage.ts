import {
    clearVisualTestSession,
    restoreVisualTestSession,
    type SessionStorageLike,
    type VisualTestSession,
} from "@/shared/lib/visual-preference";

interface RestoreVisualTestForTabInput {
    projectSession?: VisualTestSession;
    fallbackStorage: SessionStorageLike;
    saveProjectSession: (session: VisualTestSession) => { status: string };
}

/**
 * The tab-local fallback is written only after a project-draft write fails, so
 * it is the authoritative copy for that tab until migration succeeds.
 */
export const restoreVisualTestForTab = ({
    projectSession,
    fallbackStorage,
    saveProjectSession,
}: RestoreVisualTestForTabInput): VisualTestSession | undefined => {
    const fallback = restoreVisualTestSession(fallbackStorage);
    if (!fallback) return projectSession;

    const migrated = saveProjectSession(fallback);
    if (migrated.status === "success") clearVisualTestSession(fallbackStorage);
    return fallback;
};
