import { describe, expect, it } from "vitest";
import {
    TV_STAND_ID,
    isTvApartFromStand,
    isTvOverStand,
    standPlacementUnderTv,
    tvPlacementOverStand,
    validateLayout,
} from "./geometry";
import { solveRoomVariants } from "./solver";
import type { FurnitureInstance, Placement, Room, Rotation } from "./types";

const room: Room = { width: 5000, depth: 6000, doors: [], windows: [], radiators: [] };

const stands: Record<Rotation, Placement> = {
    0: { instanceId: "stand-1", definitionId: TV_STAND_ID, x: 1800, y: 0, rotation: 0 },
    90: { instanceId: "stand-1", definitionId: TV_STAND_ID, x: 4550, y: 2300, rotation: 90 },
    180: { instanceId: "stand-1", definitionId: TV_STAND_ID, x: 1800, y: 5550, rotation: 180 },
    270: { instanceId: "stand-1", definitionId: TV_STAND_ID, x: 0, y: 2300, rotation: 270 },
};

const instance = (instanceId: string, definitionId: string): FurnitureInstance => ({
    instanceId,
    definitionId,
    priority: "required",
    required: true,
});

describe("TV over its stand", () => {
    it.each([0, 90, 180, 270] as const)("hangs centred on the stand's wall at %i°", (rotation) => {
        const stand = stands[rotation];
        const tv = tvPlacementOverStand({ instanceId: "tv-1", definitionId: "tv" }, stand);

        expect(tv.rotation).toBe(rotation);
        expect(isTvOverStand(tv, stand)).toBe(true);
        expect(standPlacementUnderTv(stand, tv)).toEqual(stand);
        expect(validateLayout(room, [stand, tv]).issues.map((issue) => issue.code)).not.toContain(
            "body-overlap",
        );
    });

    it("still rejects a TV that overlaps the stand off centre", () => {
        const stand = stands[0];
        const tv = { ...tvPlacementOverStand({ instanceId: "tv-1", definitionId: "tv" }, stand) };
        tv.x += 200;

        expect(isTvOverStand(tv, stand)).toBe(false);
        expect(validateLayout(room, [stand, tv]).issues.map((issue) => issue.code)).toContain(
            "body-overlap",
        );
    });

    it("leaves a person's own layout with the TV apart valid", () => {
        const stand = stands[0];
        const tv: Placement = {
            instanceId: "tv-1",
            definitionId: "tv",
            x: 0,
            y: 2000,
            rotation: 270,
        };

        expect(isTvApartFromStand([stand, tv])).toBe(true);
        expect(validateLayout(room, [stand, tv]).issues.map((issue) => issue.code)).not.toContain(
            "body-overlap",
        );
    });

    it("never proposes a living room with the TV away from its stand", () => {
        const result = solveRoomVariants(
            room,
            [
                instance("sofa-three-1", "sofa-three"),
                instance("tv-1", "tv"),
                instance("tv-console-1", "tv-console"),
                instance("coffee-table-1", "coffee-table"),
            ],
            { tvTargetCategory: "living" },
            3,
        );

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        for (const variant of result.variants) {
            expect(isTvApartFromStand(variant.placements)).toBe(false);
            expect(
                validateLayout(room, variant.placements, { tvTargetCategory: "living" }).valid,
            ).toBe(true);
        }
    });
});
