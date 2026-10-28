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
    it("opens style and planning in an empty project and keeps the result for later", () => {
        const progress = getProjectProgress(null);
        expect(progress.style).toEqual({ done: false, available: true });
        expect(progress.plan).toEqual({ done: false, available: true });
        expect(progress.result).toMatchObject({ done: false, available: false });
        expect(progress.result.hint).toBe("Итог появится, когда стены квартиры замкнутся");
    });

    it("needs no questionnaire: a closed drawing opens the result", () => {
        const draft = asDocument(createProjectDraft({ items: [] }));
        const openWalls = { ...fixtureDrawing, segments: fixtureDrawing.segments.slice(0, 3) };
        expect(getProjectProgress({ ...draft, drawing: openWalls }).plan.done).toBe(false);

        const withRoom = getProjectProgress({ ...draft, drawing: fixtureDrawing });
        expect(withRoom.plan.done).toBe(true);
        expect(withRoom.result).toEqual({ done: false, available: true });

        const furnished = getProjectProgress({
            ...draft,
            drawing: {
                ...fixtureDrawing,
                furniture: [
                    {
                        id: "bed",
                        definitionId: "double-bed",
                        x: 0,
                        y: 0,
                        width: 1800,
                        depth: 2000,
                        rotation: 0,
                    },
                ],
            },
        });
        // Furniture does not tick the result off: it is a view, not a task.
        expect(furnished.result).toEqual({ done: false, available: true });
    });

    it("counts an older project's planner room and saved layout", () => {
        const draft = createFixtureDraft();
        const progress = getProjectProgress(asDocument(draft));
        expect(progress.style.done).toBe(true);
        expect(progress.plan.done).toBe(true);
        expect(progress.result).toEqual({ done: false, available: true });

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
        expect(getProjectProgress(placed).result).toEqual({ done: false, available: true });
    });
});
