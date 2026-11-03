import type { BriefPriority, FurnishableRoomKind, SelectedPiece } from "./furniture-selection";

/**
 * One questionnaire for the whole apartment (blocks 1, 2 and 4 of the
 * designer's brief). Every answer is optional: a missing one takes the
 * default of an ordinary family.
 */
export interface ApartmentBrief {
    version: 1;
    /** Adults who sleep here every night; every two share a double bed. */
    adults?: number;
    /** Children under three: a cot each. */
    babies?: number;
    /** Children from three: a single or a 1200–1400 mm bed each. */
    children?: number;
    sofaSeats?: 2 | 3 | 4;
    armchairs?: number;
    bedsideTables?: "none" | "one" | "two" | "per-sleeper";
    tv?: "large" | "compact" | "none";
    desks?: number;
    dressingTable?: boolean;
    /** Most important first; what comes last gives way first. */
    priorities?: BriefPriority[];
}

export const DEFAULT_APARTMENT_BRIEF: Required<Omit<ApartmentBrief, "sofaSeats" | "armchairs">> &
    Pick<ApartmentBrief, "sofaSeats" | "armchairs"> = {
    version: 1,
    adults: 2,
    babies: 0,
    children: 0,
    bedsideTables: "per-sleeper",
    tv: "compact",
    desks: 0,
    dressingTable: false,
    priorities: [],
};

/** A room the brief is spread over, in the order the planner shows them. */
export interface BriefRoom {
    signature: string;
    kind: FurnishableRoomKind;
    areaM2: number;
}

export interface BriefAllocation {
    /** The set each room starts its ladder from, its main piece first. */
    pieces: Map<string, SelectedPiece[]>;
    /** What found no room, said plainly, e.g. a second bedroom that is not there. */
    notes: string[];
}

const piece = (definitionId: string, count = 1, size?: SelectedPiece["size"]): SelectedPiece => ({
    definitionId,
    count,
    ...(size ? { size } : {}),
});

const wardrobeFor = (areaM2: number) =>
    areaM2 < 11 ? "wardrobe-small" : areaM2 < 14 ? "wardrobe-medium" : "wardrobe-large";

const bedsideCount = (setting: NonNullable<ApartmentBrief["bedsideTables"]>, sleepers: number) =>
    setting === "none" ? 0 : setting === "one" ? 1 : setting === "two" ? 2 : Math.min(2, sleepers);

const sofaFor = (seats: ApartmentBrief["sofaSeats"], areaM2: number) =>
    seats === 4
        ? "sofa-four-left"
        : seats === 3
          ? "sofa-three"
          : seats === 2
            ? "sofa-two"
            : areaM2 >= 16
              ? "sofa-three"
              : "sofa-two";

const plural = (count: number, one: string, few: string, many: string) => {
    const tens = count % 100;
    const units = count % 10;
    const word =
        tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many;
    return `${count} ${word}`;
};

/**
 * Spreads the family over the rooms: every two adults get a bedroom with a
 * double bed, the largest first; children from three go two to a children's
 * room, then to spare bedrooms; a cot joins a children's room or the parents.
 * Desks go to a study first, then children's rooms, bedrooms and the living
 * room; a dressing table to the main bedroom. Whatever finds no room is
 * named in the notes, never dropped silently.
 */
