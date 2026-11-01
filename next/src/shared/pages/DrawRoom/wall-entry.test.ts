import {
    addDrawWallSegment,
    deriveDrawWallGraphRoom,
    getDrawRoomWallFaceContours,
    validateRoomGeometry,
    type DrawWallSegment,
} from "@/shared/lib/furniture-planner";
import { describe, expect, it } from "vitest";
import {
    moveWallEnd,
    nextWallChainStep,
    resolveTypedWall,
    type WallChainStep,
    type WallEntryPoint,
} from "./wall-entry";

const right = { x: 1, y: 0 };
const left = { x: -1, y: 0 };
const down = { x: 0, y: 1 };
const up = { x: 0, y: -1 };

/** Types a chain as a person would, wall by wall, and returns the graph. */
const typeChain = (
    walls: Array<[WallEntryPoint, number]>,
    thickness = 100,
    origin = { x: 1003, y: 2007 },
) => {
    let segments: DrawWallSegment[] = [];
    let start = origin;
    let previous: WallChainStep | null = null;
    for (const [direction, innerLength] of walls) {
        const wall = resolveTypedWall({
            start,
            direction,
            innerLength,
            thickness,
            partition: false,
            attached: false,
            previous,
        });
        if (previous && (wall.start.x !== start.x || wall.start.y !== start.y)) {
            segments = moveWallEnd(segments, start, previous.direction, wall.start)!;
        }
        const added = addDrawWallSegment(segments, wall.start, wall.end, 1);
        if (added.status === "invalid") throw new Error(added.message);
        segments = added.segments;
        previous = nextWallChainStep(previous, direction, true);
        start = wall.end;
    }
    return { segments, end: start };
};

const span = (values: number[]) => Math.max(...values) - Math.min(...values);

describe("typed wall lengths", () => {
    it("builds a room of exactly the typed clear size, to the millimetre", () => {
        const { segments, end } = typeChain([
            [right, 4213],
            [down, 3177],
            [left, 4213],
            [up, 3177],
        ]);
        expect(end).toEqual({ x: 1003, y: 2007 });
        const room = deriveDrawWallGraphRoom(segments, 100);
        expect(room).not.toBeNull();
        const inner = getDrawRoomWallFaceContours(room!.contour, 100)!.innerFaceContour;
        expect(span(inner.map((point) => point.x))).toBe(4213);
        expect(span(inner.map((point) => point.y))).toBe(3177);
    });

    it("gives the same room when drawn the other way round", () => {
        const { segments, end } = typeChain([
            [down, 3177],
            [right, 4213],
            [up, 3177],
            [left, 4213],
        ]);
        expect(end).toEqual({ x: 1003, y: 2007 });
        const room = deriveDrawWallGraphRoom(segments, 100);
        const inner = getDrawRoomWallFaceContours(room!.contour, 100)!.innerFaceContour;
        expect(span(inner.map((point) => point.x))).toBe(4213);
        expect(span(inner.map((point) => point.y))).toBe(3177);
    });

    it("keeps clear sizes around the inward corner of an L-shaped room", () => {
        const { segments, end } = typeChain([
            [right, 4000],
            [down, 2000],
            [left, 1500],
            [down, 1000],
            [left, 2500],
            [up, 3000],
        ]);
        expect(end).toEqual({ x: 1003, y: 2007 });
        const room = deriveDrawWallGraphRoom(segments, 100);
        const inner = getDrawRoomWallFaceContours(room!.contour, 100)!.innerFaceContour;
        expect(span(inner.map((point) => point.x))).toBe(4000);
        expect(span(inner.map((point) => point.y))).toBe(3000);
    });

    it("keeps an off-grid L-shaped room valid for doors, drafts and the solver", () => {
        const { segments } = typeChain([
            [right, 4213],
            [down, 2007],
            [left, 1503],
            [down, 1001],
            [left, 2710],
            [up, 3008],
        ]);
        const room = deriveDrawWallGraphRoom(segments, 100);
        expect(room).not.toBeNull();
        expect(validateRoomGeometry(room!.room)).toBeNull();
    });

    it("accepts a whole flat wider than ten metres", () => {
        const { segments } = typeChain([
            [right, 15000],
            [down, 8000],
            [left, 15000],
            [up, 8000],
        ]);
        const room = deriveDrawWallGraphRoom(segments, 100);
        expect(room).not.toBeNull();
        expect(validateRoomGeometry(room!.room)).toBeNull();
    });

    it("measures a partition from the face of the wall it starts on", () => {
        const request = {
            start: { x: 0, y: 0 },
            direction: right,
            innerLength: 2000,
            thickness: 100,
            partition: true,
            previous: null,
        };
        expect(resolveTypedWall({ ...request, attached: true }).end).toEqual({ x: 2050, y: 0 });
        expect(resolveTypedWall({ ...request, attached: false }).end).toEqual({ x: 2000, y: 0 });
    });

    it("leaves the corner alone after a clicked wall", () => {
        const previous = nextWallChainStep(null, right, false);
        const wall = resolveTypedWall({
            start: { x: 4000, y: 0 },
            direction: down,
            innerLength: 3000,
            thickness: 100,
            partition: false,
            attached: false,
            previous,
        });
        expect(wall.start).toEqual({ x: 4000, y: 0 });
        expect(wall.end).toEqual({ x: 4000, y: 3100 });
    });
});
