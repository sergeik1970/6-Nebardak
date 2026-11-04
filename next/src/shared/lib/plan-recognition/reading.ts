import {
    getRoomBoundarySegments,
    getRoomSegment,
    getRoomVertices,
} from "@/shared/lib/furniture-planner/room-geometry";
import type { Room } from "@/shared/lib/furniture-planner/types";

/**
 * What a plan says, in millimetres on the plan's own axes (x to the right,
 * y down): the room's contour and its doors and windows. Both the truth and
 * a model's answer are brought to this form, so they compare point by point.
 */
export interface PlanReading {
    /** Corners in order round the room. */
    contour: { x: number; y: number }[];
    openings: {
        kind: "door" | "window";
        /** The opening's two ends on its wall. */
        from: { x: number; y: number };
        to: { x: number; y: number };
    }[];
}

/** The truth for one planner room. */
export const readingFromRoom = (room: Room): PlanReading => {
    const openings = [
        ...room.doors.map((item) => ({ item, kind: "door" as const })),
        ...room.windows.map((item) => ({ item, kind: "window" as const })),
    ].flatMap(({ item, kind }) => {
        const segment = getRoomSegment(room, item);
        if (!segment) return [];
        const tx = (segment.end.x - segment.start.x) / segment.length;
        const ty = (segment.end.y - segment.start.y) / segment.length;
        const at = (distance: number) => ({
            x: Math.round(segment.start.x + tx * distance),
            y: Math.round(segment.start.y + ty * distance),
        });
        return [{ kind, from: at(item.offset), to: at(item.offset + item.width) }];
    });
    return {
        contour: getRoomVertices(room).map(({ x, y }) => ({ x, y })),
        openings,
    };
};

/** The room's walls as drawn: each with its outward side, for rendering. */
export const wallsOf = (room: Room) => getRoomBoundarySegments(room);

/**
 * A model's answer, checked and turned into a reading. The model is asked for
 * the contour and, per opening, the wall (contour edge index), the distance
 * from that edge's first corner and the width. Anything malformed is a
 * reading error, never a crash.
 */
export const readingFromModel = (raw: unknown): { reading: PlanReading } | { error: string } => {
    if (!raw || typeof raw !== "object") return { error: "Ответ не JSON-объект." };
    const source = raw as { contour?: unknown; openings?: unknown };
    if (!Array.isArray(source.contour) || source.contour.length < 4)
        return { error: "Контур должен содержать хотя бы 4 угла." };
    const contour = source.contour.map((point) => {
        const { x, y } = (point ?? {}) as { x?: unknown; y?: unknown };
        return typeof x === "number" && typeof y === "number" ? { x, y } : null;
    });
    if (contour.some((point) => point === null)) return { error: "Угол контура без чисел x и y." };
    const corners = contour as { x: number; y: number }[];
    const openings: PlanReading["openings"] = [];
    for (const entry of Array.isArray(source.openings) ? source.openings : []) {
        const { kind, wall, offset, width } = (entry ?? {}) as Record<string, unknown>;
        if (
            (kind !== "door" && kind !== "window") ||
            typeof wall !== "number" ||
            typeof offset !== "number" ||
            typeof width !== "number"
        )
            return { error: "Проём без вида, стены, отступа или ширины." };
        const start = corners[wall];
        const end = corners[(wall + 1) % corners.length];
        if (!start || !end) return { error: `Проём на несуществующей стене ${wall}.` };
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length === 0) return { error: `Стена ${wall} нулевой длины.` };
        const tx = (end.x - start.x) / length;
        const ty = (end.y - start.y) / length;
        openings.push({
            kind,
            from: { x: start.x + tx * offset, y: start.y + ty * offset },
            to: { x: start.x + tx * (offset + width), y: start.y + ty * (offset + width) },
        });
    }
    return { reading: { contour: corners, openings } };
};

/** The JSON a model would give for a room: what the oracle mode answers. */
export const modelAnswerForRoom = (room: Room) => {
    const reading = readingFromRoom(room);
    const corners = reading.contour;
    const openings = reading.openings.map((opening) => {
        // The edge that holds both ends, and the distance from its first corner.
        const wall = corners.findIndex((start, index) => {
            const end = corners[(index + 1) % corners.length];
            const on = (point: { x: number; y: number }) =>
                Math.abs(
                    (end.x - start.x) * (point.y - start.y) -
                        (end.y - start.y) * (point.x - start.x),
                ) < 1 &&
                point.x >= Math.min(start.x, end.x) - 1 &&
                point.x <= Math.max(start.x, end.x) + 1 &&
                point.y >= Math.min(start.y, end.y) - 1 &&
                point.y <= Math.max(start.y, end.y) + 1;
            return on(opening.from) && on(opening.to);
        });
        const start = corners[wall];
        const a = Math.hypot(opening.from.x - start.x, opening.from.y - start.y);
        const b = Math.hypot(opening.to.x - start.x, opening.to.y - start.y);
        return { kind: opening.kind, wall, offset: Math.min(a, b), width: Math.abs(b - a) };
    });
    return { contour: corners, openings };
};
