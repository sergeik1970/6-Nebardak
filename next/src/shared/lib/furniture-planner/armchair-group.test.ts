import { describe, expect, it } from "vitest";
import { furnishRoom } from "./furniture-selection";
import { isArmchairAwayFromSofaGroup, validateLayout } from "./geometry";
import { createDefaultRoom } from "./room";
import type { Placement } from "./types";

// A sofa against the top wall looking down, its coffee table in front.
const sofa: Placement = {
    instanceId: "sofa",
    definitionId: "sofa-three",
    x: 1000,
    y: 0,
    rotation: 0,
};
const table: Placement = {
    instanceId: "table",
    definitionId: "coffee-table",
    x: 1850,
    y: 1350,
    rotation: 0,
};
const armchair = (x: number, y: number, rotation: Placement["rotation"]): Placement => ({
    instanceId: "armchair",
    definitionId: "armchair",
    x,
    y,
    rotation,
});

describe("armchair in the sofa group", () => {
    it("accepts an armchair beside the table, turned to it", () => {
        // Left of the table, looking right (its back to the left wall side).
        expect(
            isArmchairAwayFromSofaGroup([sofa, table, armchair(1850 - 300 - 900, 1150, 270)]),
        ).toBe(false);
    });

    it("rejects one far away, turned away, or blocking the TV", () => {
        expect(isArmchairAwayFromSofaGroup([sofa, table, armchair(0, 3500, 270)])).toBe(true);
        expect(
            isArmchairAwayFromSofaGroup([sofa, table, armchair(1850 - 300 - 900, 1150, 90)]),
        ).toBe(true);
        // Across the table from the sofa, looking at it: on the TV's line of sight.
        expect(isArmchairAwayFromSofaGroup([sofa, table, armchair(1650, 2150, 180)])).toBe(true);
    });

    it("furnishes living rooms with every armchair in the group, or without it and says so", () => {
        for (const [width, depth] of [
            [4500, 5000],
            [5000, 6000],
            [3600, 5600],
        ]) {
            const room = createDefaultRoom(width, depth);
            const result = furnishRoom(room, "living");
            expect(result.status).toBe("furnished");
            expect(isArmchairAwayFromSofaGroup(result.placements)).toBe(false);
            expect(
                validateLayout(room, result.placements, { tvTargetCategory: "living" }).valid,
            ).toBe(true);
            const wanted = result.step.pieces.find((item) => item.definitionId === "armchair");
            const placed = result.placements.filter((item) => item.definitionId === "armchair");
            expect(placed.length).toBe(wanted?.count ?? 0);
        }
    });
});
