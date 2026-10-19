import { describe, expect, it } from "vitest";

import { validateRoomGeometry } from "./geometry";
import {
    alignStarterOpeningsToRoom,
    createDefaultRoom,
    resizeRoom,
    resizeRoomWithDefaultOpenings,
    tryResizeRoomWithDefaultOpenings,
} from "./room";
import { Room } from "./types";
import {
    applyRoomGeometry,
    createLRoomGeometry,
    getLRoomNotch,
    moveOrthogonalRoomVertex,
    validateOrthogonalRoomGeometry,
} from "./room-geometry";

describe("room resize trust boundary", () => {
    it("preserves every opening coordinate and surfaces an invalid smaller room", () => {
        const original: Room = {
            width: 6000,
            depth: 5000,
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 5000,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
            windows: [{ id: "window", wall: "top", offset: 4200, width: 1200 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "right",
                    offset: 3000,
                    width: 1000,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        };

        const resized = resizeRoom(original, 5000, 3500);

        expect(resized.doors).toEqual(original.doors);
        expect(resized.windows).toEqual(original.windows);
        expect(resized.radiators).toEqual(original.radiators);
        expect(resized.doors[0].offset).toBe(5000);
        expect(resized.windows[0].offset).toBe(4200);
        expect(resized.radiators?.[0].offset).toBe(3000);
        expect(validateRoomGeometry(resized)).not.toBeNull();
    });
});

describe("adaptive starter openings", () => {
    it("repositions only untouched default openings when the room changes", () => {
        const resized = resizeRoomWithDefaultOpenings(createDefaultRoom(6000, 4600), 7200, 5200);

        expect(resized).toEqual(createDefaultRoom(7200, 5200));
        expect(resized.windows[0]).toMatchObject({ offset: 2700, width: 1800 });
    });

    it("keeps a manually adjusted opening exactly where the user placed it", () => {
        const original = createDefaultRoom(6000, 4600);
        const manuallyAdjusted: Room = {
            ...original,
            windows: [{ ...original.windows[0], offset: 1800 }],
        };

        const resized = resizeRoomWithDefaultOpenings(manuallyAdjusted, 7200, 5200);

        expect(resized.windows).toEqual(manuallyAdjusted.windows);
        expect(resized.doors).toEqual(manuallyAdjusted.doors);
    });

    it("repairs an untouched standard starter opening after a prior resize", () => {
        const staleStarterRoom: Room = {
            ...createDefaultRoom(6000, 4600),
            width: 7200,
            depth: 5200,
        };

        expect(alignStarterOpeningsToRoom(staleStarterRoom)).toEqual(createDefaultRoom(7200, 5200));
    });
});

describe("orthogonal room resize", () => {
    it("keeps the L contour topology and opening segment anchors", () => {
        const original = applyRoomGeometry(
            createDefaultRoom(6000, 4600),
            createLRoomGeometry(6000, 4600, "right"),
        );

        const resized = resizeRoomWithDefaultOpenings(original, 7200, 5200);

        expect(resized.width).toBe(7200);
        expect(resized.depth).toBe(5200);
        expect(resized.geometry?.kind).toBe("orthogonal");
        expect(validateOrthogonalRoomGeometry(resized)).toBeNull();
        expect(getLRoomNotch(resized)).toEqual(getLRoomNotch(original));
        expect(resized.doors[0].segmentId).toBe(original.doors[0].segmentId);
        expect(resized.windows[0].segmentId).toBe(original.windows[0].segmentId);
    });

    it("rejects an unsafe custom shrink without replacing the room", () => {
        const original = applyRoomGeometry(
            createDefaultRoom(6000, 4600),
            createLRoomGeometry(6000, 4600, "right"),
        );

        const result = tryResizeRoomWithDefaultOpenings(original, 3000, 4600);

        expect(result).toMatchObject({ status: "invalid" });
    });

    it("surfaces a corner move that would shorten an anchored window", () => {
        const original = applyRoomGeometry(
            createDefaultRoom(6000, 4600),
            createLRoomGeometry(6000, 4600, "right"),
        );
        const result = moveOrthogonalRoomVertex(original, "v3", { x: 3550, y: 1850 });

        expect(result.status).toBe("success");
        if (result.status !== "success") return;
        expect(validateRoomGeometry({ ...original, geometry: result.geometry })).toContain("окно");
    });
});
