import {
    DRAW_ROOM_WALL_LANE_MM,
    MAX_DRAWN_CONTOUR_MM,
    snapDrawRoomWallLaneCentre,
} from "./draw-room-grid";
import { signedPolygonArea } from "./room-geometry";
import type { Room, RoomGeometry, RoomVertex } from "./types";

export type DrawWallPoint = { x: number; y: number };

export interface DrawWallSegment {
    id: string;
    start: DrawWallPoint;
    end: DrawWallPoint;
}

export interface DrawWallGraphRoom {
    /** Clear walkable room used by the planner and opening placement. */
    room: Room;
    /** Origin of the clear room coordinates. */
    origin: DrawWallPoint;
    /** Canonical wall-centre contour from the graph. */
    contour: DrawWallPoint[];
    /** Canonical outside material face paired with `contour`. */
    outerFaceContour: DrawWallPoint[];
    /** Canonical clear room face paired with `contour`. */
    innerContour: DrawWallPoint[];
}

/**
 * The centre-line contour is useful while walls are being drawn, but it must
 * never be used as the source of an architectural measurement.  These two
 * contours are the actual material faces of a completed wall envelope.
 *
 * The graph stores each wall's centre line so open and closed material never
 * jumps on screen. The paired contours below are the real outside and clear
 * faces around that canonical graph: a 50 mm wall offsets 25 mm to each side
 * and its two opposite clear faces differ from the exterior faces by 100 mm.
 *
 * Both contours retain the source segment order, so segment `n` in one
 * contour is the face paired with segment `n` in the other contour. Keeping
 * that relationship here makes dimensions, area and future opening placement
 * use one geometry contract rather than each subtracting its own visual
 * half-width.
 */
export interface DrawWallFaceContours {
    outerFaceContour: DrawWallPoint[];
    innerFaceContour: DrawWallPoint[];
}

export type AddDrawWallSegmentResult =
    | { status: "success"; segments: DrawWallSegment[] }
    | { status: "invalid"; message: string };

export type MoveDrawWallContourSegmentResult =
    | { status: "success"; segments: DrawWallSegment[] }
    | { status: "invalid"; message: string };

export type MoveDrawWallSegmentResult = MoveDrawWallContourSegmentResult;

const MIN_SEGMENT_MM = 500;
const samePoint = (first: DrawWallPoint, second: DrawWallPoint) =>
    first.x === second.x && first.y === second.y;
const keyForPoint = (point: DrawWallPoint) => `${point.x}:${point.y}`;

const faceContourSignedArea = (points: DrawWallPoint[]) =>
    points.reduce((area, point, index) => {
        const next = points[(index + 1) % points.length];
        return area + point.x * next.y - next.x * point.y;
    }, 0) / 2;

/**
 * Offsets every orthogonal contour edge and intersects its neighbours.  The
 * result is a true mitred face contour: convex and reflex L-corners are both
 * derived from the two actual wall faces, not from a bounding-box shortcut.
 */
const getMiteredFaceContour = (points: DrawWallPoint[], offset: number): DrawWallPoint[] =>
    points.map((point, index) => {
        const previous = points[(index - 1 + points.length) % points.length];
        const next = points[(index + 1) % points.length];
        const previousDirection = { x: point.x - previous.x, y: point.y - previous.y };
        const nextDirection = { x: next.x - point.x, y: next.y - point.y };
        const previousLength = Math.hypot(previousDirection.x, previousDirection.y);
        const nextLength = Math.hypot(nextDirection.x, nextDirection.y);
        if (!previousLength || !nextLength) return { ...point };

        // In SVG's down-positive coordinate system this is the right normal
        // of an edge. For the canonical clockwise contour it points inward.
        const previousNormal = {
            x: (-previousDirection.y / previousLength) * offset,
            y: (previousDirection.x / previousLength) * offset,
        };
        const nextNormal = {
            x: (-nextDirection.y / nextLength) * offset,
            y: (nextDirection.x / nextLength) * offset,
        };
        const firstLinePoint = {
            x: point.x + previousNormal.x,
            y: point.y + previousNormal.y,
        };
        const secondLinePoint = {
            x: point.x + nextNormal.x,
            y: point.y + nextNormal.y,
        };
        const denominator =
            previousDirection.x * nextDirection.y - previousDirection.y * nextDirection.x;
        if (Math.abs(denominator) < 0.0001) return firstLinePoint;
        const between = {
            x: secondLinePoint.x - firstLinePoint.x,
            y: secondLinePoint.y - firstLinePoint.y,
        };
        const distance = (between.x * nextDirection.y - between.y * nextDirection.x) / denominator;
        return {
            x: firstLinePoint.x + previousDirection.x * distance,
            y: firstLinePoint.y + previousDirection.y * distance,
        };
    });

export const getDrawRoomWallFaceContours = (
    contour: DrawWallPoint[],
    thickness: number,
): DrawWallFaceContours | null => {
    if (contour.length < 3 || thickness <= 0) return null;
    const half = thickness / 2;
    // Drawing coordinates normally give the room contour a positive (visual
    // clockwise) area. Supporting either winding keeps imported drafts and
    // graph-cycle order equally safe.
    const inwardOffset = faceContourSignedArea(contour) >= 0 ? half : -half;
    return {
        outerFaceContour: getMiteredFaceContour(contour, -inwardOffset),
        innerFaceContour: getMiteredFaceContour(contour, inwardOffset),
    };
};

