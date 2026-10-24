import { describe, expect, it } from "vitest";
import {
    getDrawRoomRegions,
    getRoomSegment,
    solveRoomVariants,
    type Room,
} from "@/shared/lib/furniture-planner";
import {
    ROOM_KIND_FURNITURE,
    buildRegionSolverRoom,
    buildRoomInstances,
    solvedToDrawFurniture,
} from "./auto-layout";

// Two rooms side by side: 3,0 + 0,1 + 2,9 m by 4,0 m, a door in the partition.
const building: Room = {
    width: 6000,
    depth: 4000,
    partitions: [
        { id: "partition", start: { x: 3050, y: 0 }, end: { x: 3050, y: 4000 }, thickness: 100 },
    ],
    doors: [
        {
            id: "door",
            wall: "left",
            partitionId: "partition",
            offset: 3000,
            width: 800,
            clearanceDepth: 800,
            hinge: "start",
        },
    ],
    windows: [{ id: "window", wall: "top", offset: 900, width: 1200 }],
    radiators: [
        { id: "radiator", wall: "top", offset: 1100, width: 800, depth: 100, clearanceDepth: 300 },
    ],
};

describe("auto layout in one room of the drawing", () => {
    const [left, right] = getDrawRoomRegions(building);

    it("cuts the room out on the 50 mm lattice with its own window and radiator", () => {
        const result = buildRegionSolverRoom(building, left);
        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.origin).toEqual({ x: 0, y: 0 });
        expect([result.room.width, result.room.depth]).toEqual([3000, 4000]);
        expect(result.room.windows).toHaveLength(1);
        expect(result.room.radiators).toHaveLength(1);
        const window = result.room.windows[0];
        expect(getRoomSegment(result.room, window)?.orientation).toBe("horizontal");
        expect(window.offset).toBe(900);
    });

    it("joins the partition door to the room on either side", () => {
        for (const region of [left, right]) {
            const result = buildRegionSolverRoom(building, region);
            expect(result.status).toBe("ready");
            if (result.status !== "ready") continue;
            expect(result.room.doors).toHaveLength(1);
            const segment = getRoomSegment(result.room, result.room.doors[0]);
            expect(segment?.orientation).toBe("vertical");
        }
        const right_ = buildRegionSolverRoom(building, right);
        if (right_.status === "ready") {
            // The right room starts behind the partition; no window or radiator of its own.
            expect(right_.origin.x).toBe(3100);
            expect(right_.room.windows).toHaveLength(0);
        }
    });

    it("lets the solver furnish the cut-out bedroom", () => {
        const result = buildRegionSolverRoom(building, left);
        if (result.status !== "ready") throw new Error(result.message);
        const solved = solveRoomVariants(
            result.room,
            buildRoomInstances(ROOM_KIND_FURNITURE.bedroom),
            {},
            3,
        );
        expect(solved.status).toBe("success");
        expect(solved.variants.length).toBeGreaterThan(0);
        expect(solved.variants[0].placements.map((item) => item.definitionId)).toContain(
            "double-bed",
        );
    });

    it("declines a room below the solver's 2,4 m minimum", () => {
        const narrow: Room = {
            ...building,
            partitions: [
                {
                    id: "partition",
                    start: { x: 2000, y: 0 },
                    end: { x: 2000, y: 4000 },
                    thickness: 100,
                },
            ],
            doors: [],
            windows: [],
            radiators: [],
        };
        const [small] = getDrawRoomRegions(narrow);
        const result = buildRegionSolverRoom(narrow, small);
        expect(result.status).toBe("unsupported");
        if (result.status === "unsupported") expect(result.message).toContain("2,4 × 2,4 м");
    });

    it("makes the first piece of a room set required and the rest optional", () => {
        const instances = buildRoomInstances(ROOM_KIND_FURNITURE.bedroom);
        expect(instances.map((instance) => instance.priority)).toEqual([
            "required",
            "preferred",
            "preferred",
            "preferred",
        ]);
        expect(instances.filter((item) => item.definitionId === "bedside-table")).toHaveLength(2);
    });

    it("returns solved pieces to apartment coordinates with catalogue sizes", () => {
        const [piece] = solvedToDrawFurniture(
            [{ instanceId: "desk-1", definitionId: "desk", x: 100, y: 200, rotation: 90 }],
            { x: 3100, y: 50 },
            "auto",
        );
        expect(piece).toMatchObject({ id: "auto-1", x: 3200, y: 250, rotation: 90 });
        expect(piece.width).toBeGreaterThan(0);
        expect(piece.depth).toBeGreaterThan(0);
    });

    it("offers only catalogue pieces in every room set", () => {
        for (const set of Object.values(ROOM_KIND_FURNITURE)) {
            expect(() => buildRoomInstances(set)).not.toThrow();
        }
    });
});
