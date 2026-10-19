import { describe, expect, it } from "vitest";
import { prepareDrawFurnitureHandoff } from "./draw-furniture-handoff";
import { getFurniture } from "./catalog";
import { getRotatedGeometry, getWorldBodyRects } from "./geometry-shapes";
import { getFurniturePhotos } from "./furniture-photos";
import {
    createProjectDraft,
    readProjectDraft,
    saveProjectDraft,
    validateProjectDraftLayout,
} from "./project-draft";
import type { Room } from "./types";

const room: Room = { width: 7900, depth: 5400, doors: [], windows: [] };
const photoId = getFurniturePhotos("single-bed")[1].id;
const item = {
    id: "draw-bed",
    definitionId: "single-bed",
    x: 4000,
    y: 2500,
    width: 1000,
    depth: 2200,
    rotation: 90 as const,
    photoId,
};
describe("draw furniture handoff", () => {
    it("translates the drawing origin and retains dimensions, rotation and photo through project storage", () => {
        const result = prepareDrawFurnitureHandoff(room, { x: 1050, y: 1050 }, [item]);
        expect(result.error).toBeNull();
        expect(result.placements).toEqual([
            {
                instanceId: "single-bed-1",
                definitionId: "single-bed",
                x: 2950,
                y: 1450,
                width: 1000,
                depth: 2200,
                rotation: 90,
                photoId,
            },
        ]);
        expect(getWorldBodyRects(result.placements[0])).toEqual([
            { x: 2950, y: 1450, width: 2200, depth: 1000 },
        ]);
        const planner = {
            room,
            selection: result.selection,
            priorities: { "single-bed": "preferred" as const },
            layout: {
                origin: "drawing" as const,
                variants: [],
                activeVariantId: null,
                editedVariantIds: [],
                placements: result.placements,
                history: { past: [], present: result.placements, future: [] },
                exploredNodes: 0,
                score: 0,
                notes: [],
                generatedAt: "2026-09-15T10:00:00Z",
            },
        };
        expect(validateProjectDraftLayout(planner).status).toBe("valid");
        const data = new Map<string, string>();
        const storage = {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => {
                data.set(key, value);
            },
            removeItem: (key: string) => {
                data.delete(key);
            },
        };
        const draft = createProjectDraft(
            { items: [{ definitionId: "single-bed", count: 1, priority: "preferred" }] },
            planner,
        );
        const saved = saveProjectDraft(draft, { storage });
        expect(saved.status, JSON.stringify(saved)).toBe("success");
        const restored = readProjectDraft({ storage });
        expect(restored.status).toBe("success");
        if (restored.status === "success")
            expect(restored.value.planner?.layout?.placements).toEqual(result.placements);
    });
    it("rejects an item outside the chosen room without dropping it from the result", () => {
        const result = prepareDrawFurnitureHandoff(room, { x: 1050, y: 1050 }, [{ ...item, x: 0 }]);
        expect(result.error).toBeTruthy();
        expect(result.placements).toHaveLength(1);
    });
    it("retains the external access clearance when a furniture body is resized", () => {
        const geometry = getRotatedGeometry(getFurniture("aquarium"), 0, {
            width: 1200,
            depth: 800,
        });
        expect(geometry.bodyRects).toEqual([{ x: 0, y: 0, width: 1200, depth: 800 }]);
        expect(geometry.clearanceRects[0]).toMatchObject({ x: 0, y: 800, width: 1200, depth: 600 });
    });
});
