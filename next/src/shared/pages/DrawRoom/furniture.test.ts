import {
    getDoorFurnitureObstacles,
    type DoorOpening,
    type Room,
} from "@/shared/lib/furniture-planner";
import { describe, expect, it } from "vitest";
import {
    furnitureError,
    furnitureConflicts,
    furnitureWallDistances,
    furnitureGeometry,
    rotatedFurnitureCandidates,
    readFurniture,
    type DrawFurniture,
} from "./furniture";
const item: DrawFurniture = {
    id: "bed",
    definitionId: "single-bed",
    x: 1000,
    y: 1000,
    width: 900,
    depth: 2000,
    rotation: 0,
};
describe("furniture on the wall drawing", () => {
    it("preserves valid drafts while ignoring unknown, duplicate and malformed items", () => {
        expect(
            readFurniture([
                item,
                item,
                { ...item, id: "unknown", definitionId: "missing" },
                { ...item, id: "bad", width: -1 },
                { ...item, id: "angle", rotation: 45 },
            ]),
        ).toEqual([item]);
        expect(readFurniture(undefined)).toEqual([]);
    });
    it("scales body geometry and swaps extents when rotated", () => {
        const shape = furnitureGeometry({ ...item, width: 1200, depth: 2200, rotation: 90 });
        expect(shape.width).toBe(2200);
        expect(shape.depth).toBe(1200);
    });
    it("allows contact with a wall face but rejects intersection with its material", () => {
        const walls = [{ id: "wall", start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } }];
        expect(furnitureError({ ...item, y: 50 }, [], walls, 100)).toBeNull();
        expect(furnitureError({ ...item, y: 40 }, [], walls, 100)).toContain("стену");
    });
    it("ignores the moved item itself and rejects overlap with another item", () => {
        expect(furnitureError(item, [item], [], 100)).toBeNull();
        expect(furnitureError({ ...item, id: "other", x: 1100 }, [item], [], 100)).toContain(
            "мебелью",
        );
        expect(furnitureError({ ...item, id: "other", x: 1900 }, [item], [], 100)).toBeNull();
    });
});

describe("door clearance for drawing furniture", () => {
    const room: Room = { width: 6000, depth: 5000, doors: [], windows: [], wallThickness: 100 };
    const door: DoorOpening = {
        id: "door",
        wall: "top",
        offset: 2000,
        width: 900,
        clearanceDepth: 900,
        hinge: "start",
    };
    const box: DrawFurniture = {
        id: "box",
        definitionId: "bedside-table",
        x: 2200,
        y: 200,
        width: 300,
        depth: 300,
        rotation: 0,
    };
    it("blocks inward swing, accepts a destination clear of the door, and checks rotated furniture", () => {
        const obstacles = getDoorFurnitureObstacles(door, room);
        expect(furnitureError(box, [], [], 100, obstacles)).toContain("двер");
        expect(furnitureError({ ...box, x: 3100 }, [], [], 100, obstacles)).toBeNull();
        expect(
            furnitureError(
                { ...box, x: 1800, width: 100, depth: 600, rotation: 90 },
                [],
                [],
                100,
                obstacles,
            ),
        ).toContain("двер");
    });
    it("keeps access clear on both sides regardless of swing direction", () => {
        const obstacles = getDoorFurnitureObstacles({ ...door, swingDirection: "outward" }, room);
        expect(furnitureError({ ...box, y: -600 }, [], [], 100, obstacles)).toContain("двер");
        expect(furnitureError(box, [], [], 100, obstacles)).toContain("двер");
        expect(furnitureError({ ...box, y: 1000 }, [], [], 100, obstacles)).toBeNull();
    });
    it("blocks the sliding leaf travel next to the opening", () => {
        const obstacles = getDoorFurnitureObstacles(
            { ...door, doorKind: "sliding-single", slidingDirection: "end" },
            room,
        );
        expect(furnitureError({ ...box, x: 3100, y: 30 }, [], [], 100, obstacles)).toContain(
            "двер",
        );
    });
});

describe("door approach from either side of a partition", () => {
    it.each(["inward", "outward"] as const)(
        "protects both sides of a vertical doorway opening %s",
        (swingDirection) => {
            const room: Room = {
                width: 6000,
                depth: 5000,
                doors: [],
                windows: [],
                partitions: [
                    {
                        id: "partition",
                        start: { x: 3000, y: 0 },
                        end: { x: 3000, y: 5000 },
                        thickness: 100,
                    },
                ],
            };
            const door: DoorOpening = {
                id: "door",
                wall: "left",
                partitionId: "partition",
                offset: 1500,
                width: 900,
                clearanceDepth: 900,
                swingDirection,
            };
            const obstacles = getDoorFurnitureObstacles(door, room);
            const bed: DrawFurniture = {
                id: "bed",
                definitionId: "single-bed",
                x: 3200,
                y: 1400,
                width: 900,
                depth: 2000,
                rotation: 0,
            };
            expect(furnitureError(bed, [], [], 100, obstacles)).toContain("двер");
            expect(furnitureError({ ...bed, x: 1800 }, [], [], 100, obstacles)).toContain("двер");
            expect(furnitureError({ ...bed, x: 3900 }, [], [], 100, obstacles)).toBeNull();
            expect(furnitureError({ ...bed, x: 1200 }, [], [], 100, obstacles)).toBeNull();
        },
    );
});

