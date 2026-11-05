import { describe, expect, it } from "vitest";
import { validateRoomGeometry } from "@/shared/lib/furniture-planner/geometry";
import { getRoomArea } from "@/shared/lib/furniture-planner/room-geometry";
import { apartmentFromModel } from "./apartment";
import { importPlanRoom, planRoomLabel, roomKindFromName } from "./to-room";

const read = (room: Record<string, unknown>) => {
    const parsed = apartmentFromModel({ rooms: [{ name: "Комната", ...room }] });
    if ("error" in parsed) throw new Error(parsed.error);
    return importPlanRoom(parsed.rooms[0]);
};

describe("a room read from a plan becomes a planner room", () => {
    it("keeps a rectangle with its window and door on the right walls", () => {
        const imported = read({
            contour: [
                { x: 0, y: 0 },
                { x: 4000, y: 0 },
                { x: 4000, y: 3000 },
                { x: 0, y: 3000 },
            ],
            openings: [
                { kind: "window", wall: 0, offset: 1000, width: 1500 },
                { kind: "door", wall: 2, offset: 200, width: 800 },
            ],
        });

        expect(imported.problem).toBeUndefined();
        expect(imported.room).toMatchObject({ width: 4000, depth: 3000 });
        expect(imported.room!.geometry).toBeUndefined();
        expect(imported.room!.windows).toEqual([
            expect.objectContaining({ wall: "top", offset: 1000, width: 1500 }),
        ]);
        // The door's wall runs right to left in the model's contour.
        expect(imported.room!.doors).toEqual([
            expect.objectContaining({ wall: "bottom", offset: 3000, width: 800 }),
        ]);
        expect(validateRoomGeometry(imported.room!)).toBeNull();
        expect(imported).toMatchObject({ area: 12, simplified: false, droppedOpenings: 0 });
    });

    it("keeps an L-shaped room as an orthogonal contour", () => {
        const imported = read({
            contour: [
                { x: 0, y: 0 },
                { x: 3000, y: 0 },
                { x: 3000, y: 2000 },
                { x: 5000, y: 2000 },
                { x: 5000, y: 4000 },
                { x: 0, y: 4000 },
            ],
            openings: [],
        });

        expect(imported.room!.geometry).toMatchObject({ kind: "orthogonal" });
        expect(getRoomArea(imported.room!)).toBe(16_000_000);
        expect(validateRoomGeometry(imported.room!)).toBeNull();
    });

    it("steps a bay window's slanted walls inside the room", () => {
        const imported = read({
            contour: [
                { x: 0, y: 1000 },
                { x: 1000, y: 0 },
                { x: 2600, y: 0 },
                { x: 3600, y: 1000 },
                { x: 3600, y: 5000 },
                { x: 0, y: 5000 },
            ],
            openings: [{ kind: "window", wall: 1, offset: 200, width: 1200 }],
        });

        expect(imported.simplified).toBe(true);
        expect(validateRoomGeometry(imported.room!)).toBeNull();
        // Never larger than the real room: furniture must fit between the real walls.
        expect(getRoomArea(imported.room!) / 1_000_000).toBeLessThanOrEqual(imported.area!);
        expect(imported.room!.windows).toHaveLength(1);
    });

    it("merges a jog too short for the editor", () => {
        const imported = read({
            contour: [
                { x: 0, y: 0 },
                { x: 3000, y: 0 },
                { x: 3000, y: 2000 },
                { x: 3120, y: 2000 },
                { x: 3120, y: 4000 },
                { x: 0, y: 4000 },
            ],
            openings: [],
        });

        expect(imported.simplified).toBe(true);
        expect(validateRoomGeometry(imported.room!)).toBeNull();
    });

    it("explains a room the model could not size", () => {
        const imported = read({ contour: null, openings: [] });

        expect(imported.room).toBeNull();
        expect(imported.problem).toMatch(/нет размеров/);
    });
});

describe("what a room is called and used for", () => {
    it.each([
        ["Кухня-гостиная", "kitchen-living"],
        ["Спальня 2", "bedroom"],
        ["Детская", "children"],
        ["Гостиная", "living"],
        ["Зал", "living"],
        ["Кухня", "kitchen"],
        ["Ванная комната", "bathroom"],
        ["С/у", "bathroom"],
        ["Прихожая-коридор", "hallway"],
        ["room at the top right", undefined],
        ["Залив", undefined],
        ["2", undefined],
    ])("%s → %s", (name, kind) => {
        expect(roomKindFromName(name)).toBe(kind);
    });

    it("turns a bare BTI number into a readable name", () => {
        expect(planRoomLabel("2а")).toBe("Комната 2а");
        expect(planRoomLabel("Спальня")).toBe("Спальня");
    });
});
