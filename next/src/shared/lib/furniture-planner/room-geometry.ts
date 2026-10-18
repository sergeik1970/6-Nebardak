import {
    Rect,
    Room,
    RoomBoundarySegment,
    RoomGeometry,
    RoomPartition,
    RoomVertex,
    Wall,
} from "./types";

export const ROOM_GEOMETRY_VERSION = 1 as const;
export const MIN_ORTHOGONAL_SEGMENT_MM = 500;

const EPSILON = 0.0001;

export const canonicalRoomGeometry = (room: Room): RoomGeometry =>
    room.geometry ?? { version: ROOM_GEOMETRY_VERSION, kind: "rect" };

const rectSegments = (room: Room): RoomBoundarySegment[] => [
    {
        id: "rect-top",
        start: { x: 0, y: 0 },
        end: { x: room.width, y: 0 },
        length: room.width,
        orientation: "horizontal",
        wall: "top",
        inwardNormal: { x: 0, y: 1 },
    },
    {
        id: "rect-right",
        start: { x: room.width, y: 0 },
        end: { x: room.width, y: room.depth },
        length: room.depth,
        orientation: "vertical",
        wall: "right",
        inwardNormal: { x: -1, y: 0 },
    },
    {
        id: "rect-bottom",
        start: { x: 0, y: room.depth },
        end: { x: room.width, y: room.depth },
        length: room.width,
        orientation: "horizontal",
        wall: "bottom",
        inwardNormal: { x: 0, y: -1 },
    },
    {
        id: "rect-left",
        start: { x: 0, y: 0 },
        end: { x: 0, y: room.depth },
        length: room.depth,
        orientation: "vertical",
        wall: "left",
        inwardNormal: { x: 1, y: 0 },
    },
];

const wallFromNormal = (x: number, y: number): Wall => {
    if (y > 0) return "top";
    if (x < 0) return "right";
    if (y < 0) return "bottom";
    return "left";
};

export const signedPolygonArea = (vertices: RoomVertex[]): number =>
    vertices.reduce((sum, vertex, index) => {
        const next = vertices[(index + 1) % vertices.length];
        return sum + vertex.x * next.y - next.x * vertex.y;
    }, 0) / 2;

export const getRoomBoundarySegments = (room: Room): RoomBoundarySegment[] => {
    const geometry = canonicalRoomGeometry(room);
    if (geometry.kind === "rect") return rectSegments(room);

    return geometry.vertices.map((start, index) => {
        const end = geometry.vertices[(index + 1) % geometry.vertices.length];
        const horizontal = start.y === end.y;
        const length = horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y);
        const directionX = length > 0 ? (end.x - start.x) / length : 0;
        const directionY = length > 0 ? (end.y - start.y) / length : 0;
        const inwardNormal = {
            x: -directionY as -1 | 0 | 1,
            y: directionX as -1 | 0 | 1,
        };

        return {
            id: `segment-${start.id}`,
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            length,
            orientation: horizontal ? "horizontal" : "vertical",
            wall: wallFromNormal(inwardNormal.x, inwardNormal.y),
            inwardNormal,
        };
    });
};

const getRoomPartitionSegment = (partition: RoomPartition): RoomBoundarySegment | null => {
    const deltaX = partition.end.x - partition.start.x;
    const deltaY = partition.end.y - partition.start.y;
    const length = Math.abs(deltaX) + Math.abs(deltaY);
    if (!length || (deltaX !== 0 && deltaY !== 0)) return null;

    const inwardNormal = {
        x: (-deltaY / length) as -1 | 0 | 1,
        y: (deltaX / length) as -1 | 0 | 1,
    };
    return {
        id: partition.id,
        start: { ...partition.start },
        end: { ...partition.end },
        length,
        orientation: deltaY === 0 ? "horizontal" : "vertical",
        // This is a stable normal-side label for legacy door geometry. It is
        // not an exterior room wall: for a partition it means the left side
        // of the directed segment.
        wall: wallFromNormal(inwardNormal.x, inwardNormal.y),
        inwardNormal,
    };
};

export const getRoomPartitionSegments = (room: Room): RoomBoundarySegment[] =>
    (room.partitions ?? [])
        .map(getRoomPartitionSegment)
        .filter((segment): segment is RoomBoundarySegment => Boolean(segment));

export const getRoomPartition = (room: Room, partitionId: string): RoomPartition | null =>
    room.partitions?.find((partition) => partition.id === partitionId) ?? null;