describe("furniture rotation near obstacles", () => {
    it("turns around the centre when the old top-left pivot would hit a wall", () => {
        const bed: DrawFurniture = {
            id: "bed",
            definitionId: "single-bed",
            x: 3000,
            y: 3000,
            width: 900,
            depth: 2000,
            rotation: 0,
        };
        const walls = [{ id: "wall", start: { x: 4500, y: 0 }, end: { x: 4500, y: 8000 } }];
        expect(furnitureError({ ...bed, rotation: 90 }, [], walls, 100)).toBeTruthy();
        const rotated = rotatedFurnitureCandidates(bed).find(
            (candidate) => !furnitureError(candidate, [], walls, 100),
        );
        expect(rotated).toMatchObject({ x: 2450, y: 3550, rotation: 90 });
    });
    it("does not offer an accepted rotation into a doorway", () => {
        const blockers = [{ x: 0, y: 0, width: 10000, depth: 10000 }];
        expect(
            rotatedFurnitureCandidates(item).every((candidate) =>
                furnitureError(candidate, [], [], 100, blockers),
            ),
        ).toBe(true);
    });
});

describe("double-door approach depth", () => {
    it("allows the bed above the 800 mm leaves of a 1600 mm door, while protecting both sides", () => {
        const room: Room = { width: 3450, depth: 2300, doors: [], windows: [] };
        const door: DoorOpening = {
            id: "double",
            wall: "bottom",
            offset: 950,
            width: 1600,
            clearanceDepth: 1600,
            doorKind: "swing-double",
        };
        const obstacles = getDoorFurnitureObstacles(door, room);
        const bed: DrawFurniture = {
            id: "bed",
            definitionId: "single-bed",
            x: 100,
            y: 50,
            width: 900,
            depth: 2000,
            rotation: 90,
        };
        expect(furnitureError(bed, [], [], 100, obstacles)).toBeNull();
        expect(furnitureError({ ...bed, y: 700 }, [], [], 100, obstacles)).toContain("двер");
        expect(furnitureError({ ...bed, y: 2400 }, [], [], 100, obstacles)).toContain("двер");
        expect(furnitureError({ ...bed, y: 3100 }, [], [], 100, obstacles)).toBeNull();
    });
});

describe("furniture editing feedback", () => {
    const walls = [
        { id: "left", start: { x: 0, y: 0 }, end: { x: 0, y: 5000 } },
        { id: "right", start: { x: 5000, y: 0 }, end: { x: 5000, y: 5000 } },
        { id: "top", start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } },
        { id: "bottom", start: { x: 0, y: 5000 }, end: { x: 5000, y: 5000 } },
    ];
    it("measures rotated furniture to wall faces, not wall axes", () => {
        expect(furnitureWallDistances({ ...item, rotation: 90 }, walls, 100)).toEqual([
            { side: "left", distance: 950, axis: "x", direction: 1 },
            { side: "right", distance: 1950, axis: "x", direction: -1 },
            { side: "top", distance: 950, axis: "y", direction: 1 },
            { side: "bottom", distance: 3050, axis: "y", direction: -1 },
        ]);
    });
    it("ignores walls beyond the object's span and chooses the closest face", () => {
        const extra = [
            { id: "short", start: { x: 800, y: 0 }, end: { x: 800, y: 500 } },
            { id: "near", start: { x: 500, y: 500 }, end: { x: 500, y: 4000 } },
        ];
        expect(furnitureWallDistances(item, [...walls, ...extra], 100)[0].distance).toBe(450);
    });
    it("returns intersecting obstacles for highlighting and removes repeated door zones", () => {
        const zone = { x: 1500, y: 1500, width: 1000, depth: 1000 };
        const conflicts = furnitureConflicts(item, [item], walls, 100, [zone, zone]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({ kind: "door", rect: zone });
        expect(furnitureConflicts({ ...item, x: 3000 }, [item], walls, 100, [zone])).toEqual([]);
    });
    it("identifies the actual occupied furniture and wall rectangles", () => {
        expect(furnitureConflicts({ ...item, x: 0 }, [item], walls, 100)[0]).toMatchObject({
            kind: "wall",
        });
        expect(furnitureConflicts({ ...item, id: "second" }, [item], walls, 100)[0]).toMatchObject({
            kind: "furniture",
            rect: { x: 1000, y: 1000, width: 900, depth: 2000 },
        });
    });
});