export const allocateApartmentBrief = (
    rooms: BriefRoom[],
    answers: ApartmentBrief = { version: 1 },
): BriefAllocation => {
    const brief = { ...DEFAULT_APARTMENT_BRIEF, ...answers };
    const notes: string[] = [];
    const byArea = (kind: FurnishableRoomKind) =>
        rooms
            .filter((room) => room.kind === kind)
            .sort((first, second) => second.areaM2 - first.areaM2);
    const bedrooms = byArea("bedroom");
    const childrenRooms = byArea("children");

    // Who sleeps where: signature → beds as [definitionId, sleepers].
    const beds = new Map<
        string,
        { id: string; sleepers: number; size?: SelectedPiece["size"] }[]
    >();
    const addBed = (
        signature: string,
        id: string,
        sleepers: number,
        size?: SelectedPiece["size"],
    ) => beds.set(signature, [...(beds.get(signature) ?? []), { id, sleepers, size }]);

    const adultGroups = Math.ceil(Math.max(0, brief.adults) / 2);
    const freeBedrooms = [...bedrooms];
    for (let group = 0; group < adultGroups; group += 1) {
        const room = freeBedrooms.shift();
        if (room) addBed(room.signature, "double-bed", Math.min(2, brief.adults - group * 2));
    }
    const adultsLeft = Math.max(0, brief.adults - bedrooms.length * 2);
    if (adultsLeft > 0)
        notes.push(
            `Не хватило спален: ${plural(adultsLeft, "взрослому", "взрослым", "взрослым")} нужна ещё спальня.`,
        );

    // Children from three: two per children's room, then spare bedrooms.
    const childSlots = [...childrenRooms.flatMap((room) => [room, room]), ...freeBedrooms];
    let children = Math.max(0, brief.children);
    while (children > 0 && childSlots.length > 0) {
        const room = childSlots.shift()!;
        addBed(room.signature, "single-bed", 1, { width: 1400, depth: 2000 });
        children -= 1;
    }
    if (children > 0)
        notes.push(
            `Не хватило комнат: ${plural(children, "ребёнку", "детям", "детям")} нужно ещё место для сна.`,
        );

    // Cots: one per room, children's rooms first, then the parents.
    const cotRooms = [...childrenRooms, ...bedrooms];
    let babies = Math.max(0, brief.babies);
    for (const room of cotRooms) {
        if (babies === 0) break;
        addBed(room.signature, "cradle", 1);
        babies -= 1;
    }
    if (babies > 0)
        notes.push(
            `Не хватило места для ${plural(babies, "детской кроватки", "детских кроваток", "детских кроваток")}.`,
        );

    // Desks: study, children's rooms, bedrooms, then the living room; one per room.
    const deskRooms = [
        ...byArea("office"),
        ...childrenRooms,
        ...bedrooms,
        ...byArea("living"),
        ...byArea("kitchen-living"),
    ];
    const desks = new Set(
        deskRooms.slice(0, Math.max(0, brief.desks)).map((room) => room.signature),
    );
    if (brief.desks > deskRooms.length)
        notes.push(
            `Не хватило комнат: ${plural(brief.desks - deskRooms.length, "стол", "стола", "столов")} не поставлено.`,
        );
    const dressing = brief.dressingTable ? bedrooms[0] ?? null : null;
    if (brief.dressingTable && !dressing)
        notes.push("Туалетный столик некуда поставить: в квартире нет спальни.");

    const pieces = new Map<string, SelectedPiece[]>();
    for (const room of rooms) {
        const own = beds.get(room.signature) ?? [];
        const desk = desks.has(room.signature) ? [piece("desk")] : [];
        switch (room.kind) {
            case "bedroom":
            case "children": {
                // An empty bedroom still gets a bed: a guest or a later family member.
                const sleeping = own.length
                    ? own
                    : [
                          room.kind === "bedroom"
                              ? { id: "double-bed", sleepers: 2 }
                              : {
                                    id: "single-bed",
                                    sleepers: 1,
                                    size: { width: 1400, depth: 2000 },
                                },
                      ];
                const counted = new Map<string, SelectedPiece>();
                for (const bed of sleeping) {
                    const current = counted.get(bed.id);
                    counted.set(
                        bed.id,
                        current
                            ? { ...current, count: current.count + 1 }
                            : piece(bed.id, 1, bed.size),
                    );
                }
                // A cot has none; a single bed one at most; the room holds two.
                const tables = sleeping
                    .filter((bed) => bed.id !== "cradle")
                    .reduce(
                        (sum, bed) =>
                            sum +
                            (bed.id === "double-bed"
                                ? bedsideCount(brief.bedsideTables, bed.sleepers)
                                : Math.min(1, bedsideCount(brief.bedsideTables, 1))),
                        0,
                    );
                pieces.set(room.signature, [
                    ...Array.from(counted.values()),
                    ...(tables > 0 ? [piece("bedside-table", Math.min(2, tables))] : []),
                    piece(
                        room.kind === "children"
                            ? room.areaM2 < 11
                                ? "wardrobe-small"
                                : "wardrobe-medium"
                            : wardrobeFor(room.areaM2),
                    ),
                    ...(room.kind === "bedroom" && room.areaM2 >= 14 ? [piece("dresser")] : []),
                    ...(room.kind === "children" && room.areaM2 >= 11 ? [piece("bookcase")] : []),
                    ...(dressing?.signature === room.signature ? [piece("dressing-table")] : []),
                    ...desk,
                ]);
                break;
            }
            case "living":
            case "kitchen-living": {
                const armchairs = Math.min(
                    2,
                    Math.max(0, brief.armchairs ?? (room.areaM2 >= 20 ? 1 : 0)),
                );
                pieces.set(room.signature, [
                    piece(sofaFor(brief.sofaSeats, room.areaM2)),
                    piece("coffee-table"),
                    ...(brief.tv === "none" ? [] : [piece("tv"), piece("tv-console")]),
                    piece("bookcase"),
                    ...(armchairs > 0 ? [piece("armchair", armchairs)] : []),
                    ...(room.areaM2 >= 26 ? [piece("dining-square-four")] : []),
                    ...desk,
                ]);
                break;
            }
            case "office":
                pieces.set(room.signature, [
                    piece("desk"),
                    piece("bookcase"),
                    ...(room.areaM2 >= 12 ? [piece("wardrobe-small"), piece("sofa-two")] : []),
                ]);
                break;
        }
    }
    return { pieces, notes };
};

