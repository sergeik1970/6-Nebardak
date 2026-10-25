import { createProjectDraft } from "@/shared/lib/furniture-planner/project-draft";
import {
    PROJECT_DOCUMENT_VERSION,
    type ProjectDocument,
    type ProjectSummary,
} from "@/shared/lib/project-scope/document";
import { withProjectParam } from "@/shared/lib/project-scope/storage";

/** What the card says about how far the project has got. */
export const STAGE_LABELS: Record<NonNullable<ProjectSummary["stage"]>, string> = {
    style: "Только начат",
    questionnaire: "Анкета заполнена",
    room: "Комната готова",
    layout: "Есть расстановка",
};

/** Opens a project on the step that comes next for it: the style test, then the planner. */
export const projectEntryHref = (projectId: string, summary: ProjectSummary): string => {
    const started =
        summary.stage !== "style" || Boolean(summary.furnitureCount || summary.styleLabel);
    return withProjectParam(started ? "/planner" : "/test", projectId);
};

export const describeProject = (summary: ProjectSummary): string[] =>
    [
        STAGE_LABELS[summary.stage ?? "style"],
        summary.styleLabel ? `Стиль: ${summary.styleLabel}` : null,
        summary.areaM2 ? `${summary.areaM2.toLocaleString("ru-RU")} м²` : null,
        summary.furnitureCount ? `Мебель: ${summary.furnitureCount}` : null,
    ].filter((part): part is string => Boolean(part));

export const formatUpdatedAt = (iso: string, now = Date.now()): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const today = new Date(now);
    if (date.toDateString() === today.toDateString()) return `сегодня в ${time}`;
    return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
    });
};

/** A brand-new project: no answers, no room. */
export const createEmptyProjectDocument = (now = Date.now()): ProjectDocument => ({
    ...createProjectDraft({ items: [] }, undefined, now),
    version: PROJECT_DOCUMENT_VERSION,
});