export const getRoomVertices = (room: Room): RoomVertex[] => {
    const geometry = canonicalRoomGeometry(room);
    if (geometry.kind === "orthogonal") return geometry.vertices.map((vertex) => ({ ...vertex }));

    return [
        { id: "rect-top-left", x: 0, y: 0 },
        { id: "rect-top-right", x: room.width, y: 0 },
        { id: "rect-bottom-right", x: room.width, y: room.depth },
        { id: "rect-bottom-left", x: 0, y: room.depth },
    ];
};

export const getRoomArea = (room: Room): number =>
    canonicalRoomGeometry(room).kind === "rect"
        ? room.width * room.depth
        : Math.abs(signedPolygonArea(getRoomVertices(room)));

export const getRoomCentroid = (room: Room): { x: number; y: number } => {
    const geometry = canonicalRoomGeometry(room);
    if (geometry.kind === "rect") return { x: room.width / 2, y: room.depth / 2 };

    const vertices = geometry.vertices;
    const areaFactor = vertices.reduce((sum, vertex, index) => {
        const next = vertices[(index + 1) % vertices.length];
        return sum + vertex.x * next.y - next.x * vertex.y;
    }, 0);
    if (Math.abs(areaFactor) < EPSILON) return { x: room.width / 2, y: room.depth / 2 };

    const weighted = vertices.reduce(
        (sum, vertex, index) => {
            const next = vertices[(index + 1) % vertices.length];
            const cross = vertex.x * next.y - next.x * vertex.y;
            return {
                x: sum.x + (vertex.x + next.x) * cross,
                y: sum.y + (vertex.y + next.y) * cross,
            };
        },
        { x: 0, y: 0 },
    );

    return {
        x: weighted.x / (3 * areaFactor),
        y: weighted.y / (3 * areaFactor),
    };
};

const pointOnSegment = (
    point: { x: number; y: number },
    segment: Pick<RoomBoundarySegment, "start" | "end">,
): boolean => {
    const cross =
        (point.x - segment.start.x) * (segment.end.y - segment.start.y) -
        (point.y - segment.start.y) * (segment.end.x - segment.start.x);
    if (Math.abs(cross) > EPSILON) return false;

    return (
        point.x >= Math.min(segment.start.x, segment.end.x) - EPSILON &&
        point.x <= Math.max(segment.start.x, segment.end.x) + EPSILON &&
        point.y >= Math.min(segment.start.y, segment.end.y) - EPSILON &&
        point.y <= Math.max(segment.start.y, segment.end.y) + EPSILON
    );
};

export const pointInsideRoom = (room: Room, point: { x: number; y: number }): boolean => {
    if (
        point.x < -EPSILON ||
        point.y < -EPSILON ||
        point.x > room.width + EPSILON ||
        point.y > room.depth + EPSILON
    ) {
        return false;
    }
    if (canonicalRoomGeometry(room).kind === "rect") return true;

    const segments = getRoomBoundarySegments(room);
    if (segments.some((segment) => pointOnSegment(point, segment))) return true;

    let inside = false;
    const vertices = getRoomVertices(room);
    for (
        let index = 0, previous = vertices.length - 1;
        index < vertices.length;
        previous = index++
    ) {
        const currentVertex = vertices[index];
        const previousVertex = vertices[previous];
        const crossesRay =
            currentVertex.y > point.y !== previousVertex.y > point.y &&
            point.x <
                ((previousVertex.x - currentVertex.x) * (point.y - currentVertex.y)) /
                    (previousVertex.y - currentVertex.y) +
                    currentVertex.x;
        if (crossesRay) inside = !inside;
    }
    return inside;
};

const segmentPassesThroughRectInterior = (segment: RoomBoundarySegment, rect: Rect): boolean => {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.depth;
    if (segment.orientation === "vertical") {
        const overlap =
            Math.min(Math.max(segment.start.y, segment.end.y), bottom) -
            Math.max(Math.min(segment.start.y, segment.end.y), rect.y);
        return (
            segment.start.x > rect.x + EPSILON &&
            segment.start.x < right - EPSILON &&
            overlap > EPSILON
        );
    }

    const overlap =
        Math.min(Math.max(segment.start.x, segment.end.x), right) -
        Math.max(Math.min(segment.start.x, segment.end.x), rect.x);
    return (
        segment.start.y > rect.y + EPSILON &&
        segment.start.y < bottom - EPSILON &&
        overlap > EPSILON
    );
};

