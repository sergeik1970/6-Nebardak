import { snapToGrid, validateRoomGeometry } from "./geometry";
import { resizeOrthogonalRoomGeometry } from "./room-geometry";
import { Room } from "./types";

export const MIN_ROOM_SIZE_MM = 2400;
export const MAX_ROOM_SIZE_MM = 10_000;

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

const DEFAULT_DOOR_WIDTH_MM = 900;
const STARTER_ROOM_SIZES = [
    [4200, 3400],
    [6000, 4600],
    [7200, 5200],
] as const;

export const createDefaultRoom = (width: number, depth: number): Room => {
    const normalizedWidth = clamp(snapToGrid(width), MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
    const normalizedDepth = clamp(snapToGrid(depth), MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
    const windowWidth = Math.min(1800, Math.max(1000, normalizedWidth - 1200));
    const doorOffset = Math.max(150, Math.min(500, normalizedWidth - DEFAULT_DOOR_WIDTH_MM - 150));
    const windowOffset = Math.max(150, Math.round((normalizedWidth - windowWidth) / 100) * 50);

    return {
        width: normalizedWidth,
        depth: normalizedDepth,
        partitions: [],
        doors: [
            {
                id: "door-main",
                wall: "bottom",
                offset: doorOffset,
                width: DEFAULT_DOOR_WIDTH_MM,
                clearanceDepth: 900,
                hinge: "start",
                swingDirection: "inward",
                doorKind: "room",
            },
        ],
        radiators: [],
        windows: [
            {
                id: "window-main",
                wall: "top",
                offset: windowOffset,
                width: windowWidth,
                windowKind: "standard",
            },
        ],
    };
};

const sameOpenings = (room: Room, defaults: Room): boolean =>
    (room.radiators?.length ?? 0) === 0 &&
    JSON.stringify(room.doors) === JSON.stringify(defaults.doors) &&
    JSON.stringify(room.windows) === JSON.stringify(defaults.windows);

const openingsUseStarterRoomGeometry = (room: Room): boolean => {
    const defaults = createDefaultRoom(room.width, room.depth);
    return (
        sameOpenings(room, defaults) ||
        STARTER_ROOM_SIZES.some(([width, depth]) =>
            sameOpenings(room, createDefaultRoom(width, depth)),
        )
    );
};

/**
 * Changes only room dimensions. Openings retain the exact coordinates entered
 * by the user; if a smaller room makes one invalid, `validateRoomGeometry`
 * reports `invalid-room` instead of silently moving designer/user data.
 */
export const resizeRoom = (room: Room, width: number, depth: number): Room => {
    const normalizedWidth = clamp(snapToGrid(width), MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
    const normalizedDepth = clamp(snapToGrid(depth), MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
    const resized = { ...room, width: normalizedWidth, depth: normalizedDepth };
    if (room.geometry?.kind !== "orthogonal") return resized;

    const geometry = resizeOrthogonalRoomGeometry(room, normalizedWidth, normalizedDepth);
    return geometry.status === "success" ? { ...resized, geometry: geometry.geometry } : room;
};

export type RoomResizeResult =
    | { status: "success"; room: Room }
    | { status: "invalid"; message: string };

/**
 * The UI entry point for committed resizing. Custom contours are committed
 * only when their geometry and opening anchors remain valid. A rectangle
 * preserves the established explicit-repair flow for an oversized opening:
 * changing its dimensions remains visible to the user, then the opening can
 * be repaired with the dedicated action instead of being silently moved.
 */
export const tryResizeRoomWithDefaultOpenings = (
    room: Room,
    width: number,
    depth: number,
): RoomResizeResult => {
    const normalizedWidth = clamp(snapToGrid(width), MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
    const normalizedDepth = clamp(snapToGrid(depth), MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
    let candidate: Room;

    if (room.geometry?.kind === "orthogonal") {
        const geometry = resizeOrthogonalRoomGeometry(room, normalizedWidth, normalizedDepth);
        if (geometry.status === "invalid") return geometry;
        candidate = {
            ...room,
            width: normalizedWidth,
            depth: normalizedDepth,
            geometry: geometry.geometry,
        };
    } else {
        candidate = openingsUseStarterRoomGeometry(room)
            ? createDefaultRoom(normalizedWidth, normalizedDepth)
            : { ...room, width: normalizedWidth, depth: normalizedDepth };
    }

    if (candidate.geometry?.kind !== "orthogonal") {
        return { status: "success", room: candidate };
    }

    const error = validateRoomGeometry(candidate);
    return error ? { status: "invalid", message: error } : { status: "success", room: candidate };
};

/**
 * Repairs a starter door/window pair that was preserved from a previous room
 * preset. Deliberately edited openings never match a complete starter pair and
 * are therefore left untouched.
 */
export const alignStarterOpeningsToRoom = (room: Room): Room =>
    openingsUseStarterRoomGeometry(room) ? createDefaultRoom(room.width, room.depth) : room;

/**
 * Keeps manually edited openings fixed, but adapts untouched starter openings
 * to the new room size. Otherwise a default window from a smaller room can
 * silently become an accidental hard constraint after resizing.
 */
export const resizeRoomWithDefaultOpenings = (room: Room, width: number, depth: number): Room => {
    const resized = resizeRoom(room, width, depth);
    if (room.geometry?.kind === "orthogonal") return resized;
    return openingsUseStarterRoomGeometry(room)
        ? createDefaultRoom(resized.width, resized.depth)
        : resized;
};
