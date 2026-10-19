import { describe, expect, it } from "vitest";

import {
    addDrawWallSegment,
    deriveDrawWallGraphRoom,
    getDrawWallComponents,
    getDrawRoomWallFaceContours,
    moveDrawWallContourSegment,
    moveDrawWallSegment,
    getDrawWallRun,
    moveDrawWallRun,
    resizeDrawWallRun,
    findMovedDrawWallContourEdge,
    resolveDrawWallAnchor,
    type DrawWallSegment,
} from "./draw-room-wall-graph";

const add = (segments: DrawWallSegment[], start: [number, number], end: [number, number]) => {
    const result = addDrawWallSegment(
        segments,
        { x: start[0], y: start[1] },
        { x: end[0], y: end[1] },
    );
    if (result.status === "invalid") throw new Error(result.message);
    return result.segments;
};

describe("free draw-wall graph", () => {
    it("derives a 50 mm clear inset from the true outer material envelope", () => {
        const faces = getDrawRoomWallFaceContours(
            [
                { x: 5000, y: 3200 },
                { x: 6950, y: 3200 },
                { x: 6950, y: 4400 },
                { x: 5000, y: 4400 },
            ],
            50,
        );

        const length = (start: DrawWallSegment["start"], end: DrawWallSegment["end"]) =>
            Math.abs(end.x - start.x) + Math.abs(end.y - start.y);

        expect(length(faces!.outerFaceContour[0], faces!.outerFaceContour[1])).toBe(2000);
        expect(length(faces!.outerFaceContour[1], faces!.outerFaceContour[2])).toBe(1250);
        expect(length(faces!.innerFaceContour[0], faces!.innerFaceContour[1])).toBe(1900);
        expect(length(faces!.innerFaceContour[1], faces!.innerFaceContour[2])).toBe(1150);
    });

    it("derives paired material faces instead of subtracting a room bounding box", () => {
        const contour = [
            { x: 1000, y: 1000 },
            { x: 5000, y: 1000 },
            { x: 5000, y: 4000 },
            { x: 3000, y: 4000 },
            { x: 3000, y: 2500 },
            { x: 1000, y: 2500 },
        ];

        const faces = getDrawRoomWallFaceContours(contour, 50);

        // The clear span is exterior - 2 × 50 mm. The re-entrant L-side also
        // keeps its own paired face rather than inheriting the outer box.
        expect(faces?.outerFaceContour[0]).toEqual({ x: 975, y: 975 });
        expect(faces?.innerFaceContour[0]).toEqual({ x: 1025, y: 1025 });
        expect(faces?.innerFaceContour[1]).toEqual({ x: 4975, y: 1025 });
        expect(faces?.outerFaceContour[3]).toEqual({ x: 2975, y: 4025 });
        expect(faces?.innerFaceContour[3]).toEqual({ x: 3025, y: 3975 });
    });
    it("keeps the cursor free, but snaps a nearby start to every 50 mm construction line", () => {
        const segments = add([], [1000, 1000], [5000, 1000]);

        expect(resolveDrawWallAnchor(segments, { x: 3000, y: 1225 })).toEqual({
            x: 3000,
            y: 1000,
        });
        expect(resolveDrawWallAnchor(segments, { x: 8000, y: 4200 })).toEqual({
            x: 8000,
            y: 4200,
        });
    });

    it("splits a wall at a T junction instead of leaving a visual overlap", () => {
        const first = add([], [1000, 1000], [5000, 1000]);
        const joined = add(first, [3000, 1000], [3000, 3500]);

        expect(joined).toHaveLength(3);
        expect(joined.filter((segment) => segment.start.y === segment.end.y)).toEqual([
            expect.objectContaining({ start: { x: 1000, y: 1000 }, end: { x: 3000, y: 1000 } }),
            expect.objectContaining({ start: { x: 3000, y: 1000 }, end: { x: 5000, y: 1000 } }),
        ]);
    });

    it("keeps split wall IDs unique when a saved graph already uses a split suffix", () => {
        const source: DrawWallSegment[] = [
            {
                id: "branch-wall-8",
                start: { x: 1000, y: 1000 },
                end: { x: 5000, y: 1000 },
            },
            {
                id: "branch-wall-8-split-2",
                start: { x: 8000, y: 1000 },
                end: { x: 8000, y: 3000 },
            },
        ];

        const result = addDrawWallSegment(source, { x: 3000, y: 1000 }, { x: 3000, y: 3000 });

        expect(result.status).toBe("success");
        if (result.status === "invalid") return;
        const ids = result.segments.map((segment) => segment.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(result.segments).toContainEqual(
            expect.objectContaining({
                id: "branch-wall-8-split-2-2",
                start: { x: 3000, y: 1000 },
                end: { x: 5000, y: 1000 },
            }),
        );
    });

    it("derives a handoff room from four independently ordered walls", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [6000, 4000], [6000, 1000]);
        segments = add(segments, [1000, 1000], [6000, 1000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        segments = add(segments, [6000, 4000], [1000, 4000]);

        const room = deriveDrawWallGraphRoom(segments);
        expect(room?.origin).toEqual({ x: 1025, y: 1025 });
        expect(room?.room.width).toBe(4950);
        expect(room?.room.depth).toBe(2950);
        expect(room?.room.geometry?.kind).toBe("rect");
    });

    it("recognises a four-wall rectangle immediately and keeps paired face sizes", () => {
        let segments: DrawWallSegment[] = [];
        const points: Array<[number, number]> = [
            [5000, 3200],
            [6950, 3200],
            [6950, 4400],
            [5000, 4400],
            [5000, 3200],
        ];
        points.slice(0, -1).forEach((point, index) => {
            segments = add(segments, point, points[index + 1]);
        });

        const room = deriveDrawWallGraphRoom(segments);
        expect(room?.room.geometry?.kind).toBe("rect");
        expect(room?.room.width).toBe(1900);
        expect(room?.room.depth).toBe(1150);
        const faces = getDrawRoomWallFaceContours(room?.contour ?? [], 50);
        expect(faces?.outerFaceContour).toEqual([
            { x: 4975, y: 3175 },
            { x: 6975, y: 3175 },
            { x: 6975, y: 4425 },
            { x: 4975, y: 4425 },
        ]);
        expect(faces?.innerFaceContour).toEqual([
            { x: 5025, y: 3225 },
            { x: 6925, y: 3225 },
            { x: 6925, y: 4375 },
            { x: 5025, y: 4375 },
        ]);
    });

    it("derives a 100 mm constructive wall model without changing the 50 mm snap graph", () => {
        let segments: DrawWallSegment[] = [];
        const points: Array<[number, number]> = [
            [1000, 1000],
            [4000, 1000],
            [4000, 1900],
            [1000, 1900],
            [1000, 1000],
        ];
        points.slice(0, -1).forEach((point, index) => {
            segments = add(segments, point, points[index + 1]);
        });

        const room = deriveDrawWallGraphRoom(segments, 100);

        // The graph remains on its 50 mm construction coordinates. Only the
        // physical material faces move 50 mm to either side of that graph.
        expect(room?.contour).toEqual(points.slice(0, -1).map(([x, y]) => ({ x, y })));
        expect(room?.room.wallThickness).toBe(100);
        expect(room?.origin).toEqual({ x: 1050, y: 1050 });
        expect(room?.room.width).toBe(2900);
        expect(room?.room.depth).toBe(800);
        expect(room?.outerFaceContour).toEqual([
            { x: 950, y: 950 },
            { x: 4050, y: 950 },
            { x: 4050, y: 1950 },
            { x: 950, y: 1950 },
        ]);
        expect(room?.innerContour).toEqual([
            { x: 1050, y: 1050 },
            { x: 3950, y: 1050 },
            { x: 3950, y: 1850 },
            { x: 1050, y: 1850 },
        ]);
    });

    it("accepts 10 mm graph coordinates for the 310 × 98 / 290 × 78 construction", () => {
        let segments: DrawWallSegment[] = [];
        const points: Array<[number, number]> = [
            [1000, 4000],
            [4000, 4000],
            [4000, 4880],
            [1000, 4880],
            [1000, 4000],
        ];
        points.slice(0, -1).forEach((point, index) => {
            const result = addDrawWallSegment(
                segments,
                { x: point[0], y: point[1] },
                { x: points[index + 1][0], y: points[index + 1][1] },
                10,
            );
            if (result.status === "invalid") throw new Error(result.message);
            segments = result.segments;
        });

        const room = deriveDrawWallGraphRoom(segments, 100);
        expect(room?.room).toMatchObject({ width: 2900, depth: 780, wallThickness: 100 });
        expect(room?.outerFaceContour[2]).toEqual({ x: 4050, y: 4930 });
        expect(room?.innerContour[2]).toEqual({ x: 3950, y: 4830 });
    });

    it("recognises a closed compact L contour without applying planner size rules", () => {
        let segments: DrawWallSegment[] = [];
        // This matches the compact geometry from the reported drawing: every
        // segment is safe (>= 500 mm), but the overall 2.2 × 1.2 m envelope
        // remains intentionally below the furniture planner's 2.4 m minimum.
        segments = add(segments, [4500, 3000], [6700, 3000]);
        segments = add(segments, [6700, 3000], [6700, 4200]);
        segments = add(segments, [6700, 4200], [5750, 4200]);
        segments = add(segments, [5750, 4200], [5750, 3500]);
        segments = add(segments, [5750, 3500], [4500, 3500]);
        segments = add(segments, [4500, 3500], [4500, 3000]);

        const room = deriveDrawWallGraphRoom(segments);
        expect(room?.origin).toEqual({ x: 4525, y: 3025 });
        expect(room?.room.width).toBe(2150);
        expect(room?.room.depth).toBe(1150);
        expect(room?.room.geometry).toMatchObject({ kind: "orthogonal" });
        expect(
            room?.room.geometry?.kind === "orthogonal" && room.room.geometry.vertices,
        ).toHaveLength(6);
    });

    it("keeps a valid cycle when a T branch is attached to one of its walls", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [1000, 1000], [5000, 1000]);
        segments = add(segments, [5000, 1000], [5000, 4000]);
        segments = add(segments, [5000, 4000], [1000, 4000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        // The added exterior branch splits the top edge in graph storage, but
        // it must not make the underlying rectangle cease to be a room.
        segments = add(segments, [3000, 1000], [3000, 500]);

        const room = deriveDrawWallGraphRoom(segments);
        expect(room?.room.geometry?.kind).toBe("rect");
        expect(room?.room.width).toBe(3950);
        expect(room?.room.depth).toBe(2950);
    });

    it("keeps the outer room when an interior divider joins two perimeter walls", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [1000, 1000], [5000, 1000]);
        segments = add(segments, [5000, 1000], [5000, 4000]);
        segments = add(segments, [5000, 4000], [1000, 4000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        segments = add(segments, [3000, 1000], [3000, 4000]);

        const room = deriveDrawWallGraphRoom(segments);

        expect(room?.room.geometry?.kind).toBe("rect");
        expect(room?.room.width).toBe(3950);
        expect(room?.room.depth).toBe(2950);
        expect(room?.contour).toEqual([
            { x: 1000, y: 1000 },
            { x: 5000, y: 1000 },
            { x: 5000, y: 4000 },
            { x: 1000, y: 4000 },
        ]);
    });

    it("slides a contour wall as one wall and keeps its attached T node connected", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [1000, 1000], [5000, 1000]);
        segments = add(segments, [5000, 1000], [5000, 4000]);
        segments = add(segments, [5000, 4000], [1000, 4000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        segments = add(segments, [3000, 1000], [3000, 500]);
        const contour = deriveDrawWallGraphRoom(segments)?.contour;
        expect(contour).toBeDefined();

        const moved = moveDrawWallContourSegment(segments, contour!, 0, { x: 3000, y: 1500 });
        expect(moved.status).toBe("success");
        if (moved.status === "invalid") return;

        expect(moved.segments).toContainEqual(
            expect.objectContaining({ start: { x: 3000, y: 1500 }, end: { x: 3000, y: 500 } }),
        );
        expect(deriveDrawWallGraphRoom(moved.segments)?.contour).toEqual([
            { x: 1000, y: 1500 },
            { x: 5000, y: 1500 },
            { x: 5000, y: 4000 },
            { x: 1000, y: 4000 },
        ]);
    });

    it("moves an interior wall together with both of its T-junctions", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [1000, 1000], [5000, 1000]);
        segments = add(segments, [5000, 1000], [5000, 4000]);
        segments = add(segments, [5000, 4000], [1000, 4000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        segments = add(segments, [3000, 1000], [3000, 4000]);
        const branch = segments.find(
            (segment) =>
                segment.start.x === 3000 &&
                segment.end.x === 3000 &&
                Math.min(segment.start.y, segment.end.y) === 1000 &&
                Math.max(segment.start.y, segment.end.y) === 4000,
        );
        expect(branch).toBeDefined();

        const moved = moveDrawWallSegment(segments, branch!.id, { x: 3500, y: 2500 });
        expect(moved.status).toBe("success");
        if (moved.status === "invalid") return;

        expect(moved.segments).toContainEqual(
            expect.objectContaining({
                id: branch!.id,
                start: { x: 3500, y: 1000 },
                end: { x: 3500, y: 4000 },
            }),
        );
        expect(
            moved.segments.filter(
                (segment) =>
                    segment.start.y === 1000 &&
                    segment.end.y === 1000 &&
                    (segment.start.x === 3500 || segment.end.x === 3500),
            ),
        ).toHaveLength(2);
        expect(
            moved.segments.filter(
                (segment) =>
                    segment.start.y === 4000 &&
                    segment.end.y === 4000 &&
                    (segment.start.x === 3500 || segment.end.x === 3500),
            ),
        ).toHaveLength(2);
        expect(deriveDrawWallGraphRoom(moved.segments)).not.toBeNull();
    });

    it("moves a selected wall end through its adjacent wall while the opposite end stays fixed", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [1000, 1000], [5000, 1000]);
        segments = add(segments, [5000, 1000], [5000, 4000]);
        segments = add(segments, [5000, 4000], [1000, 4000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        const contour = deriveDrawWallGraphRoom(segments)?.contour;
        expect(contour).toBeDefined();

        // The top handle of the right-hand wall translates the adjacent top
        // wall. The right-hand wall's lower joint stays at 5 000 × 4 000.
        const moved = moveDrawWallContourSegment(segments, contour!, 0, { x: 3000, y: 1500 });
        expect(moved.status).toBe("success");
        if (moved.status === "invalid") return;

        expect(moved.segments).toContainEqual(
            expect.objectContaining({ start: { x: 5000, y: 1500 }, end: { x: 5000, y: 4000 } }),
        );
        expect(
            moved.segments.some(
                (segment) =>
                    segment.start.x === 1000 &&
                    segment.end.x === 1000 &&
                    [segment.start.y, segment.end.y]
                        .sort((first, second) => first - second)
                        .join(",") === "1500,4000",
            ),
        ).toBe(true);
    });

    it("does not accept a wall move that makes an attached wall shorter than 500 mm", () => {
        let segments: DrawWallSegment[] = [];
        segments = add(segments, [1000, 1000], [5000, 1000]);
        segments = add(segments, [5000, 1000], [5000, 4000]);
        segments = add(segments, [5000, 4000], [1000, 4000]);
        segments = add(segments, [1000, 4000], [1000, 1000]);
        const contour = deriveDrawWallGraphRoom(segments)?.contour;
        expect(contour).toBeDefined();

        expect(moveDrawWallContourSegment(segments, contour!, 0, { x: 3000, y: 3550 })).toEqual(
            expect.objectContaining({ status: "invalid" }),
        );
    });

    it("does not skip the neighbouring 50 mm cell for free wall nodes", () => {
        const segments = add([], [1000, 1000], [1500, 1000]);

        expect(resolveDrawWallAnchor(segments, { x: 1050, y: 1400 })).toEqual({
            x: 1050,
            y: 1400,
        });
    });

    it("rejects a reversed duplicate without discarding the established graph", () => {
        const segments = add([], [1000, 1000], [5000, 1000]);
        expect(addDrawWallSegment(segments, { x: 5000, y: 1000 }, { x: 1000, y: 1000 })).toEqual({
            status: "invalid",
            message: "Такая стена уже есть на чертеже.",
        });
        expect(segments).toHaveLength(1);
    });

    it("rejects a partially overlapping collinear segment before it can create a doubled seam", () => {
        const segments = add([], [1000, 1000], [5000, 1000]);
        expect(addDrawWallSegment(segments, { x: 3000, y: 1000 }, { x: 6500, y: 1000 })).toEqual({
            status: "invalid",
            message: "Эта стена накладывается на существующую. Начните её от свободного конца.",
        });
    });
});

describe("opening hosts after contour reordering", () => {
    it("tracks every physical wall when moving a ledge changes the first contour corner", () => {
        const points = [
            { x: 7000, y: 2000 },
            { x: 11000, y: 2000 },
            { x: 11000, y: 7000 },
            { x: 3000, y: 7000 },
            { x: 3000, y: 3000 },
            { x: 7000, y: 3000 },
        ];
        const source = points.map((start, index) => ({
            id: `wall-${index}`,
            start,
            end: points[(index + 1) % points.length],
        }));
        const before = deriveDrawWallGraphRoom(source, 100)!;
        const moved = moveDrawWallContourSegment(
            source,
            before.contour,
            0,
            { x: 9000, y: 3500 },
            100,
        );
        expect(moved.status).toBe("success");
        if (moved.status !== "success") throw new Error(moved.message);
        const after = deriveDrawWallGraphRoom(moved.segments, 100)!;
        expect(after.contour[0]).toEqual({ x: 3000, y: 3000 });
        expect(
            before.contour.map((_, index) =>
                findMovedDrawWallContourEdge(
                    source,
                    moved.segments,
                    before.contour,
                    after.contour,
                    index,
                ),
            ),
        ).toEqual([2, 3, 4, 5, 0, 1]);
        expect(findMovedDrawWallContourEdge(source, [], before.contour, after.contour, 1)).toBe(-1);
    });
});

describe("moving only the selected span at T-junctions", () => {
    it.each([false, true])(
        "moves only the selected span and its two end walls (vertical=%s)",
        (vertical) => {
            const point = (x: number, y: number) => (vertical ? { x: y, y: x } : { x, y });
            const wall = (
                id: string,
                x1: number,
                y1: number,
                x2: number,
                y2: number,
            ): DrawWallSegment => ({ id, start: point(x1, y1), end: point(x2, y2) });
            const source = [
                wall("right-span", 5000, 2000, 3000, 2000),
                wall("selected", 1000, 2000, 2000, 2000),
                wall("middle-span", 2000, 2000, 3000, 2000),
                wall("left", 1000, 1000, 1000, 2000),
                wall("divider", 2000, 1000, 2000, 2000),
                wall("right", 5000, 1000, 5000, 2000),
                wall("top", 1000, 1000, 2000, 1000),
                wall("top-right", 2000, 1000, 5000, 1000),
                wall("separate", 5500, 2000, 6500, 2000),
            ];
            const moved = moveDrawWallSegment(source, "selected", point(1500, 2300));
            if (moved.status !== "success") throw new Error(moved.message);
            expect(moved.segments).toContainEqual(wall("selected", 1000, 2300, 2000, 2300));
            expect(moved.segments).toContainEqual(wall("left", 1000, 1000, 1000, 2300));
            // The old divider remains connected to the stationary right span;
            // a short extension continues it down to the selected wall.
            expect(moved.segments).toContainEqual(source.find((s) => s.id === "divider"));
            expect(moved.segments).toContainEqual(
                expect.objectContaining({ start: point(2000, 2000), end: point(2000, 2300) }),
            );
            for (const id of [
                "right-span",
                "middle-span",
                "right",
                "top",
                "top-right",
                "separate",
            ]) {
                expect(moved.segments).toContainEqual(source.find((s) => s.id === id));
            }
            expect(deriveDrawWallGraphRoom(moved.segments)).not.toBeNull();
        },
    );
});

describe("independent drawing buildings", () => {
    it("groups unordered connected walls and partitions without mixing detached buildings", () => {
        const source: DrawWallSegment[] = [
            { id: "a-top", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
            { id: "b-top", start: { x: 3000, y: 0 }, end: { x: 4000, y: 0 } },
            { id: "a-left", start: { x: 0, y: 1000 }, end: { x: 0, y: 0 } },
            { id: "b-right", start: { x: 4000, y: 0 }, end: { x: 4000, y: 1000 } },
            { id: "a-bottom", start: { x: 1000, y: 1000 }, end: { x: 0, y: 1000 } },
            { id: "a-right", start: { x: 1000, y: 0 }, end: { x: 1000, y: 1000 } },
        ];
        const groups = (walls: DrawWallSegment[]) =>
            getDrawWallComponents(walls)
                .map((component) => component.map((wall) => wall.id).sort())
                .sort((a, b) => a[0].localeCompare(b[0]));
        expect(groups(source)).toEqual([
            ["a-bottom", "a-left", "a-right", "a-top"],
            ["b-right", "b-top"],
        ]);
        expect(groups([...source].reverse())).toEqual(groups(source));
        expect(getDrawWallComponents([])).toEqual([]);
    });
});

describe("short existing boundary fragments beside openings", () => {
    it.each([750, 1250])(
        "moves a 350 mm fragment to y=%s and keeps the neighbouring opening host",
        (y) => {
            const wall = (
                id: string,
                x1: number,
                y1: number,
                x2: number,
                y2: number,
            ): DrawWallSegment => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
            const source = [
                wall("short", 1000, 1000, 1350, 1000),
                wall("door-wall", 1350, 1000, 5000, 1000),
                wall("right", 5000, 1000, 5000, 3000),
                wall("bottom", 5000, 3000, 1350, 3000),
                wall("bottom-short", 1350, 3000, 1000, 3000),
                wall("left", 1000, 3000, 1000, 1000),
                wall("partition", 1350, 1000, 1350, 3000),
            ];
            const before = deriveDrawWallGraphRoom(source)!;
            const moved = moveDrawWallSegment(source, "short", { x: 1175, y });
            if (moved.status !== "success") throw new Error(moved.message);
            expect(moved.segments).toContainEqual(wall("short", 1000, y, 1350, y));
            expect(moved.segments).toContainEqual(source[1]);
            const after = deriveDrawWallGraphRoom(moved.segments)!;
            expect(after).not.toBeNull();
            const index = findMovedDrawWallContourEdge(
                source,
                moved.segments,
                before.contour,
                after.contour,
                0,
                { x: 3500, y: 1025 },
            );
            expect(index).toBeGreaterThanOrEqual(0);
            expect(after.contour[index].y).toBe(1000);
            expect(after.contour[(index + 1) % after.contour.length].y).toBe(1000);
        },
    );
});

describe("continuous wall editing", () => {
    const chain: DrawWallSegment[] = [
        { id: "a", start: { x: 0, y: 1000 }, end: { x: 2000, y: 1000 } },
        { id: "b", start: { x: 4000, y: 1000 }, end: { x: 2000, y: 1000 } },
        { id: "c", start: { x: 4000, y: 1000 }, end: { x: 6000, y: 1000 } },
    ];
    it("selects the complete run from any constituent and excludes gaps and branches", () => {
        const source = [
            ...chain,
            { id: "gap", start: { x: 6500, y: 1000 }, end: { x: 7500, y: 1000 } },
            { id: "branch", start: { x: 2000, y: 1000 }, end: { x: 2000, y: 3000 } },
        ];
        for (const item of chain)
            expect(getDrawWallRun(source, item.id)).toMatchObject({
                start: { x: 0, y: 1000 },
                end: { x: 6000, y: 1000 },
                segmentIds: expect.arrayContaining(["a", "b", "c"]),
            });
        expect(getDrawWallRun(source, "b")?.segmentIds).toHaveLength(3);
    });
    it("shortens across an old seam, preserving remaining IDs and the opposite end", () => {
        const result = resizeDrawWallRun(chain, "a", "start", { x: 2500, y: 3000 }, 50);
        expect(result).toMatchObject({
            status: "success",
            segments: [
                { id: "b", start: { x: 4000, y: 1000 }, end: { x: 2500, y: 1000 } },
                chain[2],
            ],
        });
    });
    it("moves the whole chain and its T junction", () => {
        const result = moveDrawWallRun(
            [...chain, { id: "branch", start: { x: 2000, y: 1000 }, end: { x: 2000, y: 3000 } }],
            "b",
            { x: 3000, y: 1500 },
        );
        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(
                result.segments
                    .filter((s) => s.id !== "branch")
                    .every((s) => s.start.y === 1500 && s.end.y === 1500),
            ).toBe(true);
            expect(result.segments.find((s) => s.id === "branch")?.start.y).toBe(1500);
        }
    });
    it("rejects cutting off a junction and collapsing a wall", () => {
        const source = [
            ...chain,
            { id: "branch", start: { x: 2000, y: 1000 }, end: { x: 2000, y: 3000 } },
        ];
        expect(resizeDrawWallRun(source, "a", "start", { x: 2500, y: 1000 }).status).toBe(
            "invalid",
        );
        expect(resizeDrawWallRun(chain, "b", "end", { x: 100, y: 1000 }).status).toBe("invalid");
    });
    it("extends a vertical wall without losing reversed segment identity", () => {
        const vertical = chain.map((s) => ({
            ...s,
            start: { x: s.start.y, y: s.start.x },
            end: { x: s.end.y, y: s.end.x },
        }));
        const result = resizeDrawWallRun(vertical, "b", "end", { x: 1000, y: 8000 });
        expect(result.status).toBe("success");
        if (result.status === "success")
            expect(getDrawWallRun(result.segments, "a")?.end).toEqual({ x: 1000, y: 8000 });
    });
});