const isOrthogonal = (segment: Pick<DrawWallSegment, "start" | "end">) =>
    segment.start.x === segment.end.x || segment.start.y === segment.end.y;

const segmentLength = (segment: Pick<DrawWallSegment, "start" | "end">) =>
    Math.abs(segment.end.x - segment.start.x) + Math.abs(segment.end.y - segment.start.y);

const pointOnSegment = (point: DrawWallPoint, segment: DrawWallSegment) =>
    (segment.start.y === segment.end.y &&
        point.y === segment.start.y &&
        point.x >= Math.min(segment.start.x, segment.end.x) &&
        point.x <= Math.max(segment.start.x, segment.end.x)) ||
    (segment.start.x === segment.end.x &&
        point.x === segment.start.x &&
        point.y >= Math.min(segment.start.y, segment.end.y) &&
        point.y <= Math.max(segment.start.y, segment.end.y));

const strictlyInsideSegment = (point: DrawWallPoint, segment: DrawWallSegment) =>
    pointOnSegment(point, segment) &&
    !samePoint(point, segment.start) &&
    !samePoint(point, segment.end);

const cloneSegment = (segment: DrawWallSegment): DrawWallSegment => ({
    ...segment,
    start: { ...segment.start },
    end: { ...segment.end },
});

const getUniqueSegmentId = (preferredId: string, usedIds: Set<string>) => {
    if (!usedIds.has(preferredId)) return preferredId;
    let suffix = 2;
    let candidate = `${preferredId}-${suffix}`;
    while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `${preferredId}-${suffix}`;
    }
    return candidate;
};

/**
 * Drafts are browser-persisted and older versions could produce a duplicate
 * split suffix. Keep the first ID for any opening that already references it
 * and give only later collisions a stable, unique ID.
 */
export const ensureUniqueDrawWallSegmentIds = (source: DrawWallSegment[]) => {
    const usedIds = new Set<string>();
    return source.map((segment) => {
        const id = getUniqueSegmentId(segment.id, usedIds);
        usedIds.add(id);
        return { ...cloneSegment(segment), id };
    });
};

const intersection = (first: DrawWallSegment, second: DrawWallSegment): DrawWallPoint | null => {
    if (first.start.y === first.end.y && second.start.x === second.end.x) {
        const point = { x: second.start.x, y: first.start.y };
        return pointOnSegment(point, first) && pointOnSegment(point, second) ? point : null;
    }
    if (first.start.x === first.end.x && second.start.y === second.end.y) {
        const point = { x: first.start.x, y: second.start.y };
        return pointOnSegment(point, first) && pointOnSegment(point, second) ? point : null;
    }
    return null;
};

const collinearOverlap = (first: DrawWallSegment, second: DrawWallSegment) => {
    if (first.start.y === first.end.y && second.start.y === second.end.y) {
        return (
            first.start.y === second.start.y &&
            Math.min(Math.max(first.start.x, first.end.x), Math.max(second.start.x, second.end.x)) -
                Math.max(
                    Math.min(first.start.x, first.end.x),
                    Math.min(second.start.x, second.end.x),
                ) >
                0
        );
    }
    if (first.start.x === first.end.x && second.start.x === second.end.x) {
        return (
            first.start.x === second.start.x &&
            Math.min(Math.max(first.start.y, first.end.y), Math.max(second.start.y, second.end.y)) -
                Math.max(
                    Math.min(first.start.y, first.end.y),
                    Math.min(second.start.y, second.end.y),
                ) >
                0
        );
    }
    return false;
};

const splitSegment = (
    segment: DrawWallSegment,
    points: DrawWallPoint[],
    usedIds?: Set<string>,
): DrawWallSegment[] => {
    const unique = points
        .filter(
            (point, index, source) => source.findIndex((item) => samePoint(item, point)) === index,
        )
        .filter((point) => strictlyInsideSegment(point, segment));
    if (!unique.length) return [cloneSegment(segment)];
    const ordered = [segment.start, ...unique, segment.end].sort((first, second) =>
        segment.start.x === segment.end.x ? first.y - second.y : first.x - second.x,
    );
    if (
        (segment.start.x === segment.end.x && segment.start.y > segment.end.y) ||
        (segment.start.y === segment.end.y && segment.start.x > segment.end.x)
    ) {
        ordered.reverse();
    }
    return ordered.slice(1).map((end, index) => {
        const preferredId = index === 0 ? segment.id : `${segment.id}-split-${index + 1}`;
        const id = usedIds ? getUniqueSegmentId(preferredId, usedIds) : preferredId;
        usedIds?.add(id);
        return {
            id,
            start: { ...ordered[index] },
            end: { ...end },
        };
    });
};

/**
 * Resolves a free grid coordinate to existing graph topology. Endpoints take
 * priority, followed by a point on a wall lane centre line. This makes it possible
 * to start a wall at any visible location without reviving a forced polyline.
 */
