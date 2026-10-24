import { describe, expect, it } from "vitest";
import {
    getDrawRoomRegions,
    materializeRoomRegionsState,
    normalizeRoomRegionsState,
} from "./room-regions";
import type { Room } from "./types";

const room: Room = {
    width: 6000,
    depth: 4000,
    doors: [
        {
            id: "entry",
            wall: "bottom",
            offset: 400,
            width: 900,
            clearanceDepth: 900,
        },
    ],
    windows: [],
    partitions: [
        {
            id: "partition-main",
            start: { x: 3000, y: 0 },
            end: { x: 3000, y: 4000 },
            thickness: 50,
        },
    ],
};

describe("Draw Room named regions", () => {
    it("gives each region its own clear faces instead of the whole room span", () => {
        const [left, right] = getDrawRoomRegions(room);
        const lengths = (region: typeof left) =>
            region.clearEdges.map(
                ({ start, end }) => Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
            );
        expect(lengths(left).sort()).toEqual([2975, 2975, 4000, 4000]);
        expect(lengths(right).sort()).toEqual([2975, 2975, 4000, 4000]);
        // The partition face belongs to both rooms, each seeing it from its side.
        expect(left.clearEdges).toContainEqual({
            start: { x: 2975, y: 0 },
            end: { x: 2975, y: 4000 },
            inward: { x: -1, y: 0 },
        });
        expect(right.clearEdges).toContainEqual({
            start: { x: 3025, y: 0 },
            end: { x: 3025, y: 4000 },
            inward: { x: 1, y: 0 },
        });
    });

    it("outlines a partition stub with its two faces and its end", () => {
        const [region] = getDrawRoomRegions({
            ...room,
            partitions: [
                { id: "stub", start: { x: 3000, y: 0 }, end: { x: 3000, y: 1500 }, thickness: 50 },
            ],
        });
        const stubFaces = region.clearEdges.filter(
            ({ start, end }) => start.x > 0 && start.x < 6000 && start.x === end.x,
        );
        expect(stubFaces.map(({ start, end }) => end.y - start.y)).toEqual([1500, 1500]);
        expect(region.clearEdges).toContainEqual({
            start: { x: 2975, y: 1500 },
            end: { x: 3025, y: 1500 },
            inward: { x: 0, y: 1 },
        });
        // The top wall is split by the stub into two separate faces.
        const topFaces = region.clearEdges.filter(({ start, end }) => start.y === 0 && end.y === 0);
        expect(topFaces).toHaveLength(2);
    });

    it("derives two material-separated regions and carries a matching name by signature", () => {
        const initial = getDrawRoomRegions(room);
        expect(initial).toHaveLength(2);
        expect(initial.map((region) => region.name)).toEqual(["Помещение 1", "Помещение 2"]);
        expect(initial.map((region) => region.labelBounds)).toEqual([
            { left: 0, top: 0, right: 2975, bottom: 4000 },
            { left: 3025, top: 0, right: 6000, bottom: 4000 },
        ]);
        expect(initial.reduce((area, region) => area + region.areaSquareMillimeters, 0)).toBe(
            23_800_000,
        );

        const metadata = materializeRoomRegionsState(room);
        metadata.items[0].name = "Кухня";
        expect(getDrawRoomRegions({ ...room, regions: metadata })[0].name).toBe("Кухня");
    });

    it("uses full 100 mm partition material when calculating clean-face areas", () => {
        const constructiveRoom: Room = {
            width: 2900,
            depth: 780,
            wallThickness: 100,
            doors: [],
            windows: [],
            partitions: [
                {
                    id: "partition-100",
                    // The stored line is the material centreline; its two
                    // clean faces are 1.73 m and 1.07 m from the room faces.
                    start: { x: 1780, y: 0 },
                    end: { x: 1780, y: 780 },
                    thickness: 100,
                },
            ],
        };

        const regions = getDrawRoomRegions(constructiveRoom);

        // 1.73 × 0.78 m and 1.07 × 0.78 m are measured to clean faces. The
        // 10 cm partition belongs to neither room and openings do not alter
        // architectural zones.
        expect(regions.map((region) => region.areaSquareMillimeters)).toEqual([1_349_400, 834_600]);
        expect(regions.reduce((area, region) => area + region.areaSquareMillimeters, 0)).toBe(
            2_184_000,
        );
    });

    it("drops only malformed name metadata", () => {
        expect(
            normalizeRoomRegionsState({
                version: 1,
                items: [
                    { signature: "good", name: "Гостиная" },
                    { signature: "bad", name: "" },
                    { signature: "good", name: "Повтор" },
                ],
            }),
        ).toEqual({ version: 1, items: [{ signature: "good", name: "Гостиная" }] });
    });
});

describe("irregular rooms from the 470 cm drawing", () => {
    it("sums all clear-floor strips of the stepped room rather than its bounding rectangle", () => {
        // Inner faces, in mm. Independent horizontal-strip calculation:
        // 4250×450 + 2700×300 + 1300×50 + 250×550 + 600×550 = 3,255,000.
        const points = [
            [0, 0],
            [4250, 0],
            [4250, 450],
            [2700, 450],
            [2700, 800],
            [1650, 800],
            [1650, 1350],
            [2000, 1350],
            [2000, 1900],
            [1400, 1900],
            [1400, 750],
            [0, 750],
        ];
        for (const polygon of [points, [...points].reverse()]) {
            const stepped: Room = {
                width: 4250,
                depth: 1900,
                wallThickness: 50,
                doors: [],
                windows: [],
                geometry: {
                    version: 1,
                    kind: "orthogonal",
                    vertices: polygon.map(([x, y], i) => ({ id: `v${i}`, x, y })),
                },
            };
            const regions = getDrawRoomRegions(stepped);
            expect(regions).toHaveLength(1);
            expect(regions[0].areaSquareMillimeters).toBe(3_255_000);
        }
    });
    it("includes the narrow arm of an L-shaped room", () => {
        const lRoom: Room = {
            width: 1000,
            depth: 1550,
            doors: [],
            windows: [],
            geometry: {
                version: 1,
                kind: "orthogonal",
                vertices: [
                    [0, 0],
                    [300, 0],
                    [300, 800],
                    [1000, 800],
                    [1000, 1550],
                    [0, 1550],
                ].map(([x, y], i) => ({ id: `l${i}`, x, y })),
            },
        };
        expect(getDrawRoomRegions(lRoom)[0].areaSquareMillimeters).toBe(300 * 800 + 1000 * 750);
    });
});
