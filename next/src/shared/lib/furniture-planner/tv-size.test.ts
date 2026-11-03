import { describe, expect, it } from "vitest";
import { allocateApartmentBrief } from "./apartment-brief";
import { getFurniture, getViewingDistanceRange } from "./catalog";
import { furnishRoom } from "./furniture-selection";
import { getBounds, getWorldBodyRects, isTvOverStand, validateLayout } from "./geometry";
import { createDefaultRoom } from "./room";

describe("TV size", () => {
    const tv = getFurniture("tv");

    it("sits farther from a larger screen, never closer than the catalogue's 1400 mm", () => {
        expect(getViewingDistanceRange(tv, "living").minimum).toBe(1400);
        expect(getViewingDistanceRange(tv, "living", 750).minimum).toBe(1400);
        // 50″ is about 1120 mm wide: 1.2 × 1285 mm.
        expect(getViewingDistanceRange(tv, "living", 1120).minimum).toBe(1550);
        // 65″ is about 1450 mm wide: 1.2 × 1664 mm.
        expect(getViewingDistanceRange(tv, "living", 1450).minimum).toBe(2000);
    });

    it("gives a large screen a wide stand and a sofa at least 2 m away", () => {
        const room = createDefaultRoom(4500, 6000);
        const pieces = allocateApartmentBrief(
            [{ signature: "living", kind: "living", areaM2: 27 }],
            { version: 1, tv: "large" },
        ).pieces.get("living")!;

        const result = furnishRoom(room, "living", {}, { pieces });

        expect(result.status).toBe("furnished");
        const screen = result.placements.find((placement) => placement.definitionId === "tv")!;
        const stand = result.placements.find(
            (placement) => placement.definitionId === "tv-console",
        )!;
        const sofa = result.placements.find((placement) =>
            placement.definitionId.startsWith("sofa"),
        )!;
        expect(screen).toMatchObject({ width: 1450 });
        expect(stand).toMatchObject({ width: 1655 });
        expect(isTvOverStand(screen, stand)).toBe(true);
        expect(validateLayout(room, result.placements, { tvTargetCategory: "living" }).valid).toBe(
            true,
        );
        const screenBox = getBounds(getWorldBodyRects(screen));
        const sofaBox = getBounds(getWorldBodyRects(sofa));
        const gap = Math.max(
            sofaBox.x - (screenBox.x + screenBox.width),
            screenBox.x - (sofaBox.x + sofaBox.width),
            sofaBox.y - (screenBox.y + screenBox.depth),
            screenBox.y - (sofaBox.y + sofaBox.depth),
        );
        expect(gap).toBeGreaterThanOrEqual(2000);
    });
});
