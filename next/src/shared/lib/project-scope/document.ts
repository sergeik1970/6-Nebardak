import {
    createProjectDraft,
    normalizeProjectDraft,
    readProjectDraft,
    saveProjectDraft,
    type StyleFinderProjectDraft,
} from "@/shared/lib/furniture-planner/project-draft";
import { getRoomArea } from "@/shared/lib/furniture-planner/room-geometry";
import {
    parseDrawingProject,
    serializeDrawingProject,
    type DrawingProjectScene,
} from "@/shared/pages/DrawRoom/project-file";
import { DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, type KeyValueStorage } from "./storage";

/**
 * The whole project as one JSON document — what the account stores.
 *
 * Locally the pages still keep their familiar keys (the v4 draft and the
 * room-editor scene); this module converts between those keys and the single
 * document, so the server never has to understand either format.
 */
export const PROJECT_DOCUMENT_VERSION = 5 as const;

export interface ProjectDocument extends Omit<StyleFinderProjectDraft, "version"> {
    version: typeof PROJECT_DOCUMENT_VERSION;
    /** The room editor's wall graph, openings and room names. */
    drawing?: DrawingProjectScene;
}

export type ProjectStage = "style" | "questionnaire" | "room" | "layout";

/** Mirrors the API's summary DTO: light facts for the project list. */
export interface ProjectSummary {
    styleLabel?: string;
    areaM2?: number;
    furnitureCount?: number;
    stage?: ProjectStage;
}

export type ProjectDocumentResult =
    | { status: "success"; value: ProjectDocument }
    | { status: "invalid"; reason: string };

export type ProjectDocumentReadResult =
    | ProjectDocumentResult
    | { status: "empty" }
    | { status: "unavailable" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Uses the same validator as drawing files, so a bad scene is never stored. */
const normalizeDrawing = (input: unknown): DrawingProjectScene | null => {
    if (!isRecord(input)) return null;
    try {
        return parseDrawingProject(
            serializeDrawingProject(input as unknown as DrawingProjectScene),
        );
    } catch {
        return null;
    }
};

const hasDrawingContent = (drawing: DrawingProjectScene | undefined): boolean =>
    Boolean(
        drawing &&
            (drawing.segments.length ||
                drawing.doors.length ||
                drawing.windows.length ||
                (drawing.furniture?.length ?? 0)),
    );

/** Accepts a v5 document or any older draft the planner can migrate. */
export const normalizeProjectDocument = (input: unknown): ProjectDocumentResult => {
    if (!isRecord(input)) return { status: "invalid", reason: "invalid-payload" };

    const { drawing: rawDrawing, version, ...rest } = input;
    const draftInput = version === PROJECT_DOCUMENT_VERSION ? { ...rest, version: 4 } : input;
    const draft = normalizeProjectDraft(draftInput);
    if (draft.status !== "success") {
        return {
            status: "invalid",
            reason: draft.status === "invalid" ? draft.reason : "unsupported-version",
        };
    }

    let drawing: DrawingProjectScene | undefined;
    if (version === PROJECT_DOCUMENT_VERSION && rawDrawing !== undefined) {
        const normalized = normalizeDrawing(rawDrawing);
        if (!normalized) return { status: "invalid", reason: "invalid-drawing" };
        // An untouched editor (no walls yet) is not part of the project.
        if (hasDrawingContent(normalized)) drawing = normalized;
    }

    return {
        status: "success",
        value: {
            ...draft.value,
            version: PROJECT_DOCUMENT_VERSION,
            ...(drawing ? { drawing } : {}),
        },
    };
};

/** Assembles the document from the keys the pages wrote into `storage`. */
export const readProjectDocument = (storage: KeyValueStorage | null): ProjectDocumentReadResult => {
    if (!storage) return { status: "unavailable" };

    const draft = readProjectDraft({ storage });
    if (draft.status === "unavailable") return { status: "unavailable" };
    if (draft.status === "invalid") return { status: "invalid", reason: draft.reason };
    if (draft.status === "unsupported-version") {
        return { status: "invalid", reason: "unsupported-version" };
    }

    let rawDrawing: unknown;
    try {
        rawDrawing = JSON.parse(storage.getItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY) ?? "null");
    } catch {
        rawDrawing = null;
    }
    const parsedDrawing = normalizeDrawing(rawDrawing);
    // An untouched editor (no walls yet) is not part of the project.
    const drawing = parsedDrawing && hasDrawingContent(parsedDrawing) ? parsedDrawing : undefined;

    if (draft.status === "missing" && !hasDrawingContent(drawing)) return { status: "empty" };

    const base = draft.status === "success" ? draft.value : createProjectDraft({ items: [] });
    return {
        status: "success",
        value: {
            ...base,
            version: PROJECT_DOCUMENT_VERSION,
            ...(drawing ? { drawing } : {}),
        },
    };
};

/**
 * Replaces the project's keys in `storage` with the document, exactly: a
 * section absent from the document is removed rather than left behind.
 */
export const writeProjectDocument = (
    storage: KeyValueStorage | null,
    input: unknown,
): ProjectDocumentResult | { status: "unavailable" } => {
    if (!storage) return { status: "unavailable" };
    const normalized = normalizeProjectDocument(input);
    if (normalized.status !== "success") return normalized;

    const { drawing, ...draft } = normalized.value;
    // `visualTest` is passed explicitly so a stored test is never resurrected.
    const saved = saveProjectDraft(
        { ...draft, version: 4, visualTest: draft.visualTest },
        { storage },
    );
    if (saved.status !== "success") {
        return saved.status === "unavailable"
            ? { status: "unavailable" }
            : {
                  status: "invalid",
                  reason: saved.status === "invalid" ? saved.reason : "unsupported-version",
              };
    }

    try {
        if (drawing) {
            storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(drawing));
        } else {
            storage.removeItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY);
        }
    } catch {
        return { status: "unavailable" };
    }
    return normalized;
};

/** True for a document with nothing the person entered yet. */
export const isEmptyProjectDocument = (document: ProjectDocument): boolean =>
    !document.visualTest?.answers.length &&
    document.questionnaire.items.length === 0 &&
    !document.planner &&
    !hasDrawingContent(document.drawing);

export const summarizeProjectDocument = (document: ProjectDocument): ProjectSummary => {
    const furnitureCount = document.questionnaire.items.reduce((sum, item) => sum + item.count, 0);
    const room = document.planner?.room;
    const stage: ProjectStage = document.planner?.layout?.placements.length
        ? "layout"
        : room || hasDrawingContent(document.drawing)
          ? "room"
          : furnitureCount > 0
            ? "questionnaire"
            : "style";

    let areaM2: number | undefined;
    if (room) {
        const area = Math.round(getRoomArea(room) / 10_000) / 100;
        if (Number.isFinite(area) && area > 0) areaM2 = area;
    }
    const styleLabel = document.questionnaire.meta?.styleLabel?.slice(0, 60);

    return {
        stage,
        ...(styleLabel ? { styleLabel } : {}),
        ...(areaM2 !== undefined ? { areaM2 } : {}),
        ...(furnitureCount > 0 ? { furnitureCount } : {}),
    };
};
