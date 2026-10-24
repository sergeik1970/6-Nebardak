import type {
    DoorOpening,
    Placement,
    RadiatorObstacle,
    Room,
    WindowOpening,
} from "@/shared/lib/furniture-planner";
import { createDefaultRoom } from "@/shared/lib/furniture-planner/room";
import { DRAW_ROOM_WALL_LANE_MM } from "@/shared/lib/furniture-planner/draw-room-grid";
import {
    deriveDrawWallGraphRoom,
    type DrawWallSegment,
} from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import {
    getRoomBoundarySegments,
    getRoomVertices,
    signedPolygonArea,
} from "@/shared/lib/furniture-planner/room-geometry";
import type { DrawingProjectScene } from "./project-file";
import { solvedToDrawFurniture } from "./auto-layout";

/** The editor's board; a converted room is centred on it. */
const BOARD = { width: 16_000, height: 10_000 };
const PLACEMENT_STEP_MM = 100;

/** Clear (inside) room sizes the rectangle template accepts, in millimetres. */
export const RECT_TEMPLATE_LIMITS = { min: 2400, max: 10_000 } as const;

type Point = { x: number; y: number };

const sameSegment = (a: { start: Point; end: Point }, b: { start: Point; end: Point }) =>
    a.start.x === b.start.x &&
    a.start.y === b.start.y &&
    a.end.x === b.end.x &&
    a.end.y === b.end.y;

const reversed = <T extends { start: Point; end: Point }>(segment: T): T => ({
    ...segment,
    start: segment.end,
    end: segment.start,
});

/**
 * Turns a planner room (its clear inside contour) into editor walls whose
 * centre lines sit half a wall outside that contour, so the editor derives
 * exactly the same room back. Doors and windows keep their positions; an
 * orthogonal room's openings are re-linked to the editor's segment names.
 * Partitions are not carried over: a room that has them came from the
 * editor in the first place and still has its drawing.
 */
export const roomToDrawingScene = (
    room: Room,
    placements: readonly Placement[] = [],
): DrawingProjectScene | null => {
    const thickness = room.wallThickness ?? DRAW_ROOM_WALL_LANE_MM;
    let vertices = getRoomVertices(room);
    if (vertices.length < 4) return null;
    if (signedPolygonArea(vertices) < 0) vertices = [...vertices].reverse();

    const origin = {
        x: Math.round((BOARD.width - room.width) / 2 / PLACEMENT_STEP_MM) * PLACEMENT_STEP_MM,
        y: Math.round((BOARD.height - room.depth) / 2 / PLACEMENT_STEP_MM) * PLACEMENT_STEP_MM,
    };
    const half = thickness / 2;
    // With a positive area the outward normal of an edge is (dy, -dx); each
    // corner of an orthogonal contour moves along both adjacent normals.
    const outward = (from: Point, to: Point): Point => {
        const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        return { x: (to.y - from.y) / length, y: -(to.x - from.x) / length };
    };
    const centreLine = vertices.map((vertex, index) => {
        const previous = vertices[(index + vertices.length - 1) % vertices.length];
        const next = vertices[(index + 1) % vertices.length];
        const a = outward(previous, vertex);
        const b = outward(vertex, next);
        return {
            x: origin.x + vertex.x + half * (a.x + b.x),
            y: origin.y + vertex.y + half * (a.y + b.y),
        };
    });
    const segments: DrawWallSegment[] = centreLine.map((start, index) => ({
        id: `wall-${index + 1}`,
        start,
        end: centreLine[(index + 1) % centreLine.length],
    }));

    const derived = deriveDrawWallGraphRoom(segments, thickness);
    if (!derived || derived.room.width !== room.width || derived.room.depth !== room.depth) {
        return null;
    }

    const sourceSegments = getRoomBoundarySegments(room);
    const targetSegments = getRoomBoundarySegments(derived.room);
    const relink = <T extends DoorOpening | WindowOpening | RadiatorObstacle>(
        opening: T,
    ): T | null => {
        if ("partitionId" in opening && opening.partitionId) return null;
        const { drawingHostId: _host, ...rest } = opening;
        if (!opening.segmentId) return rest as T;
        const source = sourceSegments.find((segment) => segment.id === opening.segmentId);
        if (!source) return null;
        const same = targetSegments.find((segment) => sameSegment(segment, source));
        if (same) return { ...rest, segmentId: same.id, wall: same.wall } as T;
        const flipped = targetSegments.find((segment) => sameSegment(segment, reversed(source)));
        if (!flipped) return null;
        return {
            ...rest,
            segmentId: flipped.id,
            wall: flipped.wall,
            offset: flipped.length - opening.offset - opening.width,
        } as T;
    };
    const keep = <T>(items: Array<T | null>): T[] =>
        items.filter((item): item is T => item !== null);

    return {
        segments,
        doors: keep(room.doors.map(relink)),
        windows: keep(room.windows.map(relink)),
        ...(room.radiators?.length ? { radiators: keep(room.radiators.map(relink)) } : {}),
        // A saved layout keeps its pieces where they stood in the room.
        furniture: solvedToDrawFurniture([...placements], derived.origin, "furniture-layout"),
        ...(room.wallThickness ? { wallThickness: room.wallThickness } : {}),
    };
};

/**
 * A rectangular room with the planner's starter entrance door and window,
 * sized to the 50 mm planner grid. Both openings can be moved afterwards.
 */
export const createRectTemplateRoom = (
    width: number,
    depth: number,
    wallThickness: Room["wallThickness"],
): Room => ({
    ...createDefaultRoom(width, depth),
    ...(wallThickness ? { wallThickness } : {}),
});