export const rectInsideRoomGeometry = (rect: Rect, room: Room): boolean => {
    if (rect.width < 0 || rect.depth < 0) return false;
    const points = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.depth },
        { x: rect.x, y: rect.y + rect.depth },
        { x: rect.x + rect.width / 2, y: rect.y + rect.depth / 2 },
    ];

    return (
        points.every((point) => pointInsideRoom(room, point)) &&
        !getRoomBoundarySegments(room).some((segment) =>
            segmentPassesThroughRectInterior(segment, rect),
        )
    );
};

const segmentsIntersect = (first: RoomBoundarySegment, second: RoomBoundarySegment): boolean => {
    if (first.orientation === second.orientation) {
        if (
            first.orientation === "horizontal" &&
            Math.abs(first.start.y - second.start.y) < EPSILON
        ) {
            return (
                Math.max(
                    Math.min(first.start.x, first.end.x),
                    Math.min(second.start.x, second.end.x),
                ) <=
                Math.min(
                    Math.max(first.start.x, first.end.x),
                    Math.max(second.start.x, second.end.x),
                ) +
                    EPSILON
            );
        }
        if (
            first.orientation === "vertical" &&
            Math.abs(first.start.x - second.start.x) < EPSILON
        ) {
            return (
                Math.max(
                    Math.min(first.start.y, first.end.y),
                    Math.min(second.start.y, second.end.y),
                ) <=
                Math.min(
                    Math.max(first.start.y, first.end.y),
                    Math.max(second.start.y, second.end.y),
                ) +
                    EPSILON
            );
        }
        return false;
    }

    const horizontal = first.orientation === "horizontal" ? first : second;
    const vertical = first.orientation === "vertical" ? first : second;
    return (
        vertical.start.x >= Math.min(horizontal.start.x, horizontal.end.x) - EPSILON &&
        vertical.start.x <= Math.max(horizontal.start.x, horizontal.end.x) + EPSILON &&
        horizontal.start.y >= Math.min(vertical.start.y, vertical.end.y) - EPSILON &&
        horizontal.start.y <= Math.max(vertical.start.y, vertical.end.y) + EPSILON
    );
};

export const validateOrthogonalRoomGeometry = (room: Room): string | null => {
    const geometry = canonicalRoomGeometry(room);
    if (geometry.kind === "rect") return null;
    const { vertices } = geometry;
    if (geometry.version !== ROOM_GEOMETRY_VERSION || vertices.length < 6 || vertices.length > 16) {
        return "Контур комнаты должен содержать от 6 до 16 вершин.";
    }
    const ids = new Set<string>();
    for (const vertex of vertices) {
        if (
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(vertex.id) ||
            ids.has(vertex.id) ||
            !Number.isFinite(vertex.x) ||
            !Number.isFinite(vertex.y) ||
            vertex.x < 0 ||
            vertex.y < 0 ||
            vertex.x > 10_000 ||
            vertex.y > 10_000 ||
            vertex.x % 50 !== 0 ||
            vertex.y % 50 !== 0
        ) {
            return "Вершины контура должны быть уникальными и находиться на сетке 50 мм.";
        }
        ids.add(vertex.id);
    }

    const segments = getRoomBoundarySegments(room);
    if (
        segments.some(
            (segment) =>
                segment.length < MIN_ORTHOGONAL_SEGMENT_MM ||
                (segment.start.x !== segment.end.x && segment.start.y !== segment.end.y),
        )
    ) {
        return `Все стены должны быть ортогональными и иметь длину не менее ${MIN_ORTHOGONAL_SEGMENT_MM} мм.`;
    }
    if (
        segments.some((segment, index) => {
            const next = segments[(index + 1) % segments.length];
            return segment.orientation === next.orientation;
        })
    ) {
        return "Соседние стены контура не должны быть коллинеарными.";
    }
    if (signedPolygonArea(vertices) <= 0) {
        return "Контур комнаты должен быть задан по часовой стрелке и иметь положительную площадь.";
    }

    const minX = Math.min(...vertices.map((vertex) => vertex.x));
    const minY = Math.min(...vertices.map((vertex) => vertex.y));
    const maxX = Math.max(...vertices.map((vertex) => vertex.x));
    const maxY = Math.max(...vertices.map((vertex) => vertex.y));
    if (minX !== 0 || minY !== 0 || maxX !== room.width || maxY !== room.depth) {
        return "Габариты контура должны совпадать с шириной и глубиной комнаты.";
    }

    for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
            const adjacent =
                secondIndex === firstIndex + 1 ||
                (firstIndex === 0 && secondIndex === segments.length - 1);
            if (!adjacent && segmentsIntersect(segments[firstIndex], segments[secondIndex])) {
                return "Стены контура не должны пересекаться или касаться друг друга.";
            }
        }
    }

    return null;
};