export const resolveDrawWallAnchor = (
    segments: DrawWallSegment[],
    rawPoint: DrawWallPoint,
    hitRadius = 260,
    snapMm = 50,
): DrawWallPoint => {
    const point = {
        x: snapDrawRoomWallLaneCentre(rawPoint.x, snapMm),
        y: snapDrawRoomWallLaneCentre(rawPoint.y, snapMm),
    };
    const endpoints = segments.flatMap((segment) => [segment.start, segment.end]);
    const endpoint = endpoints
        .map((candidate) => ({
            candidate,
            // Use the true pointer location for the tolerance check.  Snapping
            // first made the magnetic area subtly move by half a grid cell and
            // meant "near" depended on which side of a grid line was clicked.
            distance: Math.hypot(rawPoint.x - candidate.x, rawPoint.y - candidate.y),
        }))
        .sort((first, second) => first.distance - second.distance)[0];
    if (endpoint && endpoint.distance <= hitRadius) return { ...endpoint.candidate };

    const wall = segments
        .map((segment) => {
            const candidate =
                segment.start.y === segment.end.y
                    ? {
                          x: snapDrawRoomWallLaneCentre(
                              Math.min(
                                  Math.max(point.x, Math.min(segment.start.x, segment.end.x)),
                                  Math.max(segment.start.x, segment.end.x),
                              ),
                              snapMm,
                          ),
                          y: segment.start.y,
                      }
                    : {
                          x: segment.start.x,
                          y: snapDrawRoomWallLaneCentre(
                              Math.min(
                                  Math.max(point.y, Math.min(segment.start.y, segment.end.y)),
                                  Math.max(segment.start.y, segment.end.y),
                              ),
                              snapMm,
                          ),
                      };
            return {
                candidate,
                distance: Math.hypot(rawPoint.x - candidate.x, rawPoint.y - candidate.y),
            };
        })
        .sort((first, second) => first.distance - second.distance)[0];
    return wall && wall.distance <= hitRadius ? wall.candidate : point;
};

/** Adds a wall as an independent graph edge and turns T/cross contacts into graph nodes. */
export const addDrawWallSegment = (
    source: DrawWallSegment[],
    start: DrawWallPoint,
    end: DrawWallPoint,
    snapMm = 50,
): AddDrawWallSegmentResult => {
    const normalizedSource = ensureUniqueDrawWallSegmentIds(source);
    const usedIds = new Set(normalizedSource.map((segment) => segment.id));
    const next = {
        id: getUniqueSegmentId(`wall-${normalizedSource.length + 1}`, usedIds),
        start: {
            x: snapDrawRoomWallLaneCentre(start.x, snapMm),
            y: snapDrawRoomWallLaneCentre(start.y, snapMm),
        },
        end: {
            x: snapDrawRoomWallLaneCentre(end.x, snapMm),
            y: snapDrawRoomWallLaneCentre(end.y, snapMm),
        },
    };
    if (!isOrthogonal(next) || segmentLength(next) === 0) {
        return {
            status: "invalid",
            message: "Нужно провести стену строго по горизонтали или вертикали.",
        };
    }
    if (segmentLength(next) < MIN_SEGMENT_MM) {
        return { status: "invalid", message: "Каждая стена должна быть не короче 500 мм." };
    }
    if (
        normalizedSource.some(
            (segment) =>
                (samePoint(segment.start, next.start) && samePoint(segment.end, next.end)) ||
                (samePoint(segment.start, next.end) && samePoint(segment.end, next.start)),
        )
    ) {
        return { status: "invalid", message: "Такая стена уже есть на чертеже." };
    }
    if (normalizedSource.some((segment) => collinearOverlap(segment, next))) {
        return {
            status: "invalid",
            message: "Эта стена накладывается на существующую. Начните её от свободного конца.",
        };
    }

    const splitPoints = new Map<string, DrawWallPoint[]>();
    const newSplitPoints: DrawWallPoint[] = [];
    usedIds.add(next.id);
    normalizedSource.forEach((segment) => {
        [next.start, next.end].forEach((point) => {
            if (strictlyInsideSegment(point, segment)) {
                splitPoints.set(segment.id, [...(splitPoints.get(segment.id) ?? []), point]);
            }
        });
        const crossing = intersection(next, segment);
        if (
            crossing &&
            strictlyInsideSegment(crossing, next) &&
            strictlyInsideSegment(crossing, segment)
        ) {
            splitPoints.set(segment.id, [...(splitPoints.get(segment.id) ?? []), crossing]);
            newSplitPoints.push(crossing);
        }
    });

    const reconciled = normalizedSource.flatMap((segment) => {
        const points = splitPoints.get(segment.id) ?? [];
        if (!points.length) return [cloneSegment(segment)];
        usedIds.delete(segment.id);
        return splitSegment(segment, points, usedIds);
    });
    usedIds.delete(next.id);
    return {
        status: "success",
        segments: ensureUniqueDrawWallSegmentIds([
            ...reconciled,
            ...splitSegment(next, newSplitPoints, usedIds),
        ]),
    };
};

