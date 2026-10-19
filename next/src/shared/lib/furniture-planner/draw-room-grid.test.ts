import { describe, expect, it } from "vitest";

import {
    DRAW_ROOM_CONSTRUCTION_SNAP_MM,
    DRAW_ROOM_CONSTRUCTION_WALL_THICKNESS_MM,
    DRAW_ROOM_GRID_ORIGIN_MM,
    DRAW_ROOM_GRID_SNAP_MM,
    DRAW_ROOM_WALL_LANE_MM,
    getDrawRoomWallLane,
    getDrawRoomGridPresentation,
    resolveDrawRoomGridPresentationLevel,
    snapDrawRoomCoordinate,
} from "./draw-room-grid";

describe("draw room construction grid", () => {
    it("keeps the construction lattice at 50 mm regardless of visual density", () => {
        expect(DRAW_ROOM_GRID_SNAP_MM).toBe(50);
        expect(snapDrawRoomCoordinate(1_024)).toBe(1_000);
        expect(snapDrawRoomCoordinate(1_026)).toBe(1_050);
        expect(snapDrawRoomCoordinate(1_050)).toBe(1_050);
    });

    it("uses one 50 mm material lane with faces on the displayed grid", () => {
        expect(DRAW_ROOM_WALL_LANE_MM).toBe(50);
        const lane = getDrawRoomWallLane(1_000);
        expect(lane).toEqual({ centre: 1_000, start: 975, end: 1_025 });
        expect((lane.start - DRAW_ROOM_GRID_ORIGIN_MM) % DRAW_ROOM_GRID_SNAP_MM).toBe(0);
        expect((lane.end - DRAW_ROOM_GRID_ORIGIN_MM) % DRAW_ROOM_GRID_SNAP_MM).toBe(0);
    });

    it("keeps the legacy lane independent from the new 100 mm construction wall", () => {
        expect(DRAW_ROOM_WALL_LANE_MM).toBe(50);
        expect(DRAW_ROOM_CONSTRUCTION_WALL_THICKNESS_MM).toBe(100);
        expect(DRAW_ROOM_GRID_ORIGIN_MM).toBe(25);
    });

    it("keeps exact 10 mm canonical coordinates for a new constructive scene", () => {
        expect(DRAW_ROOM_CONSTRUCTION_SNAP_MM).toBe(10);
        expect(snapDrawRoomCoordinate(4_880, DRAW_ROOM_CONSTRUCTION_SNAP_MM)).toBe(4_880);
        expect(snapDrawRoomCoordinate(4_884, DRAW_ROOM_CONSTRUCTION_SNAP_MM)).toBe(4_880);
    });

    it("adds detail only when a construction cell is visually wide enough", () => {
        expect(getDrawRoomGridPresentation(2.5)).toMatchObject({
            minorStepMm: 12.5,
            mediumStepMm: 50,
        });
        expect(getDrawRoomGridPresentation(5)).toMatchObject({
            minorStepMm: 25,
            mediumStepMm: 50,
        });
    });

    it("culls dense lines at distant zoom while preserving a stable major rhythm", () => {
        expect(getDrawRoomGridPresentation(41)).toMatchObject({
            minorStepMm: 250,
            mediumStepMm: 1000,
            majorStepMm: 2000,
        });
    });

    it("holds each display level inside its hysteresis band during tiny zoom reversals", () => {
        expect(resolveDrawRoomGridPresentationLevel(13.2, "close")).toBe("close");
        expect(resolveDrawRoomGridPresentationLevel(13.2, "near")).toBe("near");

        expect(resolveDrawRoomGridPresentationLevel(6.5, "near")).toBe("near");
        expect(resolveDrawRoomGridPresentationLevel(6.5, "base")).toBe("base");

        expect(resolveDrawRoomGridPresentationLevel(2.35, "base")).toBe("base");
        expect(resolveDrawRoomGridPresentationLevel(2.35, "far")).toBe("far");

        expect(resolveDrawRoomGridPresentationLevel(1.15, "far")).toBe("far");
        expect(resolveDrawRoomGridPresentationLevel(1.15, "distant")).toBe("distant");
    });
});
