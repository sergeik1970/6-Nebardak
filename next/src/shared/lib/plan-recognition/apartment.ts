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
      "openings": [{"kind": "window" | "door" | "entrance", "wall": number, "offset": number, "width": number}, ...]
    }
  ]
}

Rules:
- One entry per room, bathroom, corridor, storeroom, balcony or loggia that walls or partitions enclose. Use the name written on the sheet if there is one, otherwise a short description such as "room at the top right".
- contour: the room's inner wall faces, corners in order, in millimetres, in the room's own coordinates: put the room's top-left corner at x=0, y=0, x to the right, y downwards, as on the sheet. Slanted and curved walls: use straight edges between their ends.
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
    note?: string;
}

export interface ApartmentRoomReading {
    name: string;
    reading: PlanReading;
    entrances: number;
}

/** A model's apartment answer, checked; malformed rooms make the answer an error. */
export const apartmentFromModel = (
    raw: unknown,
): { rooms: ApartmentRoomReading[] } | { error: string } => {
    if (!raw || typeof raw !== "object") return { error: "Ответ не JSON-объект." };
    const rooms = (raw as { rooms?: unknown }).rooms;
    if (!Array.isArray(rooms) || !rooms.length) return { error: "В ответе нет комнат." };
    const parsed: ApartmentRoomReading[] = [];
    for (let index = 0; index < rooms.length; index += 1) {
        const room: unknown = rooms[index];
        const source = (room ?? {}) as { name?: unknown; contour?: unknown; openings?: unknown };
        const openings = Array.isArray(source.openings) ? source.openings : [];
        const entrances = openings.filter(
            (opening) => (opening as { kind?: unknown })?.kind === "entrance",
        ).length;
        const result = readingFromModel({
            contour: source.contour,
            openings: openings.map((opening) =>
                (opening as { kind?: unknown })?.kind === "entrance"
                    ? { ...(opening as object), kind: "door" }
                    : opening,
            ),
        });
        if ("error" in result) return { error: `Комната ${index + 1}: ${result.error}` };
        parsed.push({
            name: typeof source.name === "string" ? source.name : `#${index + 1}`,
            reading: result.reading,
            entrances,
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
const sameName = (first: string, second: string) => {
    const a = simplified(first);
    const b = simplified(second);
    return a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a));
};

/** Truth wall → the nearest wall length the model gave for that room. */
const wallErrors = (truth: number[], read: number[]) =>
    truth.map((length) => Math.min(...read.map((candidate) => Math.abs(candidate - length))));

export interface ApartmentScore {
    rooms: number;
    roomsFound: number;
    /** Model rooms that match no truth room. */
    roomsExtra: number;
    /** Median |area − truth| / truth over matched rooms with a known area. */
    areaErrorMedian: number;
    walls: number;
    /** Truth walls the model got within 50 mm. */
    wallsExact: number;
    wallErrorMedian: number;
    windowsChecked: number;
    windowsRight: number;
    entranceRight: boolean;
    /** Truth room → model room name, for the report. */
    matches: { truth: string; read: string | null; areaError: number | null }[];
}

const AREA_LIMIT = 0.3;
const WALL_FIT_LIMIT = 0.2;

export const scoreApartment = (
    truth: ApartmentTruth,
    rooms: ApartmentRoomReading[],
): ApartmentScore => {
    const read = rooms.map((room) => ({
        room,
        area: contourArea(room.reading.contour),
        walls: wallLengths(room.reading.contour),
        windows: room.reading.openings.filter((opening) => opening.kind === "window").length,
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
            if (cost < bestCost) {
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
        const areaError = room.area ? Math.abs(candidate.area - room.area) / room.area : null;
        if (areaError !== null) areaErrors.push(areaError);
        if (room.walls?.length) allWallErrors.push(...wallErrors(room.walls, candidate.walls));
        if (room.windows !== null && room.windows !== undefined) {
            windowsChecked += 1;
            if (candidate.windows === room.windows) windowsRight += 1;
        }
        return { truth: room.name, read: candidate.room.name, areaError };
    });

    return {
        rooms: truth.rooms.length,
        roomsFound: matched.size,
        roomsExtra: unused.size,
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
