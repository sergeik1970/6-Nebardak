import { describe, expect, it } from "vitest";
import { getDoorObstacle, validateRoomGeometry } from "./geometry";
import type { DoorKind, Room } from "./types";

const makeRoom = (doorKind: DoorKind): Room => ({
    width: 6000,
    depth: 4000,
    doors: [
        {
            id: "entry",
            wall: "bottom",
            offset: 1500,
            width: doorKind === "swing-double" || doorKind === "sliding-double" ? 1600 : 900,
            clearanceDepth: 900,
            ...(doorKind === "sliding-single" || doorKind === "sliding-double"
                ? {}
                : { hinge: "start" as const, swingDirection: "inward" as const }),
            doorKind,
        },
    ],
    windows: [],
});

describe("door catalogue geometry", () => {
    it.each<DoorKind>(["room", "balcony", "swing-double", "sliding-single", "sliding-double"])(
        "keeps %s as a valid physical wall aperture",
        (doorKind) => {
            const room = makeRoom(doorKind);
            expect(validateRoomGeometry(room)).toBeNull();
            expect(getDoorObstacle(room.doors[0], room).width).toBeGreaterThan(0);
        },
    );

    it("does not accept hinge/swing metadata on a sliding door", () => {
        const room = makeRoom("sliding-single");
        room.doors[0].hinge = "start";
        expect(validateRoomGeometry(room)).toContain("Проверьте дверь");
    });
});
