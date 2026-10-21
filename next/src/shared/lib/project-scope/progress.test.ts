import { describe, expect, it } from "vitest";
import { createProjectDraft } from "@/shared/lib/furniture-planner/project-draft";
import { PROJECT_DOCUMENT_VERSION, type ProjectDocument } from "./document";
import { getProjectProgress } from "./progress";
import { createFixtureDraft, fixtureDrawing } from "./test-fixtures";

const asDocument = (draft: ReturnType<typeof createProjectDraft>): ProjectDocument => ({
    ...draft,
    version: PROJECT_DOCUMENT_VERSION,
});

describe("project progress", () => {
    it("opens only the first steps of an empty project", () => {
        const progress = getProjectProgress(null);
        expect(progress.style).toEqual({ done: false, available: true });
        expect(progress.room).toEqual({ done: false, available: true });
        expect(progress.layout.available).toBe(false);
        expect(progress.layout.hint).toBe("Сначала выберите мебель и нарисуйте комнату");
        expect(progress.result.available).toBe(false);
    });

    it("needs a closed room before the layout step", () => {
        const draft = asDocument(
            createProjectDraft({
                items: [{ definitionId: "double-bed", count: 1, priority: "required" }],
            }),
        );
        expect(getProjectProgress(draft).questionnaire.done).toBe(true);
        expect(getProjectProgress(draft).layout).toMatchObject({
            available: false,
            hint: "Сначала нарисуйте комнату",
        });

        const openWalls = { ...fixtureDrawing, segments: fixtureDrawing.segments.slice(0, 3) };
        expect(getProjectProgress({ ...draft, drawing: openWalls }).room.done).toBe(false);

        const withRoom = getProjectProgress({ ...draft, drawing: fixtureDrawing });
        expect(withRoom.room.done).toBe(true);
        expect(withRoom.layout).toEqual({ done: false, available: true });
    });

    it("treats the planner's room and placements as done steps", () => {
        const draft = createFixtureDraft();
        const progress = getProjectProgress(asDocument(draft));
        expect(progress.style.done).toBe(true);
        expect(progress.room.done).toBe(true);
        expect(progress.layout).toEqual({ done: false, available: true });
        expect(progress.result.available).toBe(false);

        const placed = asDocument({
            ...draft,
            planner: {
                ...draft.planner!,
                layout: {
                    variants: [],
                    activeVariantId: null,
                    editedVariantIds: [],
                    placements: [
                        {
                            instanceId: "bed-1",
                            definitionId: "double-bed",
                            x: 0,
                            y: 0,
                            rotation: 0,
                        },
                    ],
                    history: { past: [], future: [] },
                    exploredNodes: 0,
                    score: 0,
                    notes: [],
                    generatedAt: "2026-10-21T00:00:00.000Z",
                } as never,
            },
        });
        const done = getProjectProgress(placed);
        expect(done.layout.done).toBe(true);
        expect(done.result).toEqual({ done: true, available: true });
    });
});
