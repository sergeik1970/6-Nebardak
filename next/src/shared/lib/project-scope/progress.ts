import { deriveDrawWallGraphRoom } from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import type { ProjectDocument } from "./document";

/**
 * Where a project stands on the path «стиль → планировка → итог». Derived
 * from the document alone, so every page, the project list and the stepper
 * agree without storing a separate "stage" field.
 */
export type ProjectStepId = "style" | "plan" | "result";

export interface ProjectStepProgress {
    done: boolean;
    available: boolean;
    /** Why an unavailable step is locked. */
    hint?: string;
}

export type ProjectProgress = Record<ProjectStepId, ProjectStepProgress>;

export const PROJECT_STEPS: ReadonlyArray<{ id: ProjectStepId; label: string; href: string }> = [
    { id: "style", label: "Стиль", href: "/test" },
    { id: "plan", label: "Планировка", href: "/planner" },
    { id: "result", label: "Итог", href: "/planner?step=result" },
];

/** A closed contour in the drawing, or a room the planner already works with. */
export const hasProjectRoom = (document: ProjectDocument): boolean => {
    if (document.planner?.room) return true;
    const drawing = document.drawing;
    if (!drawing || drawing.segments.length < 4) return false;
    return deriveDrawWallGraphRoom(drawing.segments, drawing.wallThickness) !== null;
};

/** Pieces standing on the drawing, or a layout saved before the drawing held furniture. */
const hasPlacedFurniture = (document: ProjectDocument): boolean =>
    (document.drawing?.furniture?.length ?? 0) > 0 ||
    Boolean(document.planner?.layout?.placements.length);

export const getProjectProgress = (document: ProjectDocument | null): ProjectProgress => {
    const style = Boolean(document?.visualTest?.result || document?.questionnaire.meta?.styleLabel);
    const room = document ? hasProjectRoom(document) : false;
    const furnished = document ? hasPlacedFurniture(document) : false;

    return {
        style: { done: style, available: true },
        plan: { done: room, available: true },
        result: room
            ? { done: furnished, available: true }
            : {
                  done: false,
                  available: false,
                  hint: "Итог появится, когда стены квартиры замкнутся",
              },
    };
};
