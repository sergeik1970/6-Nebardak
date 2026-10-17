import { describe, expect, it } from "vitest";

import { validateLayout } from "./geometry";
import { GOLDEN_ROOM_SCENARIOS } from "./golden-rooms";
import { solveRoom } from "./solver";
import { FurnitureInstance } from "./types";

const requiredInstances = (definitionIds: string[]): FurnitureInstance[] =>
    definitionIds.map((definitionId, index) => ({
        instanceId: `${definitionId}-${index + 1}`,
        definitionId,
        priority: "required",
        required: true,
    }));

describe("golden room acceptance scenarios", () => {
    it.each(GOLDEN_ROOM_SCENARIOS)(
        "$label returns the complete validated furniture set",
        (scenario) => {
            const result = solveRoom(
                scenario.room,
                requiredInstances(scenario.definitionIds),
                scenario.preferences,
            );

            expect(result.status, scenario.id).toBe("success");
            if (result.status !== "success") throw new Error(`${scenario.id}: ${result.message}`);
            expect(result.placements, scenario.id).toHaveLength(scenario.definitionIds.length);
            expect(
                validateLayout(scenario.room, result.placements, scenario.preferences),
                scenario.id,
            ).toEqual({ valid: true, issues: [] });
        },
        15_000,
    );
});