/**
 * Slides one side of a closed contour without disconnecting the graph.
 *
 * Every endpoint that lies on the moved side follows it. That includes the
 * endpoint of a partition attached in the middle of the wall, so moving an
 * exterior wall stretches its connected walls instead of leaving a visual
 * gap. The caller chooses the contour side: a middle grab uses the selected
 * side itself; an endpoint grab uses its neighbouring side and therefore
 * keeps the opposite endpoint of the selected wall fixed.
 */
const continuousWallLength = (segments: DrawWallSegment[], wall: DrawWallSegment): number => {
    const horizontal = wall.start.y === wall.end.y;
    const axis = horizontal ? wall.start.y : wall.start.x;
    let low = horizontal ? Math.min(wall.start.x, wall.end.x) : Math.min(wall.start.y, wall.end.y);
    let high = low + segmentLength(wall);
    let changed = true;
    while (changed) {
        changed = false;
        for (const segment of segments) {
            if (
                horizontal
                    ? segment.start.y !== axis || segment.end.y !== axis
                    : segment.start.x !== axis || segment.end.x !== axis
            )
                continue;
            const from = horizontal
                ? Math.min(segment.start.x, segment.end.x)
                : Math.min(segment.start.y, segment.end.y);
            const to = from + segmentLength(segment);
            if (from > high || to < low) continue;
            if (from < low || to > high) {
                low = Math.min(low, from);
                high = Math.max(high, to);
                changed = true;
            }
        }
    }
    return high - low;
};

const validateMovedWallSegments = (
    next: DrawWallSegment[],
    source: DrawWallSegment[] = [],
): Extract<MoveDrawWallSegmentResult, { status: "invalid" }> | null => {
    for (const segment of next) {
        if (!isOrthogonal(segment)) {
            return {
                status: "invalid",
                message: "Перемещение нарушило бы прямой угол у соседней стены.",
            };
        }
        if (
            segmentLength(segment) < MIN_SEGMENT_MM &&
            continuousWallLength(next, segment) < MIN_SEGMENT_MM &&
            !source.some(
                (original) =>
                    original.id === segment.id &&
                    segmentLength(original) === segmentLength(segment) &&
                    segmentLength(segment) > 0,
            )
        ) {
            return {
                status: "invalid",
                message: "Каждая стена после перемещения должна быть не короче 500 мм.",
            };
        }
    }

    for (let firstIndex = 0; firstIndex < next.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < next.length; secondIndex += 1) {
            const first = next[firstIndex];
            const second = next[secondIndex];
            if (
                (samePoint(first.start, second.start) && samePoint(first.end, second.end)) ||
                (samePoint(first.start, second.end) && samePoint(first.end, second.start))
            ) {
                return {
                    status: "invalid",
                    message: "Перемещение создало бы повторяющуюся стену.",
                };
            }
            if (collinearOverlap(first, second)) {
                return {
                    status: "invalid",
                    message: "Стены после перемещения наложились бы друг на друга.",
                };
            }
            const crossing = intersection(first, second);
            if (crossing && !samePoint(crossing, first.start) && !samePoint(crossing, first.end)) {
                return {
                    status: "invalid",
                    message: "Перемещение создало бы пересечение стен вне узла.",
                };
            }
            if (
                crossing &&
                !samePoint(crossing, second.start) &&
                !samePoint(crossing, second.end)
            ) {
                return {
                    status: "invalid",
                    message: "Перемещение создало бы пересечение стен вне узла.",
                };
            }
        }
    }

    return null;
};

const moveDrawWallSpan = (
    source: DrawWallSegment[],
    start: DrawWallPoint,
    end: DrawWallPoint,
    rawPoint: DrawWallPoint,
    snapMm = 50,
): MoveDrawWallSegmentResult => {
    if (!isOrthogonal({ start, end }) || segmentLength({ start, end }) <= 0) {
        return { status: "invalid", message: "Эту стену нельзя безопасно переместить." };
    }

    const horizontal = start.y === end.y;
    const targetAxis = horizontal
        ? snapDrawRoomWallLaneCentre(rawPoint.y, snapMm)
        : snapDrawRoomWallLaneCentre(rawPoint.x, snapMm);
    const currentAxis = horizontal ? start.y : start.x;
    if (targetAxis === currentAxis)
        return { status: "success", segments: source.map(cloneSegment) };

    const span = { id: "moving-wall", start, end };
    const movePoint = (point: DrawWallPoint): DrawWallPoint =>
        horizontal ? { x: point.x, y: targetAxis } : { x: targetAxis, y: point.y };
    const stationaryJunctions: DrawWallPoint[] = [];
    const next = source
        .map((segment) => {
            const parallel = (segment.start.y === segment.end.y) === horizontal;
            const selected =
                pointOnSegment(segment.start, span) && pointOnSegment(segment.end, span);
            if (parallel && !selected) {
                for (const point of [segment.start, segment.end]) {
                    if (pointOnSegment(point, span)) stationaryJunctions.push(point);
                }
                return cloneSegment(segment);
            }
            return {
                ...segment,
                start: pointOnSegment(segment.start, span)
                    ? movePoint(segment.start)
                    : { ...segment.start },
                end: pointOnSegment(segment.end, span)
                    ? movePoint(segment.end)
                    : { ...segment.end },
            };
        })
        .filter((segment) => !samePoint(segment.start, segment.end));
    const usedIds = new Set(source.map((segment) => segment.id));
    // Keep the continuing horizontal wall in place. Its old junction remains
    // connected through the extended vertical wall, forming a real step.
    for (const point of stationaryJunctions) {
        const movedPoint = movePoint(point);
        if (
            next.some(
                (segment) => pointOnSegment(point, segment) && pointOnSegment(movedPoint, segment),
            )
        )
            continue;
        const id = getUniqueSegmentId("wall-move-joint", usedIds);
        usedIds.add(id);
        next.push({ id, start: { ...point }, end: movedPoint });
    }
    // Materialize T-junctions: both faces must see the same graph node.
    const junctions = next.flatMap((segment) => [segment.start, segment.end]);
    const reconciled = next.flatMap((segment) => {
        usedIds.delete(segment.id);
        return splitSegment(segment, junctions, usedIds);
    });
    const error = validateMovedWallSegments(reconciled, source);
    if (error) return error;
    return { status: "success", segments: reconciled };
};

