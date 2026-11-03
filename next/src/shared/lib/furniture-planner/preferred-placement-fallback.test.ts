import { describe, expect, it } from "vitest";

import { buildFurnitureInstances } from "./catalog";
import { validateLayout } from "./geometry";
import { createDefaultRoom } from "./room";
import { ROOM_LAB_GENERATED_CASES } from "./room-lab";
import { solveWithPreferredPlacementFallback } from "./solver";
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
    });

    it("keeps a dense all-required questionnaire usable", () => {
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
        const denseRoom = createDefaultRoom(7200, 5400);
        const denseInstances = buildFurnitureInstances(selection);
        const preferences = { tvTargetCategory: "sleep" as const };

        const fallback = solveWithPreferredPlacementFallback(
            denseRoom,
            denseInstances,
            preferences,
        );

        expect(fallback.result.status).toBe("success");
        expect(fallback.result.placements).toHaveLength(denseInstances.length);
        expect(fallback.unplacedInstances).toEqual([]);
    });

    const generatedCase = (id: string) => {
        const roomCase = ROOM_LAB_GENERATED_CASES.find((candidate) => candidate.id === id);
        if (!roomCase) throw new Error(`Unknown generated room: ${id}`);
        return roomCase;
    };

    it("finds the whole set from the main piece where the old search ran out", () => {
        const { room, instances, preferences } = generatedCase("GEN-living-3600x5000-side-door");

        const fallback = solveWithPreferredPlacementFallback(room, instances, preferences);

        expect(fallback.unplacedInstances).toEqual([]);
        expect(fallback.result.placements).toHaveLength(instances.length);
        expect(validateLayout(room, fallback.result.placements, preferences).valid).toBe(true);
    });

    it("names the main piece as left out when it alone has no valid spot", () => {
        const { room, instances, preferences } = generatedCase("GEN-bedroom-3300x3900-side-door");

        const fallback = solveWithPreferredPlacementFallback(room, instances, preferences);

        expect(fallback.unplacedInstances.map((item) => item.definitionId)).toContain("double-bed");
    });
});
