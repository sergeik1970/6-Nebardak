import { describe, expect, it } from "vitest";
import { buildFurnitureInstances } from "./catalog";
import { getWorldBodyRects, validateLayout } from "./geometry";
import { createDefaultRoom } from "./room";
import { solveRoom } from "./solver";
import type { Rect, Room } from "./types";

const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.depth && a.y + a.depth > b.y;

describe("pinned furniture", () => {
    // A bed pinned against the top wall, its foot passage in front of it.
    const bed = { x: 1000, y: 0, width: 1800, depth: 2000 };
    const foot = { x: 1000, y: 2000, width: 1800, depth: 700 };
    const room: Room = {
        ...createDefaultRoom(4000, 4000),
        fixedFurniture: { bodies: [bed], passages: [foot] },
    };

    it("is worked around by the solver, passage included", () => {
        const result = solveRoom(
            room,
            buildFurnitureInstances({
                dresser: { count: 1, priority: "required", required: true },
                armchair: { count: 1, priority: "required", required: true },
            }),
        );

        expect(result.status).toBe("success");
        if (result.status !== "success") return;
        for (const placement of result.placements)
            for (const body of getWorldBodyRects(placement)) {
                expect(overlaps(body, bed), placement.definitionId).toBe(false);
                expect(overlaps(body, foot), placement.definitionId).toBe(false);
            }
    });

    it("refuses a piece standing on it or in its passage", () => {
        const onPassage = validateLayout(room, [
            { instanceId: "dresser-1", definitionId: "dresser", x: 1500, y: 2100, rotation: 0 },
        ]);
        expect(onPassage.issues.map((issue) => issue.code)).toContain("fixed-furniture-blocked");
    });
});