export const getRoomSegment = (
    room: Room,
    opening: { wall: Wall; segmentId?: string; partitionId?: string },
): RoomBoundarySegment | null => {
    if (opening.partitionId) {
        return (
            getRoomPartitionSegments(room).find((segment) => segment.id === opening.partitionId) ??
            null
        );
    }
    const segments = getRoomBoundarySegments(room);
    if (canonicalRoomGeometry(room).kind === "rect") {
        return segments.find((segment) => segment.wall === opening.wall) ?? null;
    }
    if (opening.segmentId) {
        return segments.find((segment) => segment.id === opening.segmentId) ?? null;
    }
    return null;
};

export const getSegmentSpanRect = (
    segment: RoomBoundarySegment,
    offset: number,
    width: number,
    inwardStart: number,
    inwardDepth: number,
): Rect => {
    const tangent = {
        x: (segment.end.x - segment.start.x) / segment.length,
        y: (segment.end.y - segment.start.y) / segment.length,
    };
    const points = [
        {
            x: segment.start.x + tangent.x * offset + segment.inwardNormal.x * inwardStart,
            y: segment.start.y + tangent.y * offset + segment.inwardNormal.y * inwardStart,
        },
        {
            x:
                segment.start.x +
                tangent.x * (offset + width) +
                segment.inwardNormal.x * inwardStart,
            y:
                segment.start.y +
                tangent.y * (offset + width) +
                segment.inwardNormal.y * inwardStart,
        },
        {
            x:
                segment.start.x +
                tangent.x * offset +
                segment.inwardNormal.x * (inwardStart + inwardDepth),
            y:
                segment.start.y +
                tangent.y * offset +
                segment.inwardNormal.y * (inwardStart + inwardDepth),
        },
        {
            x:
                segment.start.x +
                tangent.x * (offset + width) +
                segment.inwardNormal.x * (inwardStart + inwardDepth),
            y:
                segment.start.y +
                tangent.y * (offset + width) +
                segment.inwardNormal.y * (inwardStart + inwardDepth),
        },
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        depth: Math.max(...ys) - Math.min(...ys),
    };
};

export const projectPointToSegmentOffset = (
    segment: RoomBoundarySegment,
    point: { x: number; y: number },
): number => {
    const tangentX = (segment.end.x - segment.start.x) / segment.length;
    const tangentY = (segment.end.y - segment.start.y) / segment.length;
    return (point.x - segment.start.x) * tangentX + (point.y - segment.start.y) * tangentY;
};

export const rectTouchesRoomBoundary = (rect: Rect, room: Room, wall: Wall): boolean =>
    getRoomBoundarySegments(room).some((segment) => {
        if (segment.wall !== wall) return false;
        if (wall === "top" || wall === "bottom") {
            const edgeY = wall === "top" ? rect.y : rect.y + rect.depth;
            const overlap =
                Math.min(rect.x + rect.width, Math.max(segment.start.x, segment.end.x)) -
                Math.max(rect.x, Math.min(segment.start.x, segment.end.x));
            return Math.abs(edgeY - segment.start.y) < EPSILON && overlap > EPSILON;
        }
        const edgeX = wall === "left" ? rect.x : rect.x + rect.width;
        const overlap =
            Math.min(rect.y + rect.depth, Math.max(segment.start.y, segment.end.y)) -
            Math.max(rect.y, Math.min(segment.start.y, segment.end.y));
        return Math.abs(edgeX - segment.start.x) < EPSILON && overlap > EPSILON;
    });

export const createLRoomGeometry = (
    width: number,
    depth: number,
    side: "left" | "right" = "right",
): RoomGeometry => {
    const notchWidth = Math.max(MIN_ORTHOGONAL_SEGMENT_MM, Math.round((width * 0.4) / 50) * 50);
    const notchDepth = Math.max(MIN_ORTHOGONAL_SEGMENT_MM, Math.round((depth * 0.4) / 50) * 50);
    if (side === "right") {
        return {
            version: 1,
            kind: "orthogonal",
            vertices: [
                { id: "v1", x: 0, y: 0 },
                { id: "v2", x: width - notchWidth, y: 0 },
                { id: "v3", x: width - notchWidth, y: notchDepth },
                { id: "v4", x: width, y: notchDepth },
                { id: "v5", x: width, y: depth },
                { id: "v6", x: 0, y: depth },
            ],
        };
    }
    return {
        version: 1,
        kind: "orthogonal",
        vertices: [
            { id: "v1", x: notchWidth, y: 0 },
            { id: "v2", x: width, y: 0 },
            { id: "v3", x: width, y: depth },
            { id: "v4", x: 0, y: depth },
            { id: "v5", x: 0, y: notchDepth },
            { id: "v6", x: notchWidth, y: notchDepth },
        ],
    };
};

