import { describe, expect, it } from "vitest";
import { suggestRoomKinds } from "./room-kind-suggestion";
import type { RoomForSuggestion } from "./room-kind-suggestion";

const room = (
    signature: string,
    areaM2: number,
    windowCount: number,
    sides: [number, number] = [3000, 3000],
): RoomForSuggestion => ({
    signature,
    areaM2,
    windowCount,
    shortSideMm: Math.min(...sides),
    longSideMm: Math.max(...sides),
});

const kinds = (rooms: RoomForSuggestion[]) =>
    Object.fromEntries(suggestRoomKinds(rooms).map((item) => [item.signature, item.kind]));

describe("room kind suggestion", () => {
    it("reads a two-room flat", () => {
        expect(
            kinds([
                room("big", 19, 1),
                room("small", 13, 1),
                room("kitchen", 8, 1),
                room("bath", 4, 0, [2000, 2000]),
                room("hall", 7, 0, [1400, 5000]),
            ]),
        ).toEqual({
            big: "living",
            small: "bedroom",
            kitchen: "kitchen",
            bath: "bathroom",
            hall: "hallway",
        });
    });

    it("reads a studio as one kitchen-living room", () => {
        expect(kinds([room("studio", 27, 2), room("bath", 4, 0)])).toEqual({
            studio: "kitchen-living",
            bath: "bathroom",
        });
    });

    it("makes a large room kitchen-living when no room looks like a kitchen", () => {
        expect(kinds([room("big", 32, 2), room("bed", 14, 1)])).toEqual({
            big: "kitchen-living",
            bed: "bedroom",
        });
    });

    it("keeps what the person chose and does not suggest over it", () => {
        const suggestions = suggestRoomKinds([
            { ...room("a", 19, 1), kind: "office" },
            { ...room("b", 8, 1), kind: "kitchen" },
            room("c", 15, 1),
        ]);

        expect(suggestions).toEqual([
            { signature: "c", kind: "living", reason: "самая большая комната" },
        ]);
    });

    it("explains every suggestion", () => {
        for (const suggestion of suggestRoomKinds([room("a", 19, 1), room("b", 8, 1)]))
            expect(suggestion.reason).not.toBe("");
    });
});
