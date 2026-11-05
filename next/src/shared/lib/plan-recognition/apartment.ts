import { readingFromModel, type PlanReading } from "./reading";

/**
 * Reading a whole apartment's measured plan. The planner furnishes one room at
 * a time from that room's own sizes, so what matters is whether each room was
 * read right: its area, wall lengths and windows. Where rooms sit relative to
 * each other is not scored.
 */
export const APARTMENT_READING_PROMPT = `You read a measured floor plan (обмерный план) of an apartment and return every room's geometry as JSON.

The sheet shows walls, partitions, window openings, door openings and dimension chains. Read sizes from the dimension numbers, not from pixels. A sheet note or the numbers' size tells the units: most sheets are in millimetres, some in centimetres or metres. Always answer in millimetres.

Return only JSON of this shape:
{
  "units_on_drawing": "mm" | "cm" | "m",
  "rooms": [
    {
      "name": string,
      "contour": [{"x": number, "y": number}, ...],
      "estimated": boolean,
      "openings": [{"kind": "window" | "door" | "entrance", "wall": number, "offset": number, "width": number}, ...]
    }
  ]
}

Rules:
- One entry per room, bathroom, corridor, storeroom, balcony or loggia that walls or partitions enclose. Use the name written on the sheet if there is one, otherwise a short description such as "room at the top right".
- contour: the room's inner wall faces, corners in order, in millimetres, in one coordinate frame shared by all rooms: put the apartment's top-left corner at x=0, y=0, x to the right, y downwards, as on the sheet, so every room sits where it is on the plan and the walls between neighbouring rooms show as gaps of the wall's thickness. Slanted and curved walls: use straight edges between their ends.
- Always give a complete contour with numbers, never null or an empty list. Where the sheet states a size, use it. Where it does not (an open-plan zone bounded by dashed lines, a room with no dimension chain), measure it on the drawing: the sheet is to scale, so take the scale from the stated dimensions nearby.
- estimated: true when any of this room's sizes was measured on the drawing rather than read from a stated number; false when every size was stated.
- wall: the index of the contour edge holding the opening; edge i runs from contour[i] to contour[i+1], the last edge closes to contour[0].
- offset: millimetres along that edge from contour[wall] to the nearer end of the opening; width: the opening's width in millimetres.
- kind: "window" for windows, "door" for doors and doorways between rooms or onto a balcony, "entrance" for the apartment's front door (list it once, in the room it opens into).
- No other keys, no comments.`;

export interface ApartmentTruthRoom {
    name: string;
    /** m², from the sheet's room schedule when it has one. */
    area?: number | null;
    /** Interior wall lengths the sheet states for this room, mm. */
    walls?: number[];
    /** Windows in this room; null when the sheet leaves it unclear. */
    windows?: number | null;
}

export interface ApartmentTruth {
    rooms: ApartmentTruthRoom[];
    entrance: boolean;
    /** False when the sheet names no rooms and the truth's names are made up: match by size only. */
    namesOnSheet?: boolean;
    /**
     * m² without balconies and loggias, for plans that state only the total
     * (developers' plans): compared with the sum of the rooms the model read.
     */
    totalArea?: number;
    /**
     * Dimensions the sheet states without saying whose room they bound (open
     * plans split by dashed lines): each must appear among any room's walls.
     */
    walls?: number[];
    note?: string;
}

export interface ApartmentRoomReading {
    name: string;
    reading: PlanReading;
    entrances: number;
    /** Windows the model saw but could not place (BTI plans give no offsets). */
    unplacedWindows: number;
    /** False when the model named the room but gave no usable contour. */
    measured: boolean;
    /** True when the model measured some of the room's sizes on the drawing instead of reading them. */
    estimated: boolean;
}

const placed = (opening: unknown) => {
    const { wall, offset, width } = (opening ?? {}) as Record<string, unknown>;
    return typeof wall === "number" && typeof offset === "number" && typeof width === "number";
};

/**
 * A model's apartment answer, checked. A room without a usable contour is
 * kept unmeasured and an opening without a position only as a count, since
 * many plans (BTI) dimension neither small rooms nor openings.
 */
