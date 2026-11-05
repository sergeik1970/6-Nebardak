import { validateRoomGeometry } from "@/shared/lib/furniture-planner/geometry";
import {
    getRoomBoundarySegments,
    MIN_ORTHOGONAL_SEGMENT_MM,
    signedPolygonArea,
} from "@/shared/lib/furniture-planner/room-geometry";
import type {
    DoorOpening,
    Room,
    RoomKind,
    RoomBoundarySegment,
    RoomVertex,
    WindowOpening,
} from "@/shared/lib/furniture-planner/types";
import type { ApartmentRoomReading } from "./apartment";

type Point = { x: number; y: number };

/** A room read from a plan, ready to open in the editor or explained why not. */
export interface ImportedPlanRoom {
    /** As the model copied it from the sheet. */
    name: string;
    /** The name to give the room in the editor: a bare BTI number becomes "Комната 2". */
    label: string;
    /** What the sheet's name says the room is for; none when the name does not tell. */
    kind?: RoomKind;
    /** m², of the contour as the model read it (before simplification). */
    area: number | null;
    /** Some sizes were measured on the drawing, not read: worth checking. */
    estimated: boolean;
    /** Slanted walls were replaced by steps or tiny jogs were merged. */
    simplified: boolean;
    /** Openings that could not be placed on the simplified contour. */
    droppedOpenings: number;
    room: Room | null;
    /** Why `room` is null. */
    problem?: string;
}

const MAX_VERTICES = 16;

/** Sheet names in Russian (and the model's English descriptions) → room kinds; first match wins. */
const KIND_BY_NAME: [RegExp, RoomKind][] = [
    [/кухн\S*[\s-]*(гостин|столов)|kitchen[\s-]*living|студи|studio/i, "kitchen-living"],
    [/спальн|bedroom/i, "bedroom"],
    [/детск|child|nursery|kids/i, "children"],
    [/кабинет|office|study/i, "office"],
    [/гостин|зал(?![а-яё])|living/i, "living"],
    [/кухн|kitchen/i, "kitchen"],
    [/с\/у|санузел|сан\. ?узел|ванн|туалет|уборн|душ|bath|toilet|\bwc\b|shower/i, "bathroom"],
    [/прихож|коридор|холл|тамбур|hall|corridor|entrance/i, "hallway"],
];

export const roomKindFromName = (name: string): RoomKind | undefined =>
    KIND_BY_NAME.find(([pattern]) => pattern.test(name))?.[1];

/** A name for the editor; a sheet that only numbers its rooms gets "Комната N". */
export const planRoomLabel = (name: string) => {
    const trimmed = name.trim().slice(0, 60);
    return /^\d+[а-яa-z]?$/i.test(trimmed) ? `Комната ${trimmed}` : trimmed || "Комната";
};
/** Coordinates closer than this become one wall line; grows until the contour is valid. */
const MERGE_STEPS = [20, 60, 150, 300, MIN_ORTHOGONAL_SEGMENT_MM - 1];
const MIN_OPENING_MM = 300;
/** The ways a door may open, tried in order until one fits the room's rules. */
const DOOR_SWINGS: [
    NonNullable<DoorOpening["hinge"]>,
    NonNullable<DoorOpening["swingDirection"]>,
][] = [
    ["start", "inward"],
    ["end", "inward"],
    ["start", "outward"],
    ["end", "outward"],
];

const area = (points: Point[]) =>
    Math.abs(
        points.reduce((sum, point, index) => {
            const next = points[(index + 1) % points.length];
            return sum + point.x * next.y - next.x * point.y;
        }, 0) / 2,
    );

const inside = (polygon: Point[], point: Point) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (a.y > point.y !== b.y > point.y) {
            const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
            if (point.x < x) result = !result;
        }
    }
    return result;
};