/** Reanchors every wall item when a user explicitly changes the room shape. */
export const applyRoomGeometry = (room: Room, geometry: RoomGeometry): Room => {
    const shapedRoom: Room = { ...room, geometry };
    const segments = getRoomBoundarySegments(shapedRoom);
    const anchor = <T extends { wall: Wall; segmentId?: string; offset: number; width: number }>(
        item: T,
    ): T => {
        const currentSegment = item.segmentId
            ? segments.find(
                  (segment) => segment.id === item.segmentId && segment.length >= item.width,
              )
            : undefined;
        const candidates = segments.filter(
            (segment) => segment.wall === item.wall && segment.length >= item.width,
        );
        const fallback = segments.filter((segment) => segment.length >= item.width);
        const segment =
            currentSegment ??
            [...(candidates.length > 0 ? candidates : fallback)].sort(
                (first, second) =>
                    second.length - first.length || first.id.localeCompare(second.id),
            )[0];
        if (!segment) return item;
        return {
            ...item,
            wall: segment.wall,
            segmentId: segment.id,
            offset: Math.min(Math.max(0, item.offset), segment.length - item.width),
        };
    };

    return {
        ...shapedRoom,
        doors: shapedRoom.doors.map(anchor),
        windows: shapedRoom.windows.map(anchor),
        radiators: (shapedRoom.radiators ?? []).map(anchor),
    };
};

export const PLANNER_GRID_MM = 50;

const snapToPlannerGrid = (value: number): number =>
    Math.round(value / PLANNER_GRID_MM) * PLANNER_GRID_MM;

export interface PlannerGridSnapResult {
    room: Room;
    /** Largest coordinate shift applied to the contour, in millimetres. */
    maxShift: number;
}

/**
 * DrawRoom keeps 10 mm construction coordinates, while the planner's contour
 * contract, boundary editor and solver work on a 50 mm lattice. Snapping is a
 * monotone per-axis map, so walls that met or ran collinear still do, and an
 * opening keeps its absolute position along the moved wall; only its offset is
 * re-derived and clamped. Opening and radiator widths are product sizes and
 * stay exact.
 */
export const snapRoomToPlannerGrid = (room: Room): PlannerGridSnapResult => {
    const geometry = canonicalRoomGeometry(room);
    const vertices =
        geometry.kind === "orthogonal"
            ? geometry.vertices.map((vertex) => ({
                  ...vertex,
                  x: snapToPlannerGrid(vertex.x),
                  y: snapToPlannerGrid(vertex.y),
              }))
            : null;
    const maxShift = Math.max(
        Math.abs(snapToPlannerGrid(room.width) - room.width),
        Math.abs(snapToPlannerGrid(room.depth) - room.depth),
        ...(geometry.kind === "orthogonal"
            ? geometry.vertices.flatMap((vertex) => [
                  Math.abs(snapToPlannerGrid(vertex.x) - vertex.x),
                  Math.abs(snapToPlannerGrid(vertex.y) - vertex.y),
              ])
            : []),
    );
    if (maxShift === 0) return { room, maxShift };

    const snappedRoom: Room = {
        ...room,
        width: snapToPlannerGrid(room.width),
        depth: snapToPlannerGrid(room.depth),
        ...(vertices ? { geometry: { version: 1, kind: "orthogonal", vertices } } : {}),
        ...(room.partitions
            ? {
                  partitions: room.partitions.map((partition) => ({
                      ...partition,
                      start: {
                          x: snapToPlannerGrid(partition.start.x),
                          y: snapToPlannerGrid(partition.start.y),
                      },
                      end: {
                          x: snapToPlannerGrid(partition.end.x),
                          y: snapToPlannerGrid(partition.end.y),
                      },
                  })),
              }
            : {}),
    };
    const reanchor = <
        T extends {
            wall: Wall;
            segmentId?: string;
            partitionId?: string;
            offset: number;
            width: number;
        },
    >(
        item: T,
    ): T => {
        const before = getRoomSegment(room, item);
        const after = getRoomSegment(snappedRoom, item);
        if (!before || !after || before.length === 0) return item;
        const along = (segment: RoomBoundarySegment) =>
            segment.orientation === "horizontal" ? segment.start.x : segment.start.y;
        const direction =
            before.orientation === "horizontal"
                ? Math.sign(before.end.x - before.start.x)
                : Math.sign(before.end.y - before.start.y);
        const absoluteStart = along(before) + direction * item.offset;
        const offset = direction * (absoluteStart - along(after));
        return {
            ...item,
            offset: Math.min(Math.max(0, offset), Math.max(0, after.length - item.width)),
        };
    };

    return {
        room: {
            ...snappedRoom,
            doors: room.doors.map(reanchor),
            windows: room.windows.map(reanchor),
            ...(room.radiators ? { radiators: room.radiators.map(reanchor) } : {}),
        },
        maxShift,
    };
};

