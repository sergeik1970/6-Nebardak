import type { ProjectDetail, ProjectsApi } from "@/services/projectsService";
import { STYLEFINDER_DRAW_ROOM_DRAFT_STORAGE_KEY } from "@/shared/lib/furniture-planner/draw-room-draft";
import { resetProjectDraft } from "@/shared/lib/furniture-planner/project-draft";
import {
    isEmptyProjectDocument,
    readProjectDocument,
    summarizeProjectDocument,
    type ProjectDocument,
} from "@/shared/lib/project-scope/document";
import {
    DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY,
    getGuestStorage,
    type KeyValueStorage,
} from "@/shared/lib/project-scope/storage";

/** Idempotency key of the guest draft, so a retried import never duplicates it. */
export const GUEST_IMPORT_ID_KEY = "stylefinder:guest-import-id:v1";

const createImportId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** The guest's work worth keeping, or null when there is nothing to import. */
export const readGuestDocument = (
    storage: KeyValueStorage | null = getGuestStorage(),
): ProjectDocument | null => {
    const result = readProjectDocument(storage);
    return result.status === "success" && !isEmptyProjectDocument(result.value)
        ? result.value
        : null;
};

/** Removes the guest draft, its room drawing and the planner hand-off. */
export const discardGuestDraft = (storage: KeyValueStorage | null = getGuestStorage()): void => {
    if (!storage) return;
    resetProjectDraft({ storage });
    try {
        storage.removeItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY);
        storage.removeItem(STYLEFINDER_DRAW_ROOM_DRAFT_STORAGE_KEY);
        storage.removeItem(GUEST_IMPORT_ID_KEY);
    } catch {
        // Nothing to clean in a blocked store.
    }
};

/**
 * Saves the guest draft as a new cloud project and clears it locally. Safe to
 * retry after a dropped response: the server returns the project it already
 * created for the same import key.
 */
export const importGuestDraft = async (
    api: Pick<ProjectsApi, "create">,
    storage: KeyValueStorage | null = getGuestStorage(),
): Promise<ProjectDetail | null> => {
    const document = readGuestDocument(storage);
    if (!storage || !document) return null;

    let importId = storage.getItem(GUEST_IMPORT_ID_KEY);
    if (!importId) {
        importId = createImportId();
        storage.setItem(GUEST_IMPORT_ID_KEY, importId);
    }

    const project = await api.create({
        document,
        summary: summarizeProjectDocument(document),
        clientImportId: importId,
    });
    discardGuestDraft(storage);
    return project;
};
