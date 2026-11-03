import type { RoomKind } from "./types";

/** What the suggestion needs to know about each room of the apartment. */
export interface RoomForSuggestion {
    signature: string;
    areaM2: number;
    windowCount: number;
    /** The shorter and longer sides of the room's bounds, mm. */
    shortSideMm: number;
    longSideMm: number;
    /** Set by the person: kept as it is and never suggested over. */
    kind?: RoomKind;
}

export interface RoomKindSuggestion {
    signature: string;
    kind: RoomKind;
    reason: string;
}

const BATHROOM_MAX_M2 = 6;
const KITCHEN_MIN_M2 = 5;
const KITCHEN_MAX_M2 = 12;
const KITCHEN_LIVING_MIN_M2 = 25;

/**
 * Suggests a kind for every room the person has not named, from area,
 * windows and shape alone. It is a first guess to correct, not a ruling:
 * without plumbing on the drawing a kitchen and a small bedroom look alike.
 */
export const suggestRoomKinds = (rooms: RoomForSuggestion[]): RoomKindSuggestion[] => {
    const suggestions: RoomKindSuggestion[] = [];
    const taken = new Set(rooms.flatMap((room) => (room.kind ? [room.kind] : [])));
    const suggest = (room: RoomForSuggestion, kind: RoomKind, reason: string) => {
        suggestions.push({ signature: room.signature, kind, reason });
        taken.add(kind);
    };
    const open = rooms.filter((room) => !room.kind);

    for (const room of open.filter((candidate) => candidate.windowCount === 0)) {
        const elongated = room.longSideMm >= 2 * room.shortSideMm || room.shortSideMm < 1600;
        if (room.areaM2 <= BATHROOM_MAX_M2 && !elongated)
            suggest(room, "bathroom", "небольшое помещение без окна");
        else suggest(room, "hallway", "помещение без окна");
    }

    const windowed = open
        .filter((room) => room.windowCount > 0)
        .sort(
            (first, second) =>
                second.areaM2 - first.areaM2 || first.signature.localeCompare(second.signature),
        );
    const allWindowed = rooms.filter((room) => room.windowCount > 0);

    // A studio: the only room with a window is where people both cook and live.
    if (allWindowed.length === 1 && windowed.length === 1 && !taken.has("kitchen")) {
        suggest(windowed[0], "kitchen-living", "единственная комната с окном");
        return suggestions;
    }

    const rest = [...windowed];
    if (!taken.has("kitchen") && !taken.has("kitchen-living") && allWindowed.length > 1) {
        const kitchen = [...rest]
            .reverse()
            .find((room) => room.areaM2 >= KITCHEN_MIN_M2 && room.areaM2 <= KITCHEN_MAX_M2);
        if (kitchen) {
            suggest(kitchen, "kitchen", "самое небольшое помещение с окном");
            rest.splice(rest.indexOf(kitchen), 1);
        }
    }

    const living = rest.shift();
    if (living && !taken.has("living") && !taken.has("kitchen-living")) {
        if (!taken.has("kitchen") && living.areaM2 >= KITCHEN_LIVING_MIN_M2)
            suggest(living, "kitchen-living", "самая большая комната, отдельной кухни нет");
        else suggest(living, "living", "самая большая комната");
    } else if (living) {
        rest.unshift(living);
    }

    for (const room of rest) suggest(room, "bedroom", "жилая комната с окном");
    return suggestions;
};