export const getLRoomNotch = (room: Room): { x: number; y: number } | null => {
    if (room.geometry?.kind !== "orthogonal" || room.geometry.vertices.length !== 6) return null;
    const rightSide = room.geometry.vertices[0]?.x === 0;
    const vertex = room.geometry.vertices[rightSide ? 2 : 5];
    return vertex ? { x: vertex.x, y: vertex.y } : null;
};

export const moveLRoomNotch = (room: Room, x: number, y: number): Room => {
    if (room.geometry?.kind !== "orthogonal" || room.geometry.vertices.length !== 6) return room;
    const nextX = Math.min(
        room.width - MIN_ORTHOGONAL_SEGMENT_MM,
        Math.max(MIN_ORTHOGONAL_SEGMENT_MM, Math.round(x / 50) * 50),
    );
    const nextY = Math.min(
        room.depth - MIN_ORTHOGONAL_SEGMENT_MM,
        Math.max(MIN_ORTHOGONAL_SEGMENT_MM, Math.round(y / 50) * 50),
    );
    const rightSide = room.geometry.vertices[0]?.x === 0;
    const vertices = room.geometry.vertices.map((vertex) => ({ ...vertex }));
    if (rightSide) {
        vertices[1].x = nextX;
        vertices[2].x = nextX;
        vertices[2].y = nextY;
        vertices[3].y = nextY;
    } else {
        vertices[0].x = nextX;
        vertices[4].y = nextY;
        vertices[5].x = nextX;
        vertices[5].y = nextY;
    }
    return applyRoomGeometry(room, { version: 1, kind: "orthogonal", vertices });
};

export type RoomBoundaryEditResult =
    | { status: "success"; geometry: RoomGeometry }
    | { status: "invalid"; message: string };

const snapRoomCoordinate = (value: number): number => Math.round(value / 50) * 50;

const validateBoundaryEdit = (room: Room, geometry: RoomGeometry): RoomBoundaryEditResult => {
    const error = validateOrthogonalRoomGeometry({ ...room, geometry });
    return error ? { status: "invalid", message: error } : { status: "success", geometry };
};

const nextEditorVertexIds = (vertices: RoomVertex[], count: number): string[] => {
    const ids = new Set(vertices.map((vertex) => vertex.id));
    const result: string[] = [];
    let index = 1;
    while (result.length < count) {
        const id = `edit-${index}`;
        if (!ids.has(id)) {
            ids.add(id);
            result.push(id);
        }
        index += 1;
    }
    return result;
};

/**
 * Resizes only the outer right/bottom boundary of a custom contour.  Interior
 * vertices, their order, and therefore all stable segment ids are preserved.
 */
export const resizeOrthogonalRoomGeometry = (
    room: Room,
    width: number,
    depth: number,
): RoomBoundaryEditResult => {
    if (room.geometry?.kind !== "orthogonal") {
        return { status: "success", geometry: { version: 1, kind: "rect" } };
    }

    const nextWidth = snapRoomCoordinate(width);
    const nextDepth = snapRoomCoordinate(depth);
    const geometry: RoomGeometry = {
        version: 1,
        kind: "orthogonal",
        vertices: room.geometry.vertices.map((vertex) => ({
            ...vertex,
            x: vertex.x === room.width ? nextWidth : vertex.x,
            y: vertex.y === room.depth ? nextDepth : vertex.y,
        })),
    };

    return validateBoundaryEdit({ ...room, width: nextWidth, depth: nextDepth }, geometry);
};

/**
 * Moves a corner while retaining horizontal and vertical neighbouring walls.
 * The two adjacent vertices inherit the corresponding coordinate, so a corner
 * never creates a diagonal segment.
 */
