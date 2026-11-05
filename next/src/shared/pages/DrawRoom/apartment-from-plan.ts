import { validateRoomGeometry } from "@/shared/lib/furniture-planner/geometry";
import {
    deriveDrawWallGraphRoom,
    type DrawWallSegment,
} from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import {
    getRoomBoundarySegments,
    getRoomPartitionSegments,
    pointInsideRoom,
} from "@/shared/lib/furniture-planner/room-geometry";
import {
    getDrawRoomRegions,
    toRoomRegionMetadata,
} from "@/shared/lib/furniture-planner/room-regions";
import type {
    DoorOpening,
    Room,
    RoomBoundarySegment,
    RoomPartition,
    WindowOpening,
} from "@/shared/lib/furniture-planner/types";
import {
    ASSEMBLY_OUTER_WALL_MM,
    type AssembledApartment,
} from "@/shared/lib/plan-recognition/assemble";
import type { DrawingProjectScene } from "./project-file";

type Point = { x: number; y: number };

const DOOR_SWINGS: [
    NonNullable<DoorOpening["hinge"]>,
    NonNullable<DoorOpening["swingDirection"]>,
][] = [
    ["start", "inward"],
    ["end", "inward"],
    ["start", "outward"],
    ["end", "outward"],
];

const onLine = (point: Point, start: Point, end: Point) =>
    start.x === end.x
        ? point.x === start.x &&
          point.y >= Math.min(start.y, end.y) &&
          point.y <= Math.max(start.y, end.y)
        : point.y === start.y &&
          point.x >= Math.min(start.x, end.x) &&
          point.x <= Math.max(start.x, end.x);

/** The editor's own rule: a wall not on the closed contour is a partition. */
const partitionsOf = (
    segments: DrawWallSegment[],
    derived: NonNullable<ReturnType<typeof deriveDrawWallGraphRoom>>,
    wallThickness: number,
): RoomPartition[] => {
    const contour = derived.contour;
    const onContour = (segment: DrawWallSegment) =>
        contour.some((start, index) => {
            const end = contour[(index + 1) % contour.length];
            const same =
                (segment.start.y === segment.end.y && start.y === end.y) ||
                (segment.start.x === segment.end.x && start.x === end.x);
            return same && onLine(segment.start, start, end) && onLine(segment.end, start, end);
        });
    const interior = (point: Point, other: Point): Point | null => {
        const local = { x: point.x - derived.origin.x, y: point.y - derived.origin.y };
        const otherLocal = { x: other.x - derived.origin.x, y: other.y - derived.origin.y };
        const length = Math.abs(otherLocal.x - local.x) + Math.abs(otherLocal.y - local.y);
        if (!length) return null;
        const direction = {
            x: (otherLocal.x - local.x) / length,
            y: (otherLocal.y - local.y) / length,
        };
        for (const distance of [0, wallThickness / 2, wallThickness]) {
            const candidate = {
                x: local.x + direction.x * distance,
                y: local.y + direction.y * distance,
            };
            if (pointInsideRoom(derived.room, candidate)) return candidate;
        }
        return null;
    };
    return segments.flatMap((segment) => {
        if (onContour(segment)) return [];
        const start = interior(segment.start, segment.end);
        const end = interior(segment.end, segment.start);
        if (!start || !end || (start.x === end.x && start.y === end.y)) return [];
        return [
            {
                id: `partition-${segment.id}`,
                start,
                end,
                thickness: segment.thickness ?? wallThickness,
            },
        ];
    });
};

