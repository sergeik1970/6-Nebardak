import { describe, expect, it } from "vitest";
import { validateLayout } from "./geometry";
import { ROOM_LAB_GENERATED_CASES } from "./room-lab";
import { solveRoom, solveRoomVariants, solveWithPreferredPlacementFallback } from "./solver";
import type { FurnitureInstance } from "./types";

// A room where the catalogue's 1800 × 2000 bed has no valid spot at all.
const roomCase = ROOM_LAB_GENERATED_CASES.find(
    (candidate) => candidate.id === "GEN-bedroom-3300x3900-side-door",
);
if (!roomCase) throw new Error("Generated room missing");
const { room } = roomCase;

const bed = (size?: { width: number; depth: number }): FurnitureInstance => ({
    instanceId: "double-bed-1",
    definitionId: "double-bed",
    priority: "required",
    required: true,
    ...size,
});

describe("pieces in a chosen size", () => {
    it("places a smaller bed where the catalogue size has no spot", () => {
        expect(solveRoom(room, [bed()]).status).toBe("failure");

        const result = solveRoom(room, [bed({ width: 1400, depth: 2000 })]);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(result.placements[0]).toMatchObject({ width: 1400, depth: 2000 });
        expect(validateLayout(room, result.placements).valid).toBe(true);
    });

    it("keeps the size through variants and the fallback", () => {
        const instances = roomCase.instances.map((instance) =>
            instance.definitionId === "double-bed" ? bed({ width: 1400, depth: 2000 }) : instance,
        );

        const variants = solveRoomVariants(room, instances, roomCase.preferences, 3);
        const fallback = solveWithPreferredPlacementFallback(room, instances, roomCase.preferences);

        for (const placements of [
            ...(variants.status === "success" ? variants.variants.map((v) => v.placements) : []),
            fallback.result.placements,
        ]) {
            const placed = placements.find((placement) => placement.definitionId === "double-bed");
            expect(placed).toMatchObject({ width: 1400, depth: 2000 });
            expect(validateLayout(room, placements, roomCase.preferences).valid).toBe(true);
        }
    });

    it("leaves placements without a size when the instance has none", () => {
        const result = solveRoom({ ...room, width: 5000, depth: 5000 }, [bed()]);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(result.placements[0]).not.toHaveProperty("width");
    });
});