/** A slanted edge becomes two straight ones, cornered inside the room. */
const withoutSlants = (points: Point[]): { points: Point[]; slanted: boolean } => {
    const result: Point[] = [];
    let slanted = false;
    points.forEach((start, index) => {
        const end = points[(index + 1) % points.length];
        result.push(start);
        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.y - start.y);
        const length = Math.hypot(dx, dy);
        if (!length || dx < length * 0.09 || dy < length * 0.09) return;
        slanted = true;
        const corners = [
            { x: end.x, y: start.y },
            { x: start.x, y: end.y },
        ];
        // The corner inside keeps the room within its real walls.
        const probe = (corner: Point) => ({
            x: (corner.x * 2 + start.x + end.x) / 4,
            y: (corner.y * 2 + start.y + end.y) / 4,
        });
        result.push(corners.find((corner) => inside(points, probe(corner))) ?? corners[0]);
    });
    return { points: result, slanted };
};

/** Groups close values: each maps to the mean of its group. */
const clusters = (values: number[], gap: number) => {
    const sorted = [...values].sort((first, second) => first - second);
    const groups: number[][] = [];
    for (const value of sorted) {
        const last = groups[groups.length - 1];
        if (last && value - last[last.length - 1] <= gap) last.push(value);
        else groups.push([value]);
    }
    const centres = groups.map(
        (group) =>
            Math.round(group.reduce((sum, value) => sum + value, 0) / group.length / 10) * 10,
    );
    return (value: number) => {
        const index = groups.findIndex(
            (group) => value >= group[0] - gap && value <= group[group.length - 1] + gap,
        );
        return index === -1 ? value : centres[index];
    };
};

const cleaned = (points: Point[]) => {
    let result = points.filter((point, index) => {
        const next = points[(index + 1) % points.length];
        return point.x !== next.x || point.y !== next.y;
    });
    // Drop corners between two edges of the same direction, until none is left.
    for (let changed = true; changed && result.length > 2; ) {
        changed = false;
        for (let index = 0; index < result.length; index += 1) {
            const previous = result[(index - 1 + result.length) % result.length];
            const point = result[index];
            const next = result[(index + 1) % result.length];
            if (
                (previous.x === point.x && point.x === next.x) ||
                (previous.y === point.y && point.y === next.y)
            ) {
                result = result.filter((_, other) => other !== index);
                changed = true;
                break;
            }
        }
    }
    return result;
};

const roomFromContour = (points: Point[]): Room | null => {
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    let shifted = points.map((point) => ({
        x: Math.round(point.x - minX),
        y: Math.round(point.y - minY),
    }));
    if (signedPolygonArea(shifted.map((point, index) => ({ id: `v${index}`, ...point }))) < 0)
        shifted = shifted.reverse();
    const width = Math.max(...shifted.map((point) => point.x));
    const depth = Math.max(...shifted.map((point) => point.y));
    if (shifted.length < 4 || shifted.length > MAX_VERTICES) return null;
    const base = { width, depth, partitions: [], doors: [], windows: [], radiators: [] };
    if (shifted.length === 4) return base;
    // Start from the top-left corner so the walls get stable, readable names.
    const start = shifted.reduce(
        (best, point, index) =>
            point.y < shifted[best].y || (point.y === shifted[best].y && point.x < shifted[best].x)
                ? index
                : best,
        0,
    );
    const vertices: RoomVertex[] = [...shifted.slice(start), ...shifted.slice(0, start)].map(
        (point, index) => ({ id: `v${index + 1}`, ...point }),
    );
    return { ...base, geometry: { version: 1, kind: "orthogonal", vertices } };
};