const BEDSIDE_SETTINGS = ["none", "one", "two", "per-sleeper"] as const;
const TV_SETTINGS = ["large", "compact", "none"] as const;
const PRIORITIES: readonly BriefPriority[] = ["storage", "bed", "work", "living", "tv", "dressing"];

/** Limits of the questionnaire's number fields; also applied to saved answers. */
export const BRIEF_LIMITS = {
    adults: 8,
    babies: 4,
    children: 6,
    armchairs: 2,
    desks: 4,
} as const;

const count = (value: unknown, maximum: number): number | undefined =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.min(maximum, Math.max(0, Math.round(value)))
        : undefined;

/**
 * Answers read back from a saved project: anything unknown or out of range is
 * dropped or clamped, so a damaged answer never blocks opening the drawing.
 */
export const normalizeApartmentBrief = (input: unknown): ApartmentBrief | undefined => {
    if (!input || typeof input !== "object" || (input as ApartmentBrief).version !== 1)
        return undefined;
    const source = input as Record<string, unknown>;
    const brief: ApartmentBrief = { version: 1 };
    for (const key of Object.keys(BRIEF_LIMITS) as (keyof typeof BRIEF_LIMITS)[]) {
        const value = count(source[key], BRIEF_LIMITS[key]);
        if (value !== undefined) brief[key] = value;
    }
    if (source.sofaSeats === 2 || source.sofaSeats === 3 || source.sofaSeats === 4)
        brief.sofaSeats = source.sofaSeats;
    if (BEDSIDE_SETTINGS.includes(source.bedsideTables as never))
        brief.bedsideTables = source.bedsideTables as ApartmentBrief["bedsideTables"];
    if (TV_SETTINGS.includes(source.tv as never)) brief.tv = source.tv as ApartmentBrief["tv"];
    if (typeof source.dressingTable === "boolean") brief.dressingTable = source.dressingTable;
    if (Array.isArray(source.priorities)) {
        const priorities = source.priorities.filter(
            (item, index, all): item is BriefPriority =>
                PRIORITIES.includes(item as BriefPriority) && all.indexOf(item) === index,
        );
        if (priorities.length) brief.priorities = priorities;
    }
    return brief;
};