/** Moves an independently drawn segment, including every junction on its span. */
export const moveDrawWallSegment = (
    source: DrawWallSegment[],
    segmentId: string,
    rawPoint: DrawWallPoint,
    snapMm = 50,
): MoveDrawWallSegmentResult => {
    const segment = source.find((candidate) => candidate.id === segmentId);
    if (!segment) return { status: "invalid", message: "Не удалось найти стену для перемещения." };
    return moveDrawWallSpan(source, segment.start, segment.end, rawPoint, snapMm);
};

/** A continuous straight wall is one editing target; graph pieces retain their IDs. */
export const getDrawWallRun = (source: DrawWallSegment[], segmentId: string) => {
    const seed = source.find((item) => item.id === segmentId);
    if (!seed) return null;
    const horizontal = seed.start.y === seed.end.y;
    const axis = horizontal ? "x" : "y";
    const cross = horizontal ? "y" : "x";
    let low = Math.min(seed.start[axis], seed.end[axis]);
    let high = Math.max(seed.start[axis], seed.end[axis]);
    const ids = new Set<string>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of source) {
            if (
                ids.has(item.id) ||
                item.start[cross] !== seed.start[cross] ||
                item.end[cross] !== seed.start[cross]
            )
                continue;
            const a = Math.min(item.start[axis], item.end[axis]);
            const b = Math.max(item.start[axis], item.end[axis]);
            if (a > high || b < low) continue;
            ids.add(item.id);
            low = Math.min(low, a);
            high = Math.max(high, b);
            changed = true;
        }
    }
    return {
        segmentIds: Array.from(ids),
        start: { ...seed.start, [axis]: low },
        end: { ...seed.start, [axis]: high },
    };
};

export const moveDrawWallRun = (
    source: DrawWallSegment[],
    segmentId: string,
    point: DrawWallPoint,
    snapMm = 50,
): MoveDrawWallSegmentResult => {
    const run = getDrawWallRun(source, segmentId);
    return run
        ? moveDrawWallSpan(source, run.start, run.end, point, snapMm)
        : { status: "invalid", message: "Не удалось найти стену." };
};

export const resizeDrawWallRun = (
    source: DrawWallSegment[],
    segmentId: string,
    edge: "start" | "end",
    point: DrawWallPoint,
    snapMm = 50,
): MoveDrawWallSegmentResult => {
    const run = getDrawWallRun(source, segmentId);
    if (!run) return { status: "invalid", message: "Не удалось найти стену." };
    const axis = run.start.y === run.end.y ? "x" : "y";
    const position = snapDrawRoomWallLaneCentre(point[axis], snapMm);
    const low = edge === "start" ? position : run.start[axis];
    const high = edge === "end" ? position : run.end[axis];
    if (high - low < MIN_SEGMENT_MM)
        return { status: "invalid", message: "Стена должна быть не короче 500 мм по оси." };
    const ids = new Set(run.segmentIds);
    const oldEnd = run[edge];
    const newEnd = { ...oldEnd, [axis]: position };
    // An intermediate branch must not be left hanging when its host is trimmed away.
    for (const wall of source.filter((item) => !ids.has(item.id))) {
        for (const p of [wall.start, wall.end]) {
            if (
                pointOnSegment(p, { id: "run", start: run.start, end: run.end }) &&
                !samePoint(p, oldEnd) &&
                (p[axis] < low || p[axis] > high)
            )
                return {
                    status: "invalid",
                    message: "Укорочение разорвало бы примыкание другой стены.",
                };
        }
    }
    const next = source.flatMap((item) => {
        if (!ids.has(item.id))
            return [
                {
                    ...item,
                    start: samePoint(item.start, oldEnd) ? newEnd : { ...item.start },
                    end: samePoint(item.end, oldEnd) ? newEnd : { ...item.end },
                },
            ];
        const a = Math.min(item.start[axis], item.end[axis]),
            b = Math.max(item.start[axis], item.end[axis]);
        const from = a === run.start[axis] ? low : Math.max(low, a);
        const to = b === run.end[axis] ? high : Math.min(high, b);
        if (to <= from) return [];
        const forward = item.start[axis] <= item.end[axis];
        return [
            {
                ...item,
                start: { ...item.start, [axis]: forward ? from : to },
                end: { ...item.end, [axis]: forward ? to : from },
            },
        ];
    });
    const error = validateMovedWallSegments(next, source);
    return error ?? { status: "success", segments: next };
};