export const apartmentFromModel = (
    raw: unknown,
): { rooms: ApartmentRoomReading[] } | { error: string } => {
    if (!raw || typeof raw !== "object") return { error: "Ответ не JSON-объект." };
    const rooms = (raw as { rooms?: unknown }).rooms;
    if (!Array.isArray(rooms) || !rooms.length) return { error: "В ответе нет комнат." };
    const parsed: ApartmentRoomReading[] = [];
    for (let index = 0; index < rooms.length; index += 1) {
        const room: unknown = rooms[index];
        const source = (room ?? {}) as {
            name?: unknown;
            contour?: unknown;
            openings?: unknown;
            estimated?: unknown;
        };
        const openings = (Array.isArray(source.openings) ? source.openings : []).filter((opening) =>
            ["window", "door", "entrance"].includes(
                (opening as { kind?: unknown })?.kind as string,
            ),
        ) as { kind: string }[];
        const result = readingFromModel({
            contour: source.contour,
            openings: openings
                .filter(placed)
                .map((opening) =>
                    opening.kind === "entrance" ? { ...opening, kind: "door" } : opening,
                ),
        });
        parsed.push({
            name: typeof source.name === "string" ? source.name : `#${index + 1}`,
            // A room the sheet gives no sizes for (a BTI toilet) is still a room found.
            reading: "error" in result ? { contour: [], openings: [] } : result.reading,
            measured: !("error" in result),
            estimated: source.estimated === true,
            entrances: openings.filter((opening) => opening.kind === "entrance").length,
            unplacedWindows: openings.filter(
                (opening) => opening.kind === "window" && !placed(opening),
            ).length,
        });
    }
    return { rooms: parsed };
};

export const contourArea = (contour: { x: number; y: number }[]) =>
    Math.abs(
        contour.reduce((sum, point, index) => {
            const next = contour[(index + 1) % contour.length];
            return sum + point.x * next.y - next.x * point.y;
        }, 0) / 2,
    ) / 1_000_000;

const wallLengths = (contour: { x: number; y: number }[]) =>
    contour.map((point, index) => {
        const next = contour[(index + 1) % contour.length];
        return Math.hypot(next.x - point.x, next.y - point.y);
    });

const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((first, second) => first - second);
    return sorted[Math.floor(sorted.length / 2)];
};

const simplified = (name: string) => name.toLowerCase().replace(/[^a-zа-яё]/g, "");
/** A BTI room number at the start of a name: "2", "2а", "2а (балкон)". */
const roomNumber = (name: string) =>
    name
        .trim()
        .toLowerCase()
        .match(/^(\d+[а-яa-z]?)(?![\dа-яa-z])/)?.[1];
const sameName = (first: string, second: string) => {
    const numbers = [roomNumber(first), roomNumber(second)];
    if (numbers[0] && numbers[1]) return numbers[0] === numbers[1];
    const a = simplified(first);
    const b = simplified(second);
    return a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a));
};

/** Truth wall → the nearest wall length the model gave for that room. */
const wallErrors = (truth: number[], read: number[]) =>
    read.length
        ? truth.map((length) => Math.min(...read.map((candidate) => Math.abs(candidate - length))))
        : truth.map(() => Number.POSITIVE_INFINITY);

export interface ApartmentScore {
    rooms: number;
    roomsFound: number;
    /** Model rooms that match no truth room. */
    roomsExtra: number;
    /** Rooms found that the model left without sizes (the sheet gives none). */
    roomsUnmeasured: number;
    /** Rooms found whose sizes the model partly measured on the drawing. */
    roomsEstimated: number;
    /** Median |area − truth| / truth over matched rooms with a known area. */
    areaErrorMedian: number;
    walls: number;
    /** Truth walls the model got within 50 mm. */
    wallsExact: number;
    wallErrorMedian: number;
    windowsChecked: number;
    windowsRight: number;
    /** |sum of read rooms without balconies − totalArea| / totalArea, when the truth gives it. */
    totalAreaError: number | null;
    entranceRight: boolean;
    /** Truth room → model room name, for the report. */
    matches: { truth: string; read: string | null; areaError: number | null }[];
}

/** Balconies and loggias stay out of a flat's total area. */
const OUTDOOR = /балкон|лодж|террас|balcon|loggia|terrace/i;

const AREA_LIMIT = 0.3;
const WALL_FIT_LIMIT = 0.2;

