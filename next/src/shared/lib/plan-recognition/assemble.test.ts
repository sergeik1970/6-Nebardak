import { describe, expect, it } from "vitest";
import { validateRoomGeometry } from "@/shared/lib/furniture-planner/geometry";
import { getDrawRoomRegions } from "@/shared/lib/furniture-planner/room-regions";
import { deriveDrawWallGraphRoom } from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import { apartmentToDrawingScene } from "@/shared/pages/DrawRoom/apartment-from-plan";
import { apartmentFromModel } from "./apartment";
import { assembleApartment } from "./assemble";

const rect = (x: number, y: number, width: number, depth: number) => [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
];

const readRooms = (rooms: Record<string, unknown>[]) => {
    const parsed = apartmentFromModel({ rooms });
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed.rooms;
};

/** The editor's view of the drawing: its rooms with areas, names and kinds. */
const openInEditor = (rooms: Record<string, unknown>[]) => {
    const assembled = assembleApartment(readRooms(rooms));
    if (!assembled) throw new Error("not assembled");
    const imported = apartmentToDrawingScene(assembled);
    if (!imported) throw new Error("no drawing");
    const derived = deriveDrawWallGraphRoom(imported.scene.segments, imported.scene.wallThickness)!;
    return { imported, derived };
};

describe("a whole apartment rebuilt from a plan", () => {
    it("turns two rooms 150 mm apart into one flat with a partition between them", () => {
        const { imported } = openInEditor([
            {
                name: "Спальня",
                contour: rect(0, 0, 4000, 3000),
                openings: [
                    { kind: "window", wall: 0, offset: 1000, width: 1500 },
                    { kind: "door", wall: 1, offset: 1000, width: 800 },
                ],
            },
            {
                name: "Гостиная",
                contour: rect(4150, 0, 5000, 3000),
                openings: [{ kind: "door", wall: 3, offset: 1200, width: 800 }],
            },
        ]);

        const partitions = imported.scene.segments.filter((segment) => segment.thickness);
        expect(partitions).toHaveLength(1);
        expect(partitions[0].thickness).toBe(150);
        expect(imported).toMatchObject({ rooms: 2, named: 2 });
        expect(imported.scene.regions?.items.map((item) => [item.name, item.kind]).sort()).toEqual([
            ["Гостиная", "living"],
            ["Спальня", "bedroom"],
        ]);
        // The door both rooms list is placed once, in the partition.
        expect(imported.scene.doors).toHaveLength(1);
        expect(imported.scene.doors[0].partitionId).toBeDefined();
        expect(imported.scene.windows).toHaveLength(1);
    });

    it("keeps each room's area and passes the planner's checks", () => {
        const { imported } = openInEditor([
            { name: "Кухня", contour: rect(0, 0, 3000, 3000), openings: [] },
            { name: "Комната", contour: rect(3100, 0, 4000, 4500), openings: [] },
            { name: "Коридор", contour: rect(0, 3100, 3000, 1400), openings: [] },
        ]);
        const partitions = imported.scene.segments.filter((segment) => segment.thickness);
        expect(partitions.length).toBeGreaterThanOrEqual(2);
        expect(validateRoomGeometry(imported.room)).toBeNull();
        const { regions } = imported.scene;
        expect(regions?.items).toHaveLength(3);
        expect(imported.rooms).toBe(3);
        const areas = getDrawRoomRegions({ ...imported.room, regions })
            .map((region) => Math.round(region.areaSquareMillimeters / 100_000) / 10)
            .sort((a, b) => a - b);
        // Rebuilt on the 50 mm grid: within a few percent of 4.2, 9 and 18 m².
        expect(areas[0]).toBeCloseTo(4.2, 0);
        expect(areas[1]).toBeCloseTo(9, 0);
        expect(areas[2]).toBeCloseTo(18, 0);
    });

    it("straightens a wall the model drew with a small step", () => {
        const { derived } = openInEditor([
            { name: "Комната 1", contour: rect(0, 0, 4000, 3000), openings: [] },
            { name: "Комната 2", contour: rect(0, 3100, 2000, 3000), openings: [] },
            // Its face is 100 mm off its neighbour's: the outer wall must stay straight.
            { name: "Комната 3", contour: rect(2100, 3100, 1900, 2900), openings: [] },
        ]);
        expect(validateRoomGeometry({ ...derived.room, doors: [], windows: [] })).toBeNull();
    });

    it("leaves out a room the model could not size", () => {
        const assembled = assembleApartment(
            readRooms([
                { name: "Комната", contour: rect(0, 0, 4000, 3000), openings: [] },
                { name: "Туалет", contour: null, openings: [] },
            ]),
        );
        expect(assembled?.skipped).toEqual(["Туалет"]);
        expect(assembled?.rooms).toHaveLength(1);
    });
});
