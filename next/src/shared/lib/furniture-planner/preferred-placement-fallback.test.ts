import { describe, expect, it } from "vitest";

import { buildFurnitureInstances } from "./catalog";
import { createDefaultRoom } from "./room";
import { solveRoomVariants, solveWithPreferredPlacementFallback } from "./solver";
import { FurnitureInstance, FurnitureSelection, Room } from "./types";

const room: Room = {
    width: 2400,
    depth: 3000,
    doors: [],
    windows: [],
    radiators: [],
};

const instance = (
    instanceId: string,
    definitionId: string,
    priority: FurnitureInstance["priority"],
): FurnitureInstance => ({
    instanceId,
    definitionId,
    priority,
    required: priority === "required",
});

describe("preferred placement fallback", () => {
    it("keeps a preferred item when it fits beside the required base plan", () => {
        const result = solveWithPreferredPlacementFallback(room, [
            instance("bed-1", "single-bed", "required"),
            instance("sofa-1", "sofa-three", "preferred"),
        ]);

        expect(result.result.status).toBe("success");
        expect(result.result.placements.map((placement) => placement.instanceId)).toEqual([
            "bed-1",
            "sofa-1",
        ]);
        expect(result.unplacedInstances).toEqual([]);
    });

    it("keeps the full planner set in the standard room when every item fits", () => {
        const selection: FurnitureSelection = {
            "double-bed": { count: 1, priority: "required", required: true },
            bookcase: { count: 1, priority: "preferred", required: false },
            "wardrobe-medium": { count: 2, priority: "preferred", required: false },
            "bedside-table": { count: 2, priority: "preferred", required: false },
            dresser: { count: 1, priority: "preferred", required: false },
            desk: { count: 1, priority: "preferred", required: false },
            "coffee-table": { count: 1, priority: "preferred", required: false },
            "sofa-four-left": { count: 1, priority: "preferred", required: false },
            tv: { count: 1, priority: "preferred", required: false },
        };

        const result = solveWithPreferredPlacementFallback(
            createDefaultRoom(6000, 4600),
            buildFurnitureInstances(selection),
            { tvTargetCategory: "sleep" },
        );

        expect(result.result.status).toBe("success");
        expect(result.result.placements.some((item) => item.definitionId === "double-bed")).toBe(
            true,
        );
        expect(result.result.placements.some((item) => item.definitionId === "tv")).toBe(true);
        expect(result.result.placements.some((item) => item.definitionId === "dresser")).toBe(true);
        expect(
            result.result.placements.filter((item) => item.definitionId === "bedside-table"),
        ).toHaveLength(2);
        expect(
            result.result.placements.some((item) => item.definitionId === "sofa-four-left"),
        ).toBe(true);
        expect(result.result.placements.some((item) => item.definitionId === "coffee-table")).toBe(
            true,
        );
        expect(result.result.placements.some((item) => item.definitionId === "desk")).toBe(true);
        expect(result.unplacedInstances).toEqual([]);
    }, 10_000);

    it("keeps a dense all-required questionnaire usable when the variants search reaches its limit", () => {
        const selection: FurnitureSelection = {
            "double-bed": { count: 1, priority: "required", required: true },
            bookcase: { count: 1, priority: "required", required: true },
            "wardrobe-medium": { count: 2, priority: "required", required: true },
            dresser: { count: 1, priority: "required", required: true },
            desk: { count: 1, priority: "required", required: true },
            "coffee-table": { count: 1, priority: "required", required: true },
            "sofa-four-left": { count: 1, priority: "required", required: true },
            tv: { count: 1, priority: "required", required: true },
            cradle: { count: 1, priority: "required", required: true },
        };
        const denseRoom = createDefaultRoom(7200, 5200);
        const denseInstances = buildFurnitureInstances(selection);
        const preferences = { tvTargetCategory: "sleep" as const };

        expect(solveRoomVariants(denseRoom, denseInstances, preferences, 3).status).toBe("failure");

        const fallback = solveWithPreferredPlacementFallback(
            denseRoom,
            denseInstances,
            preferences,
        );

        expect(fallback.result.status).toBe("success");
        expect(fallback.result.placements).toHaveLength(denseInstances.length);
        expect(fallback.unplacedInstances).toEqual([]);
    }, 30_000);
});
