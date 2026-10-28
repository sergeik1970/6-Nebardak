import { describe, expect, it } from "vitest";
import {
    arrangeKitchen,
    createDefaultRoom,
    getDoorFurnitureObstacles,
    getFurniture,
    getRotatedGeometry,
    kitchenFixedFurniture,
    rectInsideRoomGeometry,
    type KitchenLayout,
    type Placement,
    type Rect,
    type Room,
} from ".";

const pieces = (ids: string[]) =>
    ids.map((definitionId, index) => ({ instanceId: `${definitionId}-${index}`, definitionId }));

const body = (placement: Placement): Rect => {
    const geometry = getRotatedGeometry(getFurniture(placement.definitionId), placement.rotation);
    return { x: placement.x, y: placement.y, width: geometry.width, depth: geometry.depth };
};

const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.depth && b.y < a.y + a.depth;

const isUpper = (placement: Placement) => getFurniture(placement.definitionId).mounting === "upper";

/** A 3,0 × 3,2 m kitchen: a window in the top wall, the door in the bottom one. */
const kitchenRoom = (width = 3000): Room => {
    const base = createDefaultRoom(width, 3200);
    return {
        ...base,
        width,
        depth: 3200,
        doors: [{ ...base.doors[0], wall: "bottom", offset: 2000, width: 800 }],
        windows: [{ id: "window", wall: "top", offset: 1000, width: 1200, windowKind: "standard" }],
    };
};

const FULL = [
    "kitchen-fridge",
    "kitchen-sink",
    "kitchen-cooker",
    "kitchen-dishwasher",
    "kitchen-base-600",
    "kitchen-base-600",
    "kitchen-base-400",
    "kitchen-upper-600",
    "kitchen-upper-600",
    "kitchen-upper-400",
    "kitchen-hood",
];

/** Every layout: inside the room, nothing overlapping within its own tier. */
const expectSound = (room: Room, layout: KitchenLayout) => {
    const floor = layout.placements.filter((placement) => !isUpper(placement));
    const uppers = layout.placements.filter(isUpper);
    for (const tier of [floor, uppers])
        tier.forEach((first, index) => {
            expect(rectInsideRoomGeometry(body(first), room)).toBe(true);
            for (const second of tier.slice(index + 1))
                expect(overlap(body(first), body(second))).toBe(false);
        });
    const doors = room.doors.flatMap((door) => getDoorFurnitureObstacles(door, room));
    for (const placement of floor)
        expect(doors.some((rect) => overlap(body(placement), rect))).toBe(false);
};

