import { describe, expect, it } from "vitest";
import {
    fullFurnitureSet,
    furnishRoom,
    selectionInstances,
    selectionLadder,
} from "./furniture-selection";
import { validateLayout } from "./geometry";
import { ROOM_LAB_GENERATED_CASES } from "./room-lab";

const generatedRoom = (id: string) => {
    const roomCase = ROOM_LAB_GENERATED_CASES.find((candidate) => candidate.id === id);
    if (!roomCase) throw new Error(`Unknown generated room: ${id}`);
    return roomCase.room;
};

describe("furniture selection", () => {
    it("starts from what the room is for", () => {
        expect(fullFurnitureSet("bedroom", 15)[0].definitionId).toBe("double-bed");
        expect(fullFurnitureSet("living", 18)[0].definitionId).toBe("sofa-three");
        expect(fullFurnitureSet("office", 9)[0].definitionId).toBe("desk");
    });

    it("follows the brief", () => {
        const ids = (pieces: { definitionId: string }[]) => pieces.map((item) => item.definitionId);

        expect(ids(fullFurnitureSet("living", 18, { watchesTv: false }))).not.toContain("tv");
        expect(ids(fullFurnitureSet("living", 18, { pets: ["dog"] }))).toContain("pet-bed");
        expect(ids(fullFurnitureSet("children", 12, { childrenAges: [1] }))[0]).toBe("cradle");
        expect(ids(fullFurnitureSet("children", 12, { childrenAges: [4] }))).not.toContain("desk");
        expect(fullFurnitureSet("children", 12, { childrenAges: [9, 10] })).toEqual(
            expect.arrayContaining([
                { definitionId: "single-bed", count: 1 },
                { definitionId: "child-bed", count: 1 },
            ]),
        );
    });

    it("gives way step by step and never drops the main piece", () => {
        const ladder = selectionLadder("bedroom", 15);

        expect(ladder[0].changes).toEqual([]);
        ladder.forEach((step, index) => {
            expect(["double-bed", "single-bed"]).toContain(step.pieces[0].definitionId);
            expect(step.changes).toHaveLength(index);
        });
        expect(ladder[1].pieces[0].size).toEqual({ width: 1600, depth: 2000 });
        expect(ladder.at(-2)?.pieces).toEqual([
            { definitionId: "double-bed", count: 1, size: { width: 1400, depth: 2000 } },
        ]);
        expect(ladder.at(-1)?.pieces).toEqual([{ definitionId: "single-bed", count: 1 }]);
    });

    it("passes a chosen size to the solver", () => {
        const [bed] = selectionInstances([
            { definitionId: "double-bed", count: 1, size: { width: 1600, depth: 2000 } },
        ]);

        expect(bed).toMatchObject({ priority: "required", width: 1600, depth: 2000 });
    });

    it("furnishes a bedroom where the catalogue's bed cannot stand", () => {
        const room = generatedRoom("GEN-bedroom-3300x3900-side-door");

        const result = furnishRoom(room, "bedroom");

        expect(result.status).toBe("furnished");
        expect(result.rung).toBeGreaterThan(0);
        expect(result.step.changes[0]).toMatchObject({
            kind: "smaller",
            definitionId: "double-bed",
        });
        expect(validateLayout(room, result.placements).valid).toBe(true);
        const bed = result.placements.find((placement) => placement.definitionId === "double-bed");
        expect(bed?.width).toBeLessThan(1800);
    });

    it("names every piece left out when nothing can stand", () => {
        const tiny = { width: 1200, depth: 1200, doors: [], windows: [], radiators: [] };

        const result = furnishRoom(tiny, "bedroom");

        expect(result.status).toBe("partial");
        expect(result.placements).toEqual([]);
        expect(result.unplaced.map((instance) => instance.definitionId)).toEqual(["single-bed"]);
    });

    it("keeps the full set where it fits", () => {
        const room = generatedRoom("GEN-office-3600x4200-facing");

        const result = furnishRoom(room, "office");

        expect(result).toMatchObject({ status: "furnished", rung: 0 });
        expect(result.step.changes).toEqual([]);
    });
});
