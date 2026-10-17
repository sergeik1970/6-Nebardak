import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { FURNITURE_ASSETS } from "./assets";
import { FURNITURE_CATALOG } from "./catalog";

describe("furniture asset manifest", () => {
    it("matches every immutable encoded file, alpha bound and rights record", async () => {
        const photographedDefinitions = FURNITURE_CATALOG.filter(
            (definition) => definition.assetKey !== undefined,
        );
        expect(Object.keys(FURNITURE_ASSETS)).toHaveLength(photographedDefinitions.length);
        let totalEncodedBytes = 0;

        for (const definition of photographedDefinitions) {
            const asset = FURNITURE_ASSETS[definition.assetKey!];
            const encoded = readFileSync(join(process.cwd(), "public", asset.src.slice(1)));
            const decoded = await sharp(encoded)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            expect(asset.src).toBe(`/images/planner/${definition.assetKey}.20260717-v2.webp`);
            expect(encoded.byteLength).toBe(asset.encodedBytes);
            expect(createHash("sha256").update(encoded).digest("hex")).toBe(asset.sha256);
            expect(decoded.info).toMatchObject({
                width: asset.pixelSize.width,
                height: asset.pixelSize.height,
                channels: 4,
            });
            expect(getAlphaBounds(decoded.data, decoded.info)).toEqual(asset.contentBounds);
            expect(asset.pixelSize.width).toBeGreaterThan(0);
            expect(asset.pixelSize.height).toBeGreaterThan(0);
            expect(asset.contentBounds.x).toBeGreaterThanOrEqual(0);
            expect(asset.contentBounds.y).toBeGreaterThanOrEqual(0);
            expect(asset.contentBounds.x + asset.contentBounds.width).toBeLessThanOrEqual(
                asset.pixelSize.width,
            );
            expect(asset.contentBounds.y + asset.contentBounds.height).toBeLessThanOrEqual(
                asset.pixelSize.height,
            );
            expect(asset.version).toBe("2026-07-17-v2");
            expect(asset.encoding).toEqual({
                format: "webp",
                quality: 90,
                alphaQuality: 100,
                exactTransparentRgb: true,
            });
            expect(asset.license).toMatchObject({
                source: "designer-supplied",
                status: "unverified",
            });
            totalEncodedBytes += encoded.byteLength;
        }

        expect(totalEncodedBytes).toBe(1_316_024);
        expect(totalEncodedBytes).toBeLessThanOrEqual(1_400_000);
    });
});

function getAlphaBounds(
    pixels: Buffer,
    info: { width: number; height: number; channels: number },
): { x: number; y: number; width: number; height: number } {
    let minimumX = info.width;
    let minimumY = info.height;
    let maximumX = -1;
    let maximumY = -1;

    for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
            const alpha = pixels[(y * info.width + x) * info.channels + 3];
            if (alpha === 0) continue;
            minimumX = Math.min(minimumX, x);
            minimumY = Math.min(minimumY, y);
            maximumX = Math.max(maximumX, x);
            maximumY = Math.max(maximumY, y);
        }
    }

    if (maximumX < minimumX || maximumY < minimumY) {
        throw new Error("Planner asset has no visible pixels");
    }

    return {
        x: minimumX,
        y: minimumY,
        width: maximumX - minimumX + 1,
        height: maximumY - minimumY + 1,
    };
}