describe("kitchen layout", () => {
    it("lays a full set along two walls with nothing left over but what cannot hang", () => {
        const room = kitchenRoom();
        const layouts = arrangeKitchen(room, pieces(FULL));

        expect(layouts.length).toBeGreaterThan(0);
        for (const layout of layouts) {
            expectSound(room, layout);
            // Every floor unit is placed; only an upper unit may find no wall.
            expect(layout.unplacedInstanceIds.every((id) => id.startsWith("kitchen-upper"))).toBe(
                true,
            );
        }
        expect(layouts[0].shape).toBe("corner");
    });

    it("puts the sink under the window, its dishwasher beside it and worktop before the cooker", () => {
        const room = kitchenRoom(3600);
        const [best] = arrangeKitchen(
            room,
            pieces([
                "kitchen-fridge",
                "kitchen-sink",
                "kitchen-cooker",
                "kitchen-dishwasher",
                "kitchen-base-600",
            ]),
        );

        expect(best.shape).toBe("linear");
        expect(best.label).toBe("Кухня вдоль одной стены, мойка у окна");
        expectSound(room, best);
        // One run along the window wall, side by side without gaps.
        const run = best.placements
            .filter((placement) => !isUpper(placement))
            .sort((a, b) => a.x - b.x);
        expect(run.every((placement) => placement.y === 0 && placement.rotation === 0)).toBe(true);
        run.slice(1).forEach((placement, index) =>
            expect(placement.x).toBe(run[index].x + body(run[index]).width),
        );
        const ids = run.map((placement) => placement.definitionId);
        // The fridge closes one end; the cooker is neither at an end nor next to the sink.
        expect([ids[0], ids[ids.length - 1]]).toContain("kitchen-fridge");
        const sink = ids.indexOf("kitchen-sink");
        const cooker = ids.indexOf("kitchen-cooker");
        expect(Math.abs(ids.indexOf("kitchen-dishwasher") - sink)).toBe(1);
        expect(Math.abs(cooker - sink)).toBeGreaterThan(1);
        expect(cooker).not.toBe(0);
        expect(cooker).not.toBe(ids.length - 1);
        const sinkBody = body(run[sink]);
        expect(sinkBody.x).toBeGreaterThanOrEqual(1000);
        expect(sinkBody.x + sinkBody.width).toBeLessThanOrEqual(2200);
    });

    it("never stands a fridge or a tall unit in front of a window", () => {
        const room = kitchenRoom();
        const window = { x: 1000, y: 0, width: 1200, depth: 700 };
        for (const layout of arrangeKitchen(
            room,
            pieces([
                "kitchen-fridge",
                "kitchen-tall",
                "kitchen-sink",
                "kitchen-cooker",
                "kitchen-base-600",
            ]),
        ))
            for (const placement of layout.placements)
                if (["kitchen-fridge", "kitchen-tall"].includes(placement.definitionId))
                    expect(overlap(body(placement), window)).toBe(false);
    });

    it("hangs the hood over the cooker and no upper unit over the window or the cooker", () => {
        const room = kitchenRoom();
        for (const layout of arrangeKitchen(room, pieces(FULL))) {
            const cooker = layout.placements.find(
                (placement) => placement.definitionId === "kitchen-cooker",
            )!;
            const hood = layout.placements.find(
                (placement) => placement.definitionId === "kitchen-hood",
            )!;
            expect(overlap(body(hood), body(cooker))).toBe(true);
            const window = { x: 1000, y: 0, width: 1200, depth: 700 };
            for (const upper of layout.placements.filter((placement) =>
                placement.definitionId.startsWith("kitchen-upper"),
            )) {
                expect(overlap(body(upper), window)).toBe(false);
                expect(overlap(body(upper), body(cooker))).toBe(false);
            }
        }
    });

    it("keeps the run out of the door's way", () => {
        const base = createDefaultRoom(2600, 3600);
        // The door in the middle of the only long wall.
        const room: Room = {
            ...base,
            width: 2600,
            depth: 3600,
            doors: [{ ...base.doors[0], wall: "left", offset: 1400, width: 800 }],
            windows: [],
        };
        const layouts = arrangeKitchen(
            room,
            pieces(["kitchen-sink", "kitchen-cooker", "kitchen-base-600", "kitchen-base-600"]),
        );
        expect(layouts.length).toBeGreaterThan(0);
        for (const layout of layouts) expectSound(room, layout);
    });

    it("leaves out plain cabinets, the narrowest first, when the whole set does not fit", () => {
        const base = createDefaultRoom(2400, 2400);
        const room: Room = { ...base, doors: [], windows: [] };
        const [layout] = arrangeKitchen(
            room,
            pieces([
                "kitchen-sink",
                "kitchen-cooker",
                "kitchen-base-600",
                "kitchen-base-600",
                "kitchen-base-600",
                "kitchen-base-600",
                "kitchen-base-600",
                "kitchen-base-400",
            ]),
        );

        expectSound(room, layout);
        expect(layout.unplacedInstanceIds[0]).toBe("kitchen-base-400-7");
        expect(layout.placements.map((placement) => placement.definitionId)).toEqual(
            expect.arrayContaining(["kitchen-sink", "kitchen-cooker"]),
        );
    });

    it("lays nothing without a floor unit", () => {
        expect(arrangeKitchen(kitchenRoom(), pieces(["kitchen-upper-600"]))).toEqual([]);
    });

    it("gives the rest of the room the kitchen's bodies and worktop zones", () => {
        const [layout] = arrangeKitchen(kitchenRoom(), pieces(FULL));
        const fixed = kitchenFixedFurniture(layout.placements);
        const floor = layout.placements.filter((placement) => !isUpper(placement));

        expect(fixed.bodies).toHaveLength(floor.length);
        expect(fixed.passages.length).toBe(floor.length);
    });
});