const along = (segment: RoomBoundarySegment, point: Point) => {
    const dx = (segment.end.x - segment.start.x) / segment.length;
    const dy = (segment.end.y - segment.start.y) / segment.length;
    const t = (point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy;
    const across = Math.abs((point.x - segment.start.x) * dy - (point.y - segment.start.y) * dx);
    const clamped = Math.max(0, Math.min(segment.length, t));
    return { t: clamped, distance: across + Math.abs(t - clamped) };
};

/**
 * The flat as the editor derives it from a drawing's walls: its clear room
 * with partitions, and where that room's origin lies on the board.
 */
export const drawingRoomOf = (
    segments: DrawWallSegment[],
    wallThickness: number = ASSEMBLY_OUTER_WALL_MM,
): { room: Room; origin: Point } | null => {
    const derived = deriveDrawWallGraphRoom(segments, wallThickness);
    if (!derived) return null;
    return {
        room: {
            ...derived.room,
            partitions: partitionsOf(segments, derived, wallThickness),
            doors: [],
            windows: [],
            radiators: [],
        },
        origin: derived.origin,
    };
};

export interface ApartmentImport {
    scene: DrawingProjectScene;
    /** The flat as the editor derives it from `scene`: partitions, doors and windows included. */
    room: Room;
    rooms: number;
    named: number;
    openingsPlaced: number;
    openingsDropped: number;
    /** Windows between a room and a loggia: not representable in the planner yet. */
    windowsOnPartitions: number;
}

/**
 * Turns an assembled apartment into an editor drawing: the walls as they are,
 * every room named where its region is, windows on the outer walls and doors
 * on whichever wall or partition they sit in. Anything the planner's rules
 * refuse is left out and counted.
 */
export const apartmentToDrawingScene = (assembled: AssembledApartment): ApartmentImport | null => {
    const wallThickness = ASSEMBLY_OUTER_WALL_MM;
    const derived = deriveDrawWallGraphRoom(assembled.segments, wallThickness);
    if (!derived) return null;
    const partitions = partitionsOf(assembled.segments, derived, wallThickness);
    const room: Room = { ...derived.room, partitions, doors: [], windows: [], radiators: [] };
    const toLocal = (point: Point) => ({
        x: point.x - derived.origin.x,
        y: point.y - derived.origin.y,
    });

    const regions = getDrawRoomRegions(room);
    const items = assembled.rooms.flatMap((source) => {
        const point = toLocal(source.inside);
        // The region around the room's inner point, or the nearest one when the
        // point fell into a wall that moved during assembly.
        const distanceTo = (candidate: (typeof regions)[number]) =>
            Math.min(
                ...candidate.clearRects.map(
                    (rect) =>
                        Math.max(rect.left - point.x, 0, point.x - rect.right) +
                        Math.max(rect.top - point.y, 0, point.y - rect.bottom),
                ),
            );
        const region = [...regions].sort((a, b) => distanceTo(a) - distanceTo(b))[0];
        return region
            ? [
                  toRoomRegionMetadata({
                      signature: region.signature,
                      name: source.label,
                      kind: source.kind,
                  }),
              ]
            : [];
    });
    const unique = items.filter(
        (item, index) => items.findIndex((other) => other.signature === item.signature) === index,
    );

    const outer = getRoomBoundarySegments(room);
    const inner = getRoomPartitionSegments(room);
    const doors: DoorOpening[] = [];
    const windows: WindowOpening[] = [];
    let dropped = 0;
    let windowsOnPartitions = 0;
    // A door between two rooms is listed by both of them: place it once.
    const placedDoorCentres: Point[] = [];
    const ordered = [...assembled.openings].sort(
        (first, second) => Number(first.kind !== "window") - Number(second.kind !== "window"),
    );
    ordered.forEach((opening, index) => {
        const from = toLocal(opening.from);
        const to = toLocal(opening.to);
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const candidates = [
            ...outer.map((segment) => ({ segment, partition: false })),
            ...(opening.kind === "door"
                ? inner.map((segment) => ({ segment, partition: true }))
                : []),
        ]
            .map((candidate) => ({
                ...candidate,
                distance: along(candidate.segment, middle).distance,
            }))
            .sort((first, second) => first.distance - second.distance);
        const best = candidates[0];
        if (
            opening.kind === "door" &&
            placedDoorCentres.some(
                (centre) => Math.abs(centre.x - middle.x) + Math.abs(centre.y - middle.y) < 600,
            )
        )
            return;
        // An outer wall is thick and the model measures to its inner face.
        if (!best || best.distance > (opening.kind === "window" ? 800 : 450)) {
            // A window in a partition looks onto a loggia; the planner has no such window yet.
            const partition = inner.some((segment) => along(segment, middle).distance <= 450);
            if (opening.kind === "window" && partition) windowsOnPartitions += 1;
            else dropped += 1;
            return;
        }
        const a = along(best.segment, from).t;
        const b = along(best.segment, to).t;
        const offset = Math.round(Math.min(a, b));
        const width = Math.round(Math.abs(b - a));
        if (width < 300 || offset + width > best.segment.length) return void (dropped += 1);
        const anchor = best.partition
            ? { wall: best.segment.wall, partitionId: best.segment.id, offset, width }
            : {
                  wall: best.segment.wall,
                  ...(room.geometry?.kind === "orthogonal" ? { segmentId: best.segment.id } : {}),
                  offset,
                  width,
              };
        if (opening.kind === "window") {
            const window: WindowOpening = {
                id: `window-${index + 1}`,
                ...anchor,
                windowKind: "standard",
            };
            if (validateRoomGeometry({ ...room, doors, windows: [...windows, window] }))
                dropped += 1;
            else windows.push(window);
            return;
        }
        const door = DOOR_SWINGS.map(
            ([hinge, swingDirection]): DoorOpening => ({
                id: `door-${index + 1}`,
                ...anchor,
                clearanceDepth: Math.min(900, width + 100),
                hinge,
                swingDirection,
                doorKind: "room",
            }),
        ).find(
            (candidate) =>
                !validateRoomGeometry({ ...room, doors: [...doors, candidate], windows }),
        );
        if (door) {
            doors.push(door);
            placedDoorCentres.push(middle);
        } else dropped += 1;
    });

    return {
        scene: {
            segments: assembled.segments,
            doors,
            windows,
            radiators: [],
            wallThickness,
            ...(unique.length ? { regions: { version: 1, items: unique } } : {}),
        },
        room: { ...room, doors, windows },
        rooms: regions.length,
        named: unique.length,
        openingsPlaced: doors.length + windows.length,
        openingsDropped: dropped,
        windowsOnPartitions,
    };
};
