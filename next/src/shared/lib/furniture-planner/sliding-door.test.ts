import { describe, expect, it } from "vitest";
import { getDoorMaterialCollisionError, getSlidingDoorTravel } from "./geometry";
import type { DoorOpening, Room } from "./types";
const door = (patch: Partial<DoorOpening> = {}): DoorOpening => ({
    id: "d",
    wall: "top",
    offset: 1100,
    width: 1600,
    clearanceDepth: 1600,
    doorKind: "sliding-double",
    ...patch,
});
const room = (d: DoorOpening, patch: Partial<Room> = {}): Room => ({
    width: 5000,
    depth: 3500,
    wallThickness: 100,
    doors: [d],
    windows: [],
    ...patch,
});
describe("sliding door full travel", () => {
    it("rejects the screenshot's 450 mm margin for an 800 mm leaf", () => {
        const d = door({ offset: 450 });
        expect(getDoorMaterialCollisionError(d, room(d))).toContain("не хватает места");
    });
    it("checks the entire travel, even when the illustrated half-open leaf is clear", () => {
        const d = door();
        const r = room(d, {
            partitions: [
                { id: "cross", start: { x: 500, y: 0 }, end: { x: 500, y: 1500 }, thickness: 100 },
            ],
        });
        expect(getDoorMaterialCollisionError(d, r)).toContain("упирается в стену");
        const outside = { ...d, slidingMount: "outward" as const };
        expect(getDoorMaterialCollisionError(outside, { ...r, doors: [outside] })).toBeNull();
    });
    it("uses the chosen direction for a single leaf", () => {
        const d = door({ width: 900, offset: 200, doorKind: "sliding-single" });
        expect(getDoorMaterialCollisionError(d, room(d))).toContain("не хватает места");
        const right = { ...d, slidingDirection: "end" as const };
        expect(getDoorMaterialCollisionError(right, room(right))).toBeNull();
    });
    it("rejects a thin pocket and a pocket occupied by another aperture", () => {
        const d = door({ slidingMount: "pocket" });
        expect(getDoorMaterialCollisionError(d, room(d, { wallThickness: 50 }))).toContain(
            "толщины стены",
        );
        expect(
            getDoorMaterialCollisionError(
                d,
                room(d, { windows: [{ id: "w", wall: "top", offset: 400, width: 400 }] }),
            ),
        ).toContain("другой проём");
        expect(getDoorMaterialCollisionError(d, room(d))).toBeNull();
    });
    it("rotates the travel with the host and keeps the exterior leaf outside", () => {
        const d = door({
            wall: "right",
            offset: 1000,
            width: 900,
            doorKind: "sliding-single",
            slidingMount: "outward",
        });
        const [travel] = getSlidingDoorTravel(d, room(d));
        expect(travel.x).toBeGreaterThan(5000);
        expect(travel.depth).toBe(1800);
        expect(getDoorMaterialCollisionError(d, room(d))).toBeNull();
    });
});