/** Contour indices can rotate when another corner becomes the topmost one.
 * Track the actual graph endpoints, whose segment IDs survive a wall move.
 */
export const findMovedDrawWallContourEdge = (
    source: DrawWallSegment[],
    next: DrawWallSegment[],
    beforeContour: DrawWallPoint[],
    afterContour: DrawWallPoint[],
    edgeIndex: number,
    openingCentre?: DrawWallPoint,
): number => {
    if (edgeIndex < 0 || edgeIndex >= beforeContour.length) return -1;
    const movedPoint = (point: DrawWallPoint): DrawWallPoint | undefined => {
        for (const segment of source) {
            const endpoint = samePoint(segment.start, point)
                ? "start"
                : samePoint(segment.end, point)
                  ? "end"
                  : null;
            if (endpoint) return next.find((candidate) => candidate.id === segment.id)?.[endpoint];
        }
        return undefined;
    };
    const start = movedPoint(beforeContour[edgeIndex]);
    const end = movedPoint(beforeContour[(edgeIndex + 1) % beforeContour.length]);
    if (!start || !end) return -1;
    const match = afterContour.findIndex((point, index) => {
        const other = afterContour[(index + 1) % afterContour.length];
        return (
            (samePoint(point, start) && samePoint(other, end)) ||
            (samePoint(point, end) && samePoint(other, start))
        );
    });
    if (match >= 0 || !openingCentre) return match;
    // Moving part of a straight boundary creates a step: the old contour edge
    // now has several descendants. Follow the graph wall under the aperture.
    const oldStart = beforeContour[edgeIndex];
    const oldEnd = beforeContour[(edgeIndex + 1) % beforeContour.length];
    const horizontal = oldStart.y === oldEnd.y;
    const projected = horizontal
        ? { x: openingCentre.x, y: oldStart.y }
        : { x: oldStart.x, y: openingCentre.y };
    const host = source.find(
        (segment) =>
            pointOnSegment(segment.start, { id: "edge", start: oldStart, end: oldEnd }) &&
            pointOnSegment(segment.end, { id: "edge", start: oldStart, end: oldEnd }) &&
            pointOnSegment(projected, segment),
    );
    const movedHost = host && next.find((segment) => segment.id === host.id);
    if (!host || !movedHost) return -1;
    const movedCentre = horizontal
        ? { ...projected, y: movedHost.start.y }
        : { ...projected, x: movedHost.start.x };
    return afterContour.findIndex((point, index) => {
        const other = afterContour[(index + 1) % afterContour.length];
        return (
            (point.y === other.y) === horizontal &&
            pointOnSegment(movedCentre, { id: "edge", start: point, end: other })
        );
    });
};

export const moveDrawWallContourSegment = (
    source: DrawWallSegment[],
    contour: DrawWallPoint[],
    edgeIndex: number,
    rawPoint: DrawWallPoint,
    snapMm = 50,
): MoveDrawWallContourSegmentResult => {
    if (contour.length < 4 || edgeIndex < 0 || edgeIndex >= contour.length) {
        return { status: "invalid", message: "Не удалось найти стену для перемещения." };
    }
    return moveDrawWallSpan(
        source,
        contour[edgeIndex],
        contour[(edgeIndex + 1) % contour.length],
        rawPoint,
        snapMm,
    );
};

const removeCollinearCyclePoints = (points: DrawWallPoint[]) => {
    let result = points;
    let changed = true;
    while (changed && result.length >= 3) {
        changed = false;
        result = result.filter((point, index) => {
            const previous = result[(index - 1 + result.length) % result.length];
            const next = result[(index + 1) % result.length];
            const collinear =
                (previous.x === point.x && point.x === next.x) ||
                (previous.y === point.y && point.y === next.y);
            if (collinear) changed = true;
            return !collinear;
        });
    }
    return result;
};

