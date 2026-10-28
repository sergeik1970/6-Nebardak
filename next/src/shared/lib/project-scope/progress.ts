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

export const getProjectProgress = (document: ProjectDocument | null): ProjectProgress => {
    const style = Boolean(document?.visualTest?.result || document?.questionnaire.meta?.styleLabel);
    const room = document ? hasProjectRoom(document) : false;

    return {
        style: { done: style, available: true },
        plan: { done: room, available: true },
        // The result is a view of the plan, not a task: it opens with the
        // room and never shows as finished while furniture is still placed.
        result: room
            ? { done: false, available: true }
            : {
                  done: false,
                  available: false,
                  hint: "Итог появится, когда стены квартиры замкнутся",
              },
    };
};
