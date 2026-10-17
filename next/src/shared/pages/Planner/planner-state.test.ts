import { describe, expect, it } from "vitest";

import { RemovalRecord, Room } from "../../lib/furniture-planner/types";
import { applyRoomGeometry, createLRoomGeometry } from "../../lib/furniture-planner/room-geometry";
import {
    buildPlannerSelectionSignature,
    canApplyAutomaticRemovalProposal,
    layoutMatchesFurnitureInstances,
    shouldShowPlannerLayout,
} from "./planner-state";

const DEFAULT_ROOM: Room = {
    width: 6000,
    depth: 4600,
    doors: [
        {
            id: "door-main",
            wall: "bottom",
            offset: 500,
            width: 900,
            clearanceDepth: 900,
            hinge: "start",
        },
    ],
    windows: [],
    radiators: [],
};

const removedItem: RemovalRecord = {
    instanceId: "coffee-table-1",
    definitionId: "coffee-table",
    priority: "optional",
    method: "automatic",
    reason: "Автоматическое предложение подтверждено отдельно.",
    removedAt: "2026-07-18T08:30:00.000Z",
};

describe("planner state identity", () => {
    it("keeps a restored layout current when room properties are normalized in another order", () => {
        const normalizedRoom: Room = {
            width: DEFAULT_ROOM.width,
            depth: DEFAULT_ROOM.depth,
            doors: DEFAULT_ROOM.doors,
            radiators: [],
            windows: DEFAULT_ROOM.windows,
        };

        expect(buildPlannerSelectionSignature(DEFAULT_ROOM, { "single-bed": 1 }, {}, {})).toBe(
            buildPlannerSelectionSignature(normalizedRoom, { "single-bed": 1 }, {}, {}),
        );
    });

    it("changes when a non-required priority changes", () => {
        const optional = buildPlannerSelectionSignature(
            DEFAULT_ROOM,
            { "coffee-table": 1 },
            { "coffee-table": "optional" },
            {},
        );
        const preferred = buildPlannerSelectionSignature(
            DEFAULT_ROOM,
            { "coffee-table": 1 },
            { "coffee-table": "preferred" },
            {},
        );

        expect(optional).not.toBe(preferred);
    });

    it("changes when a door starts opening outside the room", () => {
        const inward = buildPlannerSelectionSignature(DEFAULT_ROOM, {}, {}, {});
        const outward = buildPlannerSelectionSignature(
            {
                ...DEFAULT_ROOM,
                doors: [{ ...DEFAULT_ROOM.doors[0], swingDirection: "outward" }],
            },
            {},
            {},
            {},
        );

        expect(inward).not.toBe(outward);
    });

    it("changes when a window becomes floor-to-ceiling", () => {
        const standard = buildPlannerSelectionSignature(DEFAULT_ROOM, {}, {}, {});
        const panoramic = buildPlannerSelectionSignature(
            {
                ...DEFAULT_ROOM,
                windows: [
                    {
                        id: "window-main",
                        wall: "top",
                        offset: 2100,
                        width: 1800,
                        windowKind: "floor-to-ceiling",
                    },
                ],
            },
            {},
            {},
            {},
        );

        expect(standard).not.toBe(panoramic);
    });

    it("changes when a stored internal partition changes", () => {
        const withoutPartition = buildPlannerSelectionSignature(DEFAULT_ROOM, {}, {}, {});
        const withPartition = buildPlannerSelectionSignature(
            {
                ...DEFAULT_ROOM,
                partitions: [
                    {
                        id: "partition-main",
                        start: { x: 3000, y: 0 },
                        end: { x: 3000, y: 4600 },
                        thickness: 50,
                    },
                ],
            },
            {},
            {},
            {},
        );

        expect(withoutPartition).not.toBe(withPartition);
    });

    it("changes for different contours with the same bounding dimensions", () => {
        const orthogonal = applyRoomGeometry(
            DEFAULT_ROOM,
            createLRoomGeometry(DEFAULT_ROOM.width, DEFAULT_ROOM.depth, "right"),
        );
        const rectangular = buildPlannerSelectionSignature(
            DEFAULT_ROOM,
            { "single-bed": 1 },
            {},
            {},
        );
        const lShape = buildPlannerSelectionSignature(orthogonal, { "single-bed": 1 }, {}, {});

        expect(lShape).not.toBe(rectangular);
    });

    it("rejects a delayed proposal after its item stops being optional", () => {
        expect(
            canApplyAutomaticRemovalProposal({
                proposalSignature: "same",
                currentSignature: "same",
                removedItems: [removedItem],
                priorities: { "coffee-table": "preferred" },
            }),
        ).toBe(false);
        expect(
            canApplyAutomaticRemovalProposal({
                proposalSignature: "same",
                currentSignature: "same",
                removedItems: [removedItem],
                priorities: { "coffee-table": "optional" },
            }),
        ).toBe(true);
    });

    it("requires one matching placement for every active furniture instance", () => {
        const instances = [
            { instanceId: "single-bed-1", definitionId: "single-bed" },
            { instanceId: "bookcase-1", definitionId: "bookcase" },
        ];

        expect(layoutMatchesFurnitureInstances(instances, instances)).toBe(true);
        expect(layoutMatchesFurnitureInstances(instances, instances.slice(0, 1))).toBe(false);
        expect(
            layoutMatchesFurnitureInstances(instances, [
                instances[0],
                { instanceId: "bookcase-1", definitionId: "dresser" },
            ]),
        ).toBe(false);
        expect(layoutMatchesFurnitureInstances(instances, [instances[0], instances[0]])).toBe(
            false,
        );
    });

    it("hides stale layouts and partial diagnostic branches from the room plan", () => {
        expect(
            shouldShowPlannerLayout({
                isStale: true,
                result: { status: "success" },
            }),
        ).toBe(false);
        expect(
            shouldShowPlannerLayout({
                isStale: false,
                result: { status: "failure" },
            }),
        ).toBe(false);
        expect(
            shouldShowPlannerLayout({
                isStale: false,
                result: { status: "success" },
            }),
        ).toBe(true);
    });
});