const roomFromCycle = (
    cycle: DrawWallPoint[],
    wallThickness: Room["wallThickness"] = DRAW_ROOM_WALL_LANE_MM,
): DrawWallGraphRoom | null => {
    const rawContour = removeCollinearCyclePoints(cycle);
    if (
        rawContour.length < 4 ||
        new Set(rawContour.map(keyForPoint)).size !== rawContour.length ||
        Math.abs(faceContourSignedArea(rawContour)) < 0.001 ||
        rawContour.some(
            (point, index) =>
                !isOrthogonal({
                    start: point,
                    end: rawContour[(index + 1) % rawContour.length],
                }),
        )
    ) {
        return null;
    }
    const clockwise =
        faceContourSignedArea(rawContour) >= 0 ? rawContour : [...rawContour].reverse();
    const first = clockwise.reduce(
        (candidate, point, index) =>
            point.y < clockwise[candidate].y ||
            (point.y === clockwise[candidate].y && point.x < clockwise[candidate].x)
                ? index
                : candidate,
        0,
    );
    // A stable top-left, clockwise order gives faces, dimension ids and
    // opening segments the same identity regardless of which wall was drawn
    // first or which graph walk discovered the cycle.
    const contour = [...clockwise.slice(first), ...clockwise.slice(0, first)];
    const faces = getDrawRoomWallFaceContours(contour, wallThickness);
    if (!faces) return null;
    const innerContour = faces.innerFaceContour;
    const origin = {
        x: Math.min(...innerContour.map((point) => point.x)),
        y: Math.min(...innerContour.map((point) => point.y)),
    };
    let vertices: RoomVertex[] = innerContour.map((point, index) => ({
        id: `v${index + 1}`,
        x: point.x - origin.x,
        y: point.y - origin.y,
    }));
    if (signedPolygonArea(vertices) < 0) vertices = [...vertices].reverse();
    vertices = vertices.map((vertex, index) => ({ ...vertex, id: `v${index + 1}` }));
    const width = Math.max(...vertices.map((vertex) => vertex.x));
    const depth = Math.max(...vertices.map((vertex) => vertex.y));
    // Drawing a room and accepting it in the furniture planner are two
    // different decisions. A 2.2 × 1.2 m contour is still a perfectly real
    // closed architectural outline and must keep its area/dimensions in the
    // drawing editor. Planner-size eligibility is deliberately checked by the
    // caller against the full room validation contract before handoff.
    // Individual wall safety is already enforced by addDrawWallSegment.
    if (width > MAX_DRAWN_CONTOUR_MM || depth > MAX_DRAWN_CONTOUR_MM) return null;
    const geometry: RoomGeometry =
        vertices.length === 4
            ? { version: 1, kind: "rect" }
            : { version: 1, kind: "orthogonal", vertices };
    const room: Room = {
        width,
        depth,
        geometry,
        doors: [],
        windows: [],
        radiators: [],
        ...(wallThickness === DRAW_ROOM_WALL_LANE_MM ? {} : { wallThickness }),
    };
    // Do not run planner/room-editor validation here. Those rules reject
    // otherwise legitimate compact drawing contours (for example a 500 mm
    // outer niche becomes a 400 mm clear-side after its two wall faces are
    // accounted for). The graph cycle above is the canonical closure proof;
    // planner eligibility is deliberately enforced later by DrawRoom.
    return {
        room,
        origin,
        contour: contour.map((point) => ({ ...point })),
        outerFaceContour: faces.outerFaceContour,
        innerContour: vertices.map((vertex) => ({
            x: vertex.x + origin.x,
            y: vertex.y + origin.y,
        })),
    };
};

type DirectedGraphEdge = {
    from: DrawWallPoint;
    to: DrawWallPoint;
    key: string;
};

const directionIndex = (from: DrawWallPoint, to: DrawWallPoint) => {
    if (to.x > from.x) return 0;
    if (to.y > from.y) return 1;
    if (to.x < from.x) return 2;
    return 3;
};

const directedEdgeKey = (from: DrawWallPoint, to: DrawWallPoint) =>
    `${keyForPoint(from)}>${keyForPoint(to)}`;

/**
 * Extracts real closed faces from the committed wall topology.  This is not a
 * paint/bounds heuristic: it walks the same graph that receives every pointer
 * commit.  A deterministic right-face walk makes a normal rectangle close
 * immediately, while the DFS below remains as a conservative fallback for a
 * branching drawing (for example a T wall attached to an existing room).
 */
const collectPlanarFaceCycles = (segments: DrawWallSegment[]): DrawWallPoint[][] => {
    const adjacency = new Map<string, DrawWallPoint[]>();
    const add = (from: DrawWallPoint, to: DrawWallPoint) => {
        const key = keyForPoint(from);
        adjacency.set(key, [...(adjacency.get(key) ?? []), to]);
    };
    segments.forEach((segment) => {
        add(segment.start, segment.end);
        add(segment.end, segment.start);
    });

    const directed: DirectedGraphEdge[] = segments.flatMap((segment) => [
        { from: segment.start, to: segment.end, key: directedEdgeKey(segment.start, segment.end) },
        { from: segment.end, to: segment.start, key: directedEdgeKey(segment.end, segment.start) },
    ]);
    const cycles = new Map<string, DrawWallPoint[]>();

    directed.forEach((first) => {
        const points = [first.from];
        let current = first;
        const visited = new Set<string>();
        // Every segment has two directed forms. The multiplier prevents a
        // malformed branch from spinning forever without limiting legitimate
        // compact L rooms.
        const limit = Math.max(segments.length * 4, 16);

        for (let step = 0; step < limit; step += 1) {
            const currentKey = current.key;
            if (visited.has(currentKey)) break;
            visited.add(currentKey);
            points.push(current.to);

            if (samePoint(current.to, first.from)) {
                const cycle = removeCollinearCyclePoints(points.slice(0, -1));
                if (cycle.length >= 4 && new Set(cycle.map(keyForPoint)).size === cycle.length) {
                    const keys = cycle.map(keyForPoint);
                    const rotations = keys.map((_, index) =>
                        [...keys.slice(index), ...keys.slice(0, index)].join("|"),
                    );
                    const reversed = [...keys].reverse();
                    const reverseRotations = reversed.map((_, index) =>
                        [...reversed.slice(index), ...reversed.slice(0, index)].join("|"),
                    );
                    cycles.set([...rotations, ...reverseRotations].sort()[0], cycle);
                }
                break;
            }

            const incomingDirection = directionIndex(current.from, current.to);
            const candidates = (adjacency.get(keyForPoint(current.to)) ?? [])
                .filter((point) => !samePoint(point, current.from))
                .sort((firstCandidate, secondCandidate) => {
                    const firstTurn =
                        (directionIndex(current.to, firstCandidate) - incomingDirection + 4) % 4;
                    const secondTurn =
                        (directionIndex(current.to, secondCandidate) - incomingDirection + 4) % 4;
                    return (
                        firstTurn - secondTurn ||
                        keyForPoint(firstCandidate).localeCompare(keyForPoint(secondCandidate))
                    );
                });
            const next = candidates[0];
            if (!next) break;
            current = {
                from: current.to,
                to: next,
                key: directedEdgeKey(current.to, next),
            };
        }
    });

    return Array.from(cycles.values());
};

