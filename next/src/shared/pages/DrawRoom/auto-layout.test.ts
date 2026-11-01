import { describe, expect, it } from "vitest";
import {
    createDefaultRoom,
    getDrawRoomRegions,
    getFurniture,
    getRotatedGeometry,
    getWorldHardClearanceRects,
    getRoomSegment,
    solveRoomVariants,
    solveWithPreferredPlacementFallback,
    type Room,
} from "@/shared/lib/furniture-planner";
import {
    arrangeAroundLeftovers,
    buildRegionSolverRoom,
    buildRoomInstances,
    hasKitchenRun,
    placementRules,
    roomFurnitureSet,
    solveKitchenVariants,
    solvedToDrawFurniture,
    solverFixedFurniture,
} from "./auto-layout";
import type { DrawFurniture } from "./furniture";

const BEDROOM = { "double-bed": 1, "bedside-table": 2, "wardrobe-medium": 1 };

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
        const solved = solveRoomVariants(result.room, buildRoomInstances(BEDROOM), {}, 3);
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
        const instances = buildRoomInstances(BEDROOM);
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

    it("arranges the pieces standing in the room, the largest first", () => {
        const piece = (id: string, definitionId: string): DrawFurniture => ({
            id,
            definitionId,
            x: 0,
            y: 0,
            width: 500,
            depth: 500,
            rotation: 0,
        });
        const set = roomFurnitureSet([
            piece("a", "bedside-table"),
            piece("b", "double-bed"),
            piece("c", "bedside-table"),
            piece("d", "kitchen-upper-600"),
        ]);
        // Upper units stay over the worktop and are not rearranged.
        expect(set).toEqual({ "double-bed": 1, "bedside-table": 2 });
        expect(Object.keys(set)[0]).toBe("double-bed");
        expect(buildRoomInstances(set)[0].priority).toBe("required");
        expect(roomFurnitureSet([])).toEqual({});
    });

    it("names the rules a piece needs, for a note when it finds no spot", () => {
        expect(placementRules("kitchen-fridge-wide")).toEqual([
            "спиной к стене",
            "90 см спереди",
            "не у окна",
        ]);
        expect(placementRules("pouf")).toEqual(["не у окна"]);
    });

    it("leaves a piece with no spot where it stands and arranges the rest around it", async () => {
        // Every wall is lined with pinned storage, so a fridge cannot stand back to a wall.
        const strips = [
            { x: 0, y: 0, width: 3000, depth: 300 },
            { x: 0, y: 2700, width: 3000, depth: 300 },
            { x: 0, y: 300, width: 300, depth: 2400 },
            { x: 2700, y: 300, width: 300, depth: 2400 },
        ];
        const room: Room = {
            ...createDefaultRoom(3000, 3000),
            doors: [],
            windows: [],
            fixedFurniture: { bodies: strips, passages: [] },
        };
        const fridge = {
            id: "fridge",
            definitionId: "kitchen-fridge-wide",
            x: 1050,
            y: 1000,
            width: 900,
            depth: 700,
            rotation: 0 as const,
        };
        const instances = buildRoomInstances({ "kitchen-fridge-wide": 1, pouf: 1 });
        const arranged = await arrangeAroundLeftovers(
            room,
            instances,
            () => solverFixedFurniture([fridge], { x: 0, y: 0 }),
            async (target, pieces) => solveWithPreferredPlacementFallback(target, pieces, {}),
        );

        expect(arranged?.unplaced.map((item) => item.definitionId)).toEqual([
            "kitchen-fridge-wide",
        ]);
        expect(arranged?.around).toBe(true);
        // The pouf stays clear of the fridge and of the space to open its doors.
        const [pouf] = arranged!.core.placements;
        expect(pouf.definitionId).toBe("pouf");
        const clear = { x: 1050, y: 1000, width: 900, depth: 1600 };
        expect(
            pouf.x < clear.x + clear.width &&
                pouf.x + 500 > clear.x &&
                pouf.y < clear.y + clear.depth &&
                pouf.y + 500 > clear.y,
        ).toBe(false);
    });

    it("furnishes an L-shaped room measured to the millimetre", () => {
        const room: Room = {
            width: 6113,
            depth: 5007,
            geometry: {
                version: 1,
                kind: "orthogonal",
                vertices: [
                    { id: "v1", x: 0, y: 0 },
                    { id: "v2", x: 6113, y: 0 },
                    { id: "v3", x: 6113, y: 3007 },
                    { id: "v4", x: 3403, y: 3007 },
                    { id: "v5", x: 3403, y: 5007 },
                    { id: "v6", x: 0, y: 5007 },
                ],
            },
            doors: [
                {
                    id: "door",
                    wall: "right",
                    segmentId: "segment-v2",
                    offset: 2000,
                    width: 800,
                    clearanceDepth: 800,
                    hinge: "start",
                },
            ],
            windows: [
                { id: "window", wall: "top", segmentId: "segment-v1", offset: 2000, width: 1200 },
            ],
            radiators: [],
            partitions: [],
        };
        const pieces = buildRoomInstances({ "double-bed": 1 });
        expect(solveRoomVariants(room, pieces, {}, 1)).toMatchObject({ status: "success" });
    });

    it("lays a kitchen by its own rules and solves the table around it", async () => {
        const base = createDefaultRoom(3600, 3600);
        const room: Room = {
            ...base,
            doors: [{ ...base.doors[0], wall: "bottom", offset: 2600, width: 800 }],
            windows: [{ id: "window", wall: "top", offset: 1200, width: 1200 }],
        };
        const piece = (definitionId: string, index: number): DrawFurniture => {
            const geometry = getRotatedGeometry(getFurniture(definitionId), 0);
            return {
                id: `piece-${index}`,
                definitionId,
                x: 0,
                y: 0,
                width: geometry.width,
                depth: geometry.depth,
                rotation: 0,
            };
        };
        const pieces = [
            "kitchen-fridge",
            "kitchen-sink",
            "kitchen-cooker",
            "kitchen-dishwasher",
            "kitchen-base-600",
            "kitchen-upper-600",
            "kitchen-hood",
            "dining-table",
        ].map(piece);

        expect(hasKitchenRun(pieces)).toBe(true);
        expect(hasKitchenRun(pieces.filter((item) => item.definitionId.includes("upper")))).toBe(
            false,
        );
        expect(roomFurnitureSet(pieces, true)).toHaveProperty("kitchen-upper-600", 1);
        const variants = await solveKitchenVariants(room, pieces, async (target, instances) =>
            solveWithPreferredPlacementFallback(target, instances, {}),
        );

        expect(variants.length).toBeGreaterThan(0);
        const [best] = variants;
        expect(best.leftover).toEqual([]);
        const table = best.placements.find(
            (placement) => placement.definitionId === "dining-table",
        )!;
        expect(table).toBeDefined();
        const tableGeometry = getRotatedGeometry(getFurniture(table.definitionId), table.rotation);
        const tableBody = {
            x: table.x,
            y: table.y,
            width: tableGeometry.width,
            depth: tableGeometry.depth,
        };
        const meets = (a: typeof tableBody, b: typeof tableBody) =>
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.depth &&
            b.y < a.y + a.depth;
        // The table keeps out of every worktop unit and of the space to work at it.
        for (const placement of best.placements.filter(
            (item) =>
                item.definitionId.startsWith("kitchen-") &&
                getFurniture(item.definitionId).mounting !== "upper",
        ))
            for (const zone of getWorldHardClearanceRects(placement))
                expect(meets(tableBody, zone)).toBe(false);
    });
    it("gives the solver a mirrored corner sofa with its chaise on the mirrored side", () => {
        const corner: DrawFurniture = {
            id: "corner",
            definitionId: "sofa-four-left",
            x: 0,
            y: 0,
            width: 2200,
            depth: 1500,
            rotation: 0,
        };
        const chaise = (item: DrawFurniture) =>
            solverFixedFurniture([item], { x: 0, y: 0 }).bodies.find((rect) => rect.depth === 550)!;

        expect(chaise(corner).x).toBe(0);
        expect(chaise({ ...corner, mirrored: true }).x).toBe(2200 - 730);
    });
});
