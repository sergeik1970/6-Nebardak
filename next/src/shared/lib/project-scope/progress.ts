import { deriveDrawWallGraphRoom } from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import type { ProjectDocument } from "./document";

/**
 * Where a project stands on the path «стиль → анкета → комната → расстановка
 * → итог». Derived from the document alone, so every page, the project list
 * and the stepper agree without storing a separate "stage" field.
 */
export type ProjectStepId = "style" | "questionnaire" | "room" | "layout" | "result";

export interface ProjectStepProgress {
    done: boolean;
    available: boolean;
    /** Why an unavailable step is locked. */
    hint?: string;
}

export type ProjectProgress = Record<ProjectStepId, ProjectStepProgress>;

export const PROJECT_STEPS: ReadonlyArray<{ id: ProjectStepId; label: string; href: string }> = [
    { id: "style", label: "Стиль", href: "/test" },
    { id: "questionnaire", label: "Анкета", href: "/questionnaire" },
    { id: "room", label: "Комната", href: "/planner/draw" },
    { id: "layout", label: "Расстановка", href: "/planner" },
    { id: "result", label: "Итог", href: "/planner#plan-result" },
];

const countFurniture = (document: ProjectDocument): number => {
    const fromQuestionnaire = document.questionnaire.items.reduce(
        (sum, item) => sum + item.count,
        0,
    );
    const fromPlanner = Object.values(document.planner?.selection ?? {}).reduce(
        (sum, count) => sum + count,
        0,
    );
    return Math.max(fromQuestionnaire, fromPlanner);
};

/** A closed contour in the drawing, or a room the planner already works with. */
export const hasProjectRoom = (document: ProjectDocument): boolean => {
    if (document.planner?.room) return true;
    const drawing = document.drawing;
    if (!drawing || drawing.segments.length < 4) return false;
    return deriveDrawWallGraphRoom(drawing.segments, drawing.wallThickness) !== null;
};

export const getProjectProgress = (document: ProjectDocument | null): ProjectProgress => {
    const style = Boolean(document?.visualTest?.result || document?.questionnaire.meta?.styleLabel);
    const furniture = document ? countFurniture(document) : 0;
    const room = document ? hasProjectRoom(document) : false;
    const layout = Boolean(document?.planner?.layout?.placements.length);

    const layoutHint = !room
        ? furniture > 0
            ? "Сначала нарисуйте комнату"
            : "Сначала выберите мебель и нарисуйте комнату"
        : "Сначала выберите мебель в анкете";

    return {
        style: { done: style, available: true },
        questionnaire: { done: furniture > 0, available: true },
        room: { done: room, available: true },
        layout:
            room && furniture > 0
                ? { done: layout, available: true }
                : { done: layout, available: layout, ...(layout ? {} : { hint: layoutHint }) },
        result: layout
            ? { done: true, available: true }
            : { done: false, available: false, hint: "Итог появится после расстановки" },
    };
};