/** Finds the largest valid simple orthogonal cycle in the independently drawn wall graph. */
export const deriveDrawWallGraphRoom = (
    segments: DrawWallSegment[],
    wallThickness: Room["wallThickness"] = DRAW_ROOM_WALL_LANE_MM,
): DrawWallGraphRoom | null => {
    const adjacency = new Map<string, Array<{ point: DrawWallPoint; edge: string }>>();
    segments.forEach((segment, index) => {
        const edge = `${index}`;
        const add = (from: DrawWallPoint, to: DrawWallPoint) => {
            const key = keyForPoint(from);
            adjacency.set(key, [...(adjacency.get(key) ?? []), { point: to, edge }]);
        };
        add(segment.start, segment.end);
        add(segment.end, segment.start);
    });
    const cycles = new Map<string, DrawWallPoint[]>();
    const vertices = Array.from(adjacency.keys()).sort();
    const maxDepth = Math.min(Math.max(segments.length + 1, 4), 24);
    vertices.forEach((startKey) => {
        if (!adjacency.get(startKey)?.length) return;
        const [x, y] = startKey.split(":").map(Number);
        const startPoint = { x, y };
        const visit = (current: DrawWallPoint, path: DrawWallPoint[], usedEdges: Set<string>) => {
            if (path.length > maxDepth) return;
            for (const link of adjacency.get(keyForPoint(current)) ?? []) {
                if (usedEdges.has(link.edge)) continue;
                if (samePoint(link.point, startPoint) && path.length >= 4) {
                    const normalized = removeCollinearCyclePoints(path);
                    const keys = normalized.map(keyForPoint);
                    const rotations = keys.map((_, index) =>
                        [...keys.slice(index), ...keys.slice(0, index)].join("|"),
                    );
                    const reversed = [...keys].reverse();
                    const reverseRotations = reversed.map((_, index) =>
                        [...reversed.slice(index), ...reversed.slice(0, index)].join("|"),
                    );
                    const identity = [...rotations, ...reverseRotations].sort()[0];
                    cycles.set(identity, normalized);
                    continue;
                }
                if (path.some((point) => samePoint(point, link.point))) continue;
                visit(
                    link.point,
                    [...path, link.point],
                    new Set([...Array.from(usedEdges), link.edge]),
                );
            }
        };
        visit(startPoint, [startPoint], new Set());
    });
    return (
        [...collectPlanarFaceCycles(segments), ...Array.from(cycles.values())]
            .map((cycle) => roomFromCycle(cycle, wallThickness))
            .filter((value): value is DrawWallGraphRoom => Boolean(value))
            .sort(
                (first, second) =>
                    Math.abs(faceContourSignedArea(second.contour)) -
                    Math.abs(faceContourSignedArea(first.contour)),
            )[0] ?? null
    );
};

/** Independent buildings share a drawing board, not a local Room coordinate system. */
export const getDrawWallComponents = (segments: DrawWallSegment[]): DrawWallSegment[][] => {
    const atPoint = new Map<string, number[]>();
    segments.forEach((segment, index) => {
        for (const point of [segment.start, segment.end]) {
            const key = keyForPoint(point);
            atPoint.set(key, [...(atPoint.get(key) ?? []), index]);
        }
    });
    const visited = new Set<number>();
    const components: DrawWallSegment[][] = [];
    segments.forEach((_, index) => {
        if (visited.has(index)) return;
        const queue = [index];
        const component: DrawWallSegment[] = [];
        visited.add(index);
        while (queue.length) {
            const current = queue.pop()!;
            const segment = segments[current];
            component.push(segment);
            for (const point of [segment.start, segment.end]) {
                for (const neighbour of atPoint.get(keyForPoint(point)) ?? []) {
                    if (visited.has(neighbour)) continue;
                    visited.add(neighbour);
                    queue.push(neighbour);
                }
            }
        }
        components.push(component);
    });
    return components;
};
