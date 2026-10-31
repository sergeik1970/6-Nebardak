import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FURNITURE_BY_ID } from "./catalog";
import { FURNITURE_PLAN_IMAGES, getFurniturePlanImage } from "./furniture-plan-images";

describe("furniture plan images", () => {
    it.each(FURNITURE_PLAN_IMAGES)("$id belongs to a catalogue piece and exists", (image) => {
        expect(FURNITURE_BY_ID.has(image.definitionId)).toBe(true);
        expect(existsSync(path.join(process.cwd(), "public", image.src))).toBe(true);
        expect(image.body.width).toBeGreaterThan(0);
        expect(image.body.height).toBeGreaterThan(0);
    });

    it("draws every standard size with its own image", () => {
        for (const definition of Array.from(FURNITURE_BY_ID.values())) {
            for (const { width, depth } of definition.sizes ?? []) {
                const image = getFurniturePlanImage(definition.id, width, depth);
                if (!image) continue;
                expect(image.size, `${definition.id} ${width}×${depth}`).toEqual({ width, depth });
            }
        }
    });

    it("takes the closest image for a size typed by hand", () => {
        expect(getFurniturePlanImage("tv-console", 1400, 450)?.id).toBe("tv-console-1435");
        expect(getFurniturePlanImage("wardrobe-medium", 1000, 600)?.id).toBe("wardrobe-medium-900");
        expect(getFurniturePlanImage("kitchen-sink", 800, 600)).toBeUndefined();
    });
});
