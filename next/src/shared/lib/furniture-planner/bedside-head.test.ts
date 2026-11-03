import { describe, expect, it } from "vitest";
import { createDefaultRoom } from "./room";
import { isAwayFromTargetHead, isBesideTargetHead, validateLayout } from "./geometry";
import { getRequiredRelationCandidates, solveRoomVariants } from "./solver";
import type { FurnitureInstance, Placement } from "./types";

const instance = (instanceId: string, definitionId: string): FurnitureInstance => ({
    instanceId,
    definitionId,
    priority: "required",
    required: true,
});

describe("bedside tables at the bed's head", () => {
    // A bed turned with its head to the left wall: 2000 wide, 1800 deep on the plan.
    const bed: Placement = {
        instanceId: "bed",
        definitionId: "double-bed",
        x: 0,
        y: 1000,
        rotation: 270,
    };
    const table = (x: number, y: number): Placement => ({
        instanceId: "table",
        definitionId: "bedside-table",
        x,
        y,
        rotation: 0,
    });

    it("knows the head of a turned bed", () => {
        expect(isBesideTargetHead(table(0, 1000 - 50 - 350), bed)).toBe(true);
        expect(isBesideTargetHead(table(0, 1000 + 1800 + 50), bed)).toBe(true);
        // At the foot: right of a bed whose head is at the left wall.
        expect(isBesideTargetHead(table(2050, 1000), bed)).toBe(false);
        expect(isAwayFromTargetHead([bed, table(2050, 1000)])).toBe(true);
    });

    it.each([0, 90, 180, 270] as const)(
        "offers both sides of the head of a bed turned %i°, and nothing else",
        (rotation) => {
            const room = createDefaultRoom(9000, 9000);
            const turned: Placement = { ...bed, x: 3000, y: 3000, rotation };
            const spots = Array.from(
                getRequiredRelationCandidates(instance("table", "bedside-table"), room, [turned]) ??
                    [],
            );

            expect(spots.length).toBeGreaterThan(0);
            for (const spot of spots) expect(isBesideTargetHead(spot, turned)).toBe(true);
            const sides = new Set(
                spots.map((spot) =>
                    rotation === 0 || rotation === 180
                        ? Math.sign(spot.x - 3000)
                        : Math.sign(spot.y - 3000),
                ),
            );
            expect(sides.size).toBe(2);
        },
    );

    it("never fails a saved layout for it", () => {
        const room = createDefaultRoom(5000, 5000);
        const issues = validateLayout(room, [bed, table(2050, 1000)]).issues.map(
            (issue) => issue.code,
        );
        expect(issues).not.toContain("relation-broken");
    });

    it("never proposes bedside tables away from the head, however the bed turns", () => {
        for (const [width, depth] of [
            [3300, 4200],
            [4200, 3300],
        ]) {
            const room = createDefaultRoom(width, depth);
            const result = solveRoomVariants(
                room,
                [
                    instance("bed", "double-bed"),
                    instance("table-1", "bedside-table"),
                    instance("table-2", "bedside-table"),
                ],
                {},
                3,
            );
            expect(result.status).toBe("success");
            if (result.status !== "success") continue;
            for (const variant of result.variants)
                expect(isAwayFromTargetHead(variant.placements)).toBe(false);
        }
    });
});
