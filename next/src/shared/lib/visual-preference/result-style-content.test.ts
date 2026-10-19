import { describe, expect, it } from "vitest";
import { STYLE_PROFILES } from ".";
import {
    STYLE_RESULT_CONTENT,
    STYLE_RESULT_ROOM_ORDER,
    getStyleResultContent,
} from "./result-style-content";

describe("style result content", () => {
    it("covers every selectable style exactly once", () => {
        expect(Object.keys(STYLE_RESULT_CONTENT).sort()).toEqual(
            Object.keys(STYLE_PROFILES).sort(),
        );

        for (const styleKey of Object.keys(STYLE_PROFILES)) {
            const content = getStyleResultContent(styleKey);

            expect(content?.description).toHaveLength(3);
            expect(content?.description.every((paragraph) => paragraph.trim().length > 0)).toBe(
                true,
            );
        }
    });

    it("keeps the fixed room sequence and semantic image paths for every style", () => {
        for (const [styleKey, content] of Object.entries(STYLE_RESULT_CONTENT)) {
            expect(content.rooms.map((room) => room.key)).toEqual(STYLE_RESULT_ROOM_ORDER);
            expect(content.rooms.map((room) => room.label)).toEqual([
                "Гостиная",
                "Спальня",
                "Детская",
            ]);
            expect(content.rooms.map((room) => room.imagePath)).toEqual([
                `/images/Home/style-results.20260827-v1/${styleKey}/living-room.webp`,
                `/images/Home/style-results.20260827-v1/${styleKey}/bedroom.webp`,
                `/images/Home/style-results.20260827-v1/${styleKey}/children-room.webp`,
            ]);
        }
    });
});