const projection = (segment: RoomBoundarySegment, point: Point) => {
    const dx = (segment.end.x - segment.start.x) / segment.length;
    const dy = (segment.end.y - segment.start.y) / segment.length;
    const along = (point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy;
    const across = Math.abs((point.x - segment.start.x) * dy - (point.y - segment.start.y) * dx);
    const clamped = Math.max(0, Math.min(segment.length, along));
    return { along: clamped, distance: across + Math.abs(along - clamped) };
};

/**
 * Turns one room the model read into a planner room: walls straightened to
 * the planner's right angles, then doors and windows put back on the nearest
 * wall. Anything that cannot be represented is dropped and counted, never
 * guessed; a room the model could not size comes back without a room.
 */
export const importPlanRoom = (reading: ApartmentRoomReading): ImportedPlanRoom => {
    const kind = roomKindFromName(reading.name);
    const base = {
        name: reading.name,
        label: planRoomLabel(reading.name),
        ...(kind ? { kind } : {}),
        estimated: reading.estimated,
        area: null,
        simplified: false,
        droppedOpenings: 0,
        room: null,
    };
    if (!reading.measured || reading.reading.contour.length < 3) {
        return { ...base, problem: "На плане нет размеров этой комнаты." };
    }
    const contour = reading.reading.contour;
    const { points: straight, slanted } = withoutSlants(contour);

    for (const gap of MERGE_STEPS) {
        const mapX = clusters(
            straight.map((point) => point.x),
            gap,
        );
        const mapY = clusters(
            straight.map((point) => point.y),
            gap,
        );
        const merged = cleaned(straight.map((point) => ({ x: mapX(point.x), y: mapY(point.y) })));
        const room = merged.length >= 4 ? roomFromContour(merged) : null;
        if (!room || validateRoomGeometry(room)) continue;

        const minX = Math.min(...merged.map((point) => point.x));
        const minY = Math.min(...merged.map((point) => point.y));
        const place = (point: Point) => ({ x: mapX(point.x) - minX, y: mapY(point.y) - minY });
        const segments = getRoomBoundarySegments(room);
        const orthogonal = room.geometry?.kind === "orthogonal";
        const doors: DoorOpening[] = [];
        const windows: WindowOpening[] = [];
        let dropped = 0;

        // Windows first: they are where they are. A door's swing is then fitted
        // around them, since a plan rarely says which way a door opens.
        const ordered = reading.reading.openings
            .map((opening, index) => ({ opening, index }))
            .sort(
                (first, second) =>
                    Number(first.opening.kind !== "window") -
                    Number(second.opening.kind !== "window"),
            );
        ordered.forEach(({ opening, index }) => {
            const from = place(opening.from);
            const to = place(opening.to);
            const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
            const segment = segments
                .map((candidate) => ({
                    candidate,
                    distance: projection(candidate, middle).distance,
                }))
                .sort((first, second) => first.distance - second.distance)[0]?.candidate;
            if (!segment) return void (dropped += 1);
            const a = projection(segment, from).along;
            const b = projection(segment, to).along;
            const offset = Math.round(Math.min(a, b));
            const width = Math.round(Math.abs(b - a));
            if (
                width < MIN_OPENING_MM ||
                projection(segment, middle).distance > 400 ||
                offset + width > segment.length
            )
                return void (dropped += 1);
            const anchor = {
                wall: segment.wall,
                ...(orthogonal ? { segmentId: segment.id } : {}),
                offset,
                width,
            };
            if (opening.kind === "window") {
                const window: WindowOpening = {
                    id: `window-${index + 1}`,
                    ...anchor,
                    windowKind: "standard",
                };
                if (validateRoomGeometry({ ...room, windows: [...windows, window], doors }))
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
            if (door) doors.push(door);
            else dropped += 1;
        });

        return {
            ...base,
            area: Math.round(area(contour) / 10_000) / 100,
            simplified: slanted || gap > MERGE_STEPS[0],
            droppedOpenings: dropped,
            room: { ...room, doors, windows },
        };
    }
    return {
        ...base,
        area: Math.round(area(contour) / 10_000) / 100,
        problem: "Контур этой комнаты слишком сложный для редактора — нарисуйте её вручную.",
    };
};