export const moveOrthogonalRoomVertex = (
    room: Room,
    vertexId: string,
    point: Pick<RoomVertex, "x" | "y">,
): RoomBoundaryEditResult => {
    if (room.geometry?.kind !== "orthogonal") {
        return {
            status: "invalid",
            message:
                "Сначала добавьте уступ ручкой середины стены — у прямоугольника меняются габариты.",
        };
    }

    const vertexIndex = room.geometry.vertices.findIndex((vertex) => vertex.id === vertexId);
    if (vertexIndex < 0) {
        return { status: "invalid", message: "Угол комнаты больше недоступен для редактирования." };
    }

    const vertices = room.geometry.vertices.map((vertex) => ({ ...vertex }));
    const previousIndex = (vertexIndex - 1 + vertices.length) % vertices.length;
    const nextIndex = (vertexIndex + 1) % vertices.length;
    const previous = vertices[previousIndex];
    const current = vertices[vertexIndex];
    const next = vertices[nextIndex];
    const x = Math.min(room.width, Math.max(0, snapRoomCoordinate(point.x)));
    const y = Math.min(room.depth, Math.max(0, snapRoomCoordinate(point.y)));
    const incomingHorizontal = previous.y === current.y;

    current.x = x;
    current.y = y;
    if (incomingHorizontal) {
        previous.y = y;
        next.x = x;
    } else {
        previous.x = x;
        next.y = y;
    }

    return validateBoundaryEdit(room, { version: 1, kind: "orthogonal", vertices });
};

const hasWallItemOnSegment = (room: Room, segment: RoomBoundarySegment): boolean => {
    const items = [...room.doors, ...room.windows, ...(room.radiators ?? [])];
    return items.some((item) =>
        room.geometry?.kind === "orthogonal"
            ? item.segmentId === segment.id
            : item.wall === segment.wall,
    );
};

/**
 * Pulls a wall midpoint perpendicular to the wall.  The old segment becomes
 * two parallel pieces joined by a rectangular step, preserving all existing
 * vertex/segment ids and allocating ids only to the four inserted corners.
 */
export const splitOrthogonalRoomSegment = (
    room: Room,
    segmentId: string,
    point: Pick<RoomVertex, "x" | "y">,
): RoomBoundaryEditResult => {
    const segments = getRoomBoundarySegments(room);
    const segmentIndex = segments.findIndex((segment) => segment.id === segmentId);
    if (segmentIndex < 0) {
        return { status: "invalid", message: "Эта стена больше недоступна для редактирования." };
    }
    const segment = segments[segmentIndex];
    if (hasWallItemOnSegment(room, segment)) {
        return {
            status: "invalid",
            message:
                "На этой стене есть дверь, окно или радиатор: сначала перенесите проём на другой сегмент.",
        };
    }
    if (segments.length + 4 > 16) {
        return {
            status: "invalid",
            message: "В контуре максимум 16 вершин. Уберите другой уступ перед добавлением нового.",
        };
    }
    if (segment.length < MIN_ORTHOGONAL_SEGMENT_MM * 3) {
        return {
            status: "invalid",
            message: "Для уступа на стене нужно не менее 1,5 м свободной длины.",
        };
    }

    const sourceVertices =
        room.geometry?.kind === "orthogonal"
            ? room.geometry.vertices.map((vertex) => ({ ...vertex }))
            : getRoomVertices(room).map((vertex, index) => ({
                  ...vertex,
                  id: `edit-base-${index + 1}`,
              }));
    const sourceIndex = room.geometry?.kind === "orthogonal" ? segmentIndex : segmentIndex;
    const start = sourceVertices[sourceIndex];
    const direction =
        segment.orientation === "horizontal"
            ? Math.sign(segment.end.x - segment.start.x)
            : Math.sign(segment.end.y - segment.start.y);
    const middleLength = Math.max(
        MIN_ORTHOGONAL_SEGMENT_MM,
        Math.min(1000, segment.length - MIN_ORTHOGONAL_SEGMENT_MM * 2),
    );
    const edgeLength = (segment.length - middleLength) / 2;
    const offset =
        segment.orientation === "horizontal"
            ? Math.min(room.depth, Math.max(0, snapRoomCoordinate(point.y))) - segment.start.y
            : Math.min(room.width, Math.max(0, snapRoomCoordinate(point.x))) - segment.start.x;

    if (Math.abs(offset) < MIN_ORTHOGONAL_SEGMENT_MM) {
        return {
            status: "invalid",
            message: "Потяните середину стены минимум на 50 см, чтобы получился удобный уступ.",
        };
    }

    const [beforeId, firstStepId, secondStepId, afterId] = nextEditorVertexIds(sourceVertices, 4);
    const additions: RoomVertex[] =
        segment.orientation === "horizontal"
            ? [
                  { id: beforeId, x: start.x + direction * edgeLength, y: start.y },
                  {
                      id: firstStepId,
                      x: start.x + direction * edgeLength,
                      y: start.y + offset,
                  },
                  {
                      id: secondStepId,
                      x: start.x + direction * (edgeLength + middleLength),
                      y: start.y + offset,
                  },
                  {
                      id: afterId,
                      x: start.x + direction * (edgeLength + middleLength),
                      y: start.y,
                  },
              ]
            : [
                  { id: beforeId, x: start.x, y: start.y + direction * edgeLength },
                  {
                      id: firstStepId,
                      x: start.x + offset,
                      y: start.y + direction * edgeLength,
                  },
                  {
                      id: secondStepId,
                      x: start.x + offset,
                      y: start.y + direction * (edgeLength + middleLength),
                  },
                  {
                      id: afterId,
                      x: start.x,
                      y: start.y + direction * (edgeLength + middleLength),
                  },
              ];

    const vertices = [...sourceVertices];
    vertices.splice(sourceIndex + 1, 0, ...additions);
    return validateBoundaryEdit(room, { version: 1, kind: "orthogonal", vertices });
};