export const scoreApartment = (
    truth: ApartmentTruth,
    rooms: ApartmentRoomReading[],
): ApartmentScore => {
    const read = rooms.map((room) => ({
        room,
        area: contourArea(room.reading.contour),
        walls: room.reading.contour.length ? wallLengths(room.reading.contour) : [],
        windows:
            room.reading.openings.filter((opening) => opening.kind === "window").length +
            room.unplacedWindows,
    }));
    const unused = new Set(read.map((_, index) => index));
    const order = truth.rooms
        .map((room, index) => ({ room, index }))
        .sort((first, second) => (second.room.area ?? 0) - (first.room.area ?? 0));
    const matched = new Map<number, number>();
    const costOf = (room: ApartmentTruthRoom, candidate: (typeof read)[number]) => {
        const areaDiff = room.area ? Math.abs(candidate.area - room.area) / room.area : 0;
        const wallFit = room.walls?.length
            ? median(
                  wallErrors(room.walls, candidate.walls).map(
                      (error, wall) => error / room.walls![wall],
                  ),
              )
            : 0;
        return { areaDiff, wallFit, cost: areaDiff + wallFit };
    };
    const pick = (room: ApartmentTruthRoom, index: number, byName: boolean) => {
        let best = -1;
        let bestCost = Number.POSITIVE_INFINITY;
        unused.forEach((candidateIndex) => {
            const candidate = read[candidateIndex];
            const { areaDiff, wallFit, cost } = costOf(room, candidate);
            if (byName) {
                // The sheet's own name, copied by the model, identifies the room
                // however badly it was measured.
                if (!sameName(room.name, candidate.room.name)) return;
            } else {
                if (room.area && areaDiff > AREA_LIMIT) return;
                if (room.walls?.length && wallFit > WALL_FIT_LIMIT) return;
            }
            // An unmeasured room has no cost to compare, but its name still identifies it.
            if (best === -1 || cost < bestCost) {
                best = candidateIndex;
                bestCost = cost;
            }
        });
        if (best === -1) return;
        unused.delete(best);
        matched.set(index, best);
    };
    if (truth.namesOnSheet !== false) for (const { room, index } of order) pick(room, index, true);
    for (const { room, index } of order) if (!matched.has(index)) pick(room, index, false);

    const areaErrors: number[] = [];
    const allWallErrors: number[] = [];
    let walls = 0;
    let windowsChecked = 0;
    let windowsRight = 0;
    const matches = truth.rooms.map((room, index) => {
        walls += room.walls?.length ?? 0;
        const readIndex = matched.get(index);
        if (readIndex === undefined) return { truth: room.name, read: null, areaError: null };
        const candidate = read[readIndex];
        const areaError =
            room.area && candidate.room.measured
                ? Math.abs(candidate.area - room.area) / room.area
                : null;
        if (areaError !== null) areaErrors.push(areaError);
        // Walls of a room left without sizes count as missed, not as an infinite error.
        if (room.walls?.length && candidate.room.measured)
            allWallErrors.push(...wallErrors(room.walls, candidate.walls));
        if (room.windows !== null && room.windows !== undefined) {
            windowsChecked += 1;
            if (candidate.windows === room.windows) windowsRight += 1;
        }
        return { truth: room.name, read: candidate.room.name, areaError };
    });

    if (truth.walls?.length) {
        walls += truth.walls.length;
        allWallErrors.push(
            ...wallErrors(
                truth.walls,
                read.flatMap((candidate) => candidate.walls),
            ),
        );
    }
    const indoor = read.filter(
        (candidate) => candidate.room.measured && !OUTDOOR.test(candidate.room.name),
    );
    const totalAreaError = truth.totalArea
        ? Math.abs(indoor.reduce((sum, candidate) => sum + candidate.area, 0) - truth.totalArea) /
          truth.totalArea
        : null;

    return {
        totalAreaError,
        rooms: truth.rooms.length,
        roomsFound: matched.size,
        roomsExtra: unused.size,
        roomsUnmeasured: Array.from(matched.values()).filter((index) => !read[index].room.measured)
            .length,
        roomsEstimated: read.filter((candidate) => candidate.room.estimated).length,
        areaErrorMedian: median(areaErrors),
        walls,
        wallsExact: allWallErrors.filter((error) => error <= 50).length,
        wallErrorMedian: Math.round(median(allWallErrors)),
        windowsChecked,
        windowsRight,
        entranceRight: rooms.some((room) => room.entrances > 0) === truth.entrance,
        matches,
    };
};
