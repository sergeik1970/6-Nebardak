import { describe, expect, it } from "vitest";

import type { FurnitureInstance, Room } from "@/shared/lib/furniture-planner";
import {
    createPlannerObservationRequests,
    WORKING_CORE_OBSERVATION_ID,
} from "./planner-observation";

const room: Room = {
    width: 6000,
    depth: 4600,
    doors: [],
    windows: [],
    radiators: [],
};

const instances: FurnitureInstance[] = [
    {
        instanceId: "double-bed-1",
        definitionId: "double-bed",
        priority: "required",
        required: true,
    },
    {
        instanceId: "desk-1",
        definitionId: "desk",
        priority: "preferred",
        required: false,
    },
];

describe("planner observation snapshots", () => {
    it("keeps a reviewable partial working core together with its omitted furniture", () => {
        const requests = createPlannerObservationRequests({
            room,
            selection: { "double-bed": 1, desk: 1 },
            priorities: { "double-bed": "required", desk: "preferred" },
            preferences: {},
            instances,
            targets: [
                {
                    id: WORKING_CORE_OBSERVATION_ID,
                    placements: [
                        {
                            instanceId: "double-bed-1",
                            definitionId: "double-bed",
                            x: 0,
                            y: 0,
                            rotation: 0,
                        },
                    ],
                    exploredNodes: 42,
                    score: 12,
                    notes: ["Полный набор не собран."],
                    solverStatus: "partial",
                    workingCore: {
                        requestedItemCount: instances.length,
                        unplacedInstanceIds: ["desk-1"],
                    },
                },
            ],
            generatedAt: "2026-08-13T10:00:00.000Z",
            inputSignature: "input-signature",
        });

        const request = requests[WORKING_CORE_OBSERVATION_ID];

        expect(request).toMatchObject({
            solverStatus: "partial",
            layoutSnapshot: {
                workingCore: {
                    requestedItemCount: 2,
                    placedItemCount: 1,
                    unplacedInstanceIds: ["desk-1"],
                },
                specification: {
                    items: [expect.objectContaining({ instanceId: "double-bed-1" })],
                },
            },
        });
        expect(request.inputSnapshot).toMatchObject({
            furniture: instances,
        });
    });
});