export type OrthogonalRoomDraftResult =
    | { status: "success"; width: number; depth: number; geometry: RoomGeometry }
    | { status: "invalid"; message: string };

const removeRedundantDraftVertices = (vertices: RoomVertex[]): RoomVertex[] => {
    let result = vertices.filter((vertex, index) => {
        const previous = vertices[(index - 1 + vertices.length) % vertices.length];
        return vertex.x !== previous.x || vertex.y !== previous.y;
    });
    let changed = true;
    while (changed && result.length >= 3) {
        changed = false;
        result = result.filter((vertex, index) => {
            const previous = result[(index - 1 + result.length) % result.length];
            const next = result[(index + 1) % result.length];
            const collinear =
                (previous.x === vertex.x && vertex.x === next.x) ||
                (previous.y === vertex.y && vertex.y === next.y);
            if (collinear) changed = true;
            return !collinear;
        });
    }
    return result;
};

/** Normalizes a user-drawn open polyline into a strict clockwise room contour. */
export const buildOrthogonalRoomFromDraft = (
    points: Array<Pick<RoomVertex, "x" | "y">>,
): OrthogonalRoomDraftResult => {
    if (points.length < 5) {
        return {
            status: "invalid",
            message:
                "Поставьте не менее пяти точек; замыкающая стена будет добавлена автоматически.",
        };
    }
    const snapped = points.map((point, index) => ({
        id: `v${index + 1}`,
        x: Math.round(point.x / 50) * 50,
        y: Math.round(point.y / 50) * 50,
    }));
    const first = snapped[0];
    const last = snapped[snapped.length - 1];
    const closingCandidates: RoomVertex[][] =
        first.x === last.x || first.y === last.y
            ? [snapped]
            : [
                  [...snapped, { id: `v${snapped.length + 1}`, x: first.x, y: last.y }],
                  [...snapped, { id: `v${snapped.length + 1}`, x: last.x, y: first.y }],
              ];
    let lastError = "Контур не удалось замкнуть без пересечений.";

    for (const candidate of closingCandidates) {
        const minX = Math.min(...candidate.map((vertex) => vertex.x));
        const minY = Math.min(...candidate.map((vertex) => vertex.y));
        let vertices = removeRedundantDraftVertices(
            candidate.map((vertex) => ({
                ...vertex,
                x: vertex.x - minX,
                y: vertex.y - minY,
            })),
        );
        if (signedPolygonArea(vertices) < 0) vertices = [...vertices].reverse();
        vertices = vertices.map((vertex, index) => ({ ...vertex, id: `v${index + 1}` }));
        const width = Math.max(...vertices.map((vertex) => vertex.x));
        const depth = Math.max(...vertices.map((vertex) => vertex.y));
        if (width < 2400 || depth < 2400 || width > 10_000 || depth > 10_000) {
            lastError = "Габариты нарисованного контура должны быть от 2,4 до 10 м.";
            continue;
        }
        const geometry: RoomGeometry = { version: 1, kind: "orthogonal", vertices };
        const validation = validateOrthogonalRoomGeometry({
            width,
            depth,
            geometry,
            doors: [],
            windows: [],
            radiators: [],
        });
        if (!validation) return { status: "success", width, depth, geometry };
        lastError = validation;
    }

    return { status: "invalid", message: lastError };
};
