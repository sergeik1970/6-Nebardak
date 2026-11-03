import { describe, expect, it } from "vitest";
import {
    furnishRoom,
    getDrawRoomRegions,
    type FurnishableRoomKind,
    type Room,
    type RoomBrief,
    type RoomKind,
} from "@/shared/lib/furniture-planner";
import { furnishApartment, type ApartmentRoom } from "./furnish-apartment";
import { furnitureBelongsToRoom, type DrawFurniture } from "./furniture";

// Two rooms side by side, 3,0 and 2,9 by 4,5 m, a door in the partition and a window each.
const building: Room = {
    width: 6000,
    depth: 4500,
    partitions: [
        { id: "partition", start: { x: 3050, y: 0 }, end: { x: 3050, y: 4500 }, thickness: 100 },
    ],
    doors: [
        {
            id: "door",
            wall: "left",
            partitionId: "partition",
            offset: 3500,
            width: 800,
            clearanceDepth: 800,
            hinge: "start",
        },
    ],
    windows: [
        { id: "left-window", wall: "top", offset: 900, width: 1200 },
        { id: "right-window", wall: "top", offset: 4000, width: 1200 },
    ],
    radiators: [],
};

const regions = getDrawRoomRegions(building);

const apartment = (kinds: (RoomKind | undefined)[]): ApartmentRoom[] =>
    regions.map((region, index) => ({
        signature: region.signature,
        name: `Комната ${index + 1}`,
        kind: kinds[index],
        areaSquareMillimeters: region.areaSquareMillimeters,
        region,
        building,
        origin: { x: 0, y: 0 },
        furnitureRoom: { name: `Комната ${index + 1}`, rects: region.clearRects },
    }));

const furnish = async (room: Room, kind: FurnishableRoomKind, brief: RoomBrief) =>
    furnishRoom(room, kind, brief);
const fits = () => true;

const piece = (id: string, definitionId: string, x: number, y: number, locked = false) =>
    ({ id, definitionId, x, y, width: 400, depth: 350, rotation: 0, locked }) as DrawFurniture;

describe("furnish the whole apartment", () => {
    it("furnishes every room in one result", async () => {
        const rooms = apartment(["bedroom", "office"]);

        const result = await furnishApartment({
            rooms,
            furniture: [],
            keepFurnishedRooms: false,
            furnish,
            fits,
            idPrefix: "test",
        });

        expect(result.cancelled).toBe(false);
        expect(result.rooms.map((room) => room.status)).toEqual(["furnished", "furnished"]);
        for (const room of rooms) {
            const own = result.furniture.filter((item) =>
                furnitureBelongsToRoom(item, room.furnitureRoom),
            );
            expect(own.length).toBeGreaterThan(0);
        }
        expect(result.furniture.map((item) => item.definitionId)).toEqual(
            expect.arrayContaining(["double-bed", "desk"]),
        );
        expect(new Set(result.furniture.map((item) => item.id)).size).toBe(result.furniture.length);
    });

    it("keeps pinned pieces and replaces the rest", async () => {
        const pinned = piece("pinned", "bedside-table", 100, 100, true);
        const loose = piece("loose", "bedside-table", 600, 100);

        const result = await furnishApartment({
            rooms: apartment(["bedroom", "office"]),
            furniture: [pinned, loose],
            keepFurnishedRooms: false,
            furnish,
            fits,
        });

        expect(result.furniture).toContainEqual(pinned);
        expect(result.furniture.map((item) => item.id)).not.toContain("loose");
    });

    it("leaves furnished rooms alone when asked", async () => {
        const loose = piece("loose", "bedside-table", 600, 100);

        const result = await furnishApartment({
            rooms: apartment(["bedroom", "office"]),
            furniture: [loose],
            keepFurnishedRooms: true,
            furnish,
            fits,
        });

        expect(result.rooms[0]).toMatchObject({ status: "skipped" });
        expect(result.rooms[0].message).toMatch(/Уже обставлена/);
        expect(result.furniture).toContainEqual(loose);
        expect(result.rooms[1].status).toBe("furnished");
    });

    it("says why a room is skipped", async () => {
        const result = await furnishApartment({
            rooms: apartment(["bathroom", "office"]),
            furniture: [],
            keepFurnishedRooms: false,
            furnish,
            fits,
        });

        expect(result.rooms[0]).toMatchObject({
            status: "skipped",
            message: "Санузел: обставляется вручную.",
        });
    });

    it("keeps a room as it was when its plan fails the apartment check", async () => {
        const loose = piece("loose", "bedside-table", 600, 100);

        const result = await furnishApartment({
            rooms: apartment(["bedroom", "office"]),
            furniture: [loose],
            keepFurnishedRooms: false,
            furnish,
            fits: () => false,
        });

        expect(result.rooms.map((room) => room.status)).toEqual(["skipped", "skipped"]);
        expect(result.furniture).toEqual([loose]);
    });

    it("suggests a kind for an unnamed room and says so", async () => {
        const result = await furnishApartment({
            rooms: apartment([undefined, "office"]),
            furniture: [],
            keepFurnishedRooms: false,
            furnish,
            fits,
        });

        expect(result.rooms[0]).toMatchObject({ suggested: true, status: "furnished" });
        expect(result.rooms[0].kind).toBeDefined();
        expect(result.rooms[1].suggested).toBe(false);
    });

    it("stops and changes nothing when cancelled", async () => {
        const controller = new AbortController();
        const loose = piece("loose", "bedside-table", 600, 100);

        const result = await furnishApartment({
            rooms: apartment(["bedroom", "office"]),
            furniture: [loose],
            keepFurnishedRooms: false,
            furnish: async (room, kind, brief) => {
                controller.abort();
                return furnishRoom(room, kind, brief);
            },
            fits,
            signal: controller.signal,
        });

        expect(result.cancelled).toBe(true);
        expect(result.furniture).toEqual([loose]);
    });

    it("reports progress room by room", async () => {
        const seen: [number, number, string][] = [];

        await furnishApartment({
            rooms: apartment(["bedroom", "office"]),
            furniture: [],
            keepFurnishedRooms: false,
            furnish,
            fits,
            onProgress: (done, total, name) => seen.push([done, total, name]),
        });

        expect(seen).toEqual([
            [0, 2, "Комната 1"],
            [1, 2, "Комната 2"],
            [2, 2, ""],
        ]);
    });
});
