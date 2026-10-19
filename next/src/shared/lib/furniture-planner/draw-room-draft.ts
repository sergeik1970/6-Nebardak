import { drawingBlockingIssues } from "./draw-furniture-handoff";
import { validateRoomGeometry, validateLayout } from "./geometry";
import { normalizeRoomRegionsState } from "./room-regions";
import { getMaximumFurnitureCount } from "./catalog";
import { getFurniturePhoto } from "./furniture-photos";
import type { Room, Placement } from "./types";

/**
 * A small hand-off cache for the standalone room editor.  The project draft
 * remains the durable source of truth; this key lets an empty new project
 * carry its room into /planner before furniture has been selected.
 */
export const STYLEFINDER_DRAW_ROOM_DRAFT_STORAGE_KEY = "stylefinder:draw-room-draft:v1";

export type DrawRoomDraftResult =
    | { status: "success"; value: Room; placements: Placement[] }
    | { status: "missing" | "unavailable" | "invalid" };

const cloneRoom = (room: Room): Room => ({
    ...room,
    geometry:
        room.geometry?.kind === "orthogonal"
            ? {
                  ...room.geometry,
                  vertices: room.geometry.vertices.map((vertex) => ({ ...vertex })),
              }
            : room.geometry,
    doors: room.doors.map((door) => ({ ...door })),
    partitions:
        room.partitions?.map((partition) => ({
            ...partition,
            start: { ...partition.start },
            end: { ...partition.end },
        })) ?? [],
    windows: room.windows.map((window) => ({ ...window })),
    radiators: room.radiators?.map((radiator) => ({ ...radiator })) ?? [],
    ...(room.regions
        ? {
              regions: {
                  version: 1,
                  items: room.regions.items.map((item) => ({ ...item })),
              },
          }
        : {}),
});

const normalizeRoomMetadata = (room: Room): Room => {
    const regions = normalizeRoomRegionsState(room.regions);
    const { regions: _discardedRegions, wallThickness, ...physicalRoom } = room;
    return {
        ...physicalRoom,
        ...(wallThickness === 50 || wallThickness === 100 ? { wallThickness } : {}),
        ...(regions ? { regions } : {}),
    };
};

const getStorage = (): Storage | null => {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

export const saveDrawRoomDraft = (
    room: Room,
    placements: Placement[] = [],
): DrawRoomDraftResult => {
    const storage = getStorage();
    if (!storage) return { status: "unavailable" };
    if (validateRoomGeometry(room)) return { status: "invalid" };

    const value = cloneRoom(normalizeRoomMetadata(room));
    try {
        storage.setItem(
            STYLEFINDER_DRAW_ROOM_DRAFT_STORAGE_KEY,
            JSON.stringify({ ...value, furniture: placements }),
        );
        return { status: "success", value, placements };
    } catch {
        return { status: "unavailable" };
    }
};

export const readDrawRoomDraft = (): DrawRoomDraftResult => {
    const storage = getStorage();
    if (!storage) return { status: "unavailable" };

    let serialized: string | null;
    try {
        serialized = storage.getItem(STYLEFINDER_DRAW_ROOM_DRAFT_STORAGE_KEY);
    } catch {
        return { status: "unavailable" };
    }
    if (!serialized) return { status: "missing" };

    try {
        const parsed = JSON.parse(serialized) as Room & { furniture?: Placement[] };
        if (!parsed || !Array.isArray(parsed.doors) || !Array.isArray(parsed.windows)) {
            return { status: "invalid" };
        }
        if (validateRoomGeometry(parsed)) return { status: "invalid" };
        const placements = parsed.furniture ?? [];
        if (
            !Array.isArray(placements) ||
            placements.some(
                (item) =>
                    !item ||
                    typeof item.instanceId !== "string" ||
                    typeof item.definitionId !== "string" ||
                    ![item.x, item.y].every(Number.isFinite) ||
                    ![0, 90, 180, 270].includes(item.rotation) ||
                    ((item.width !== undefined || item.depth !== undefined) &&
                        ![item.width, item.depth].every(
                            (value) =>
                                typeof value === "number" &&
                                Number.isFinite(value) &&
                                value >= 10 &&
                                value <= 10000,
                        )),
            )
        )
            return { status: "invalid" };
        const counts: Record<string, number> = {};
        for (const item of placements) {
            const count = (counts[item.definitionId] ?? 0) + 1;
            counts[item.definitionId] = count;
            if (
                count > getMaximumFurnitureCount(item.definitionId) ||
                item.instanceId !== `${item.definitionId}-${count}` ||
                (item.photoId !== undefined &&
                    getFurniturePhoto(item.definitionId, item.photoId)?.id !== item.photoId)
            )
                return { status: "invalid" };
        }
        if (
            placements.length &&
            drawingBlockingIssues(validateLayout(parsed, placements).issues).length > 0
        )
            return { status: "invalid" };
        const { furniture: _furniture, ...room } = parsed;
        return { status: "success", value: cloneRoom(normalizeRoomMetadata(room)), placements };
    } catch {
        return { status: "invalid" };
    }
};
