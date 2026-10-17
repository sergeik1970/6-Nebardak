import { getRoomLabCase } from "./room-lab";
import type { LayoutPreferences, Room } from "./types";

export interface GoldenRoomScenario {
    id: string;
    label: string;
    room: Room;
    definitionIds: string[];
    preferences?: LayoutPreferences;
    expectation?:
        | "living-composition"
        | "desk-near-window"
        | "sleep-storage-block"
        | "workplace-block";
}

interface GoldenRoomAdapterDefinition {
    id: string;
    roomLabCaseId: string;
    expectation?: GoldenRoomScenario["expectation"];
}

const GOLDEN_ROOM_ADAPTERS: GoldenRoomAdapterDefinition[] = [
    { id: "compact-bedroom", roomLabCaseId: "BR-01" },
    {
        id: "bedroom-with-storage",
        roomLabCaseId: "BR-03",
        expectation: "sleep-storage-block",
    },
    {
        id: "living-tv-zone",
        roomLabCaseId: "LV-01",
        expectation: "living-composition",
    },
    {
        id: "long-living-room",
        roomLabCaseId: "LV-02",
        expectation: "living-composition",
    },
    {
        id: "workplace-at-window",
        roomLabCaseId: "WK-01",
        expectation: "workplace-block",
    },
    { id: "dresser-away-from-window", roomLabCaseId: "OP-03" },
    { id: "radiator-under-window", roomLabCaseId: "OP-04" },
    { id: "corner-door", roomLabCaseId: "OP-01" },
    { id: "two-windows", roomLabCaseId: "OP-03" },
    { id: "sleep-and-living", roomLabCaseId: "MX-01" },
];

/**
 * Compatibility view for the original ten product fixtures. The executable
 * room lab is now their source of truth, so the two acceptance suites cannot
 * silently drift apart.
 */
export const GOLDEN_ROOM_SCENARIOS: GoldenRoomScenario[] = GOLDEN_ROOM_ADAPTERS.map((adapter) => {
    const roomCase = getRoomLabCase(adapter.roomLabCaseId);
    return {
        id: adapter.id,
        label: roomCase.title,
        room: roomCase.room,
        definitionIds: roomCase.instances.map((instance) => instance.definitionId),
        preferences: roomCase.preferences,
        expectation: adapter.expectation,
    };
});
