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
    /** Block 3. Missing: wardrobes are chosen by room area, as before. */
    storage?: StorageBrief;
}

/** Block 3: what is kept, in the designer's own ranges. */
export interface StorageBrief {
    /** Coats, jackets, suits: about 12 cm of rail each. */
    longHangers?: "none" | "up-to-10" | "10-20" | "20-40" | "40+";
    /** Shirts, dresses, trousers: about 4 cm of rail each, two tiers. */
    shortHangers?: number;
    /** Shelf blocks 40 cm wide, the cabinet's full height. */
    shelfBlocks?: number;
    shoePairs?: "up-to-10" | "10-20" | "20-30" | "30+";
    /** Suitcase, skis, pram, vacuum cleaner, ironing board. */
    bulkyItems?: "0-2" | "3-5" | "6+";
    /** About 30 books per metre of shelf. */
    bookMeters?: "up-to-1" | "1-3" | "3-5" | "5+";
}

/** Each range at its upper end, so the wardrobe is never short. */
const LONG_HANGERS = { none: 0, "up-to-10": 10, "10-20": 20, "20-40": 40, "40+": 50 } as const;
const SHOE_PAIRS = { "up-to-10": 10, "10-20": 20, "20-30": 30, "30+": 40 } as const;
const BULKY_SECTION_MM = { "0-2": 400, "3-5": 800, "6+": 1200 } as const;
const BOOK_METERS = { "up-to-1": 1, "1-3": 3, "3-5": 5, "5+": 7 } as const;
/** Rail per long hanger, per short one, and a bookcase's shelf length, mm. */
const LONG_HANGER_MM = 120;
const SHORT_HANGER_MM = 40;
const SHELF_BLOCK_MM = 400;
/** The designer's rule: a 1 m section of five 1 m shelves per 20 pairs. */
const SHOE_SECTION_MM_PER_PAIR = 50;
const BOOKCASE_SHELF_METERS = 4;
/** One wardrobe is at most this long; longer runs split in two. */
const WARDROBE_MAX_MM = 2400;

/** Wardrobe length a household needs, mm, at the standard 2200 mm height. */
export const storageNeeds = (storage: StorageBrief) => {
    const longRail = LONG_HANGERS[storage.longHangers ?? "10-20"] * LONG_HANGER_MM;
    const shoes = SHOE_PAIRS[storage.shoePairs ?? "10-20"] * SHOE_SECTION_MM_PER_PAIR;
    const bulky = BULKY_SECTION_MM[storage.bulkyItems ?? "0-2"];
    return {
        /** Coats in one tier, shoes and the bulky section: the hallway's share. */
        hallway: longRail + shoes + bulky,
        /** The same with coats in two tiers: the hallway's first concession. */
        hallwayTwoTiers: Math.ceil(longRail / 2) + shoes + bulky,
        /** Everyday clothes in two tiers and the shelf blocks: the bedrooms' share. */
        clothes:
            Math.ceil(((storage.shortHangers ?? 30) * SHORT_HANGER_MM) / 2) +
            (storage.shelfBlocks ?? 1) * SHELF_BLOCK_MM,
        bookcases: Math.ceil(BOOK_METERS[storage.bookMeters ?? "1-3"] / BOOKCASE_SHELF_METERS),
    };
};

const roundUp = (value: number) => Math.ceil(value / 50) * 50;

/**
 * Wardrobes of exactly the needed length: the catalogue piece whose length
 * class it falls in, sized to it; past 2.4 m, two equal ones.
 */
export const wardrobesFor = (
    lengthMm: number,
    smaller: { lengthMm: number; reason: string }[] = [],
): SelectedPiece[] => {
    if (lengthMm <= 0) return [];
    const count = lengthMm > WARDROBE_MAX_MM ? 2 : 1;
    const each = Math.max(600, roundUp(Math.min(lengthMm, 2 * WARDROBE_MAX_MM) / count));
    const definitionId =
        each <= 700 ? "wardrobe-small" : each <= 1500 ? "wardrobe-medium" : "wardrobe-large";
    const depth = definitionId === "wardrobe-small" ? 500 : 600;
    return [
        {
            definitionId,
            count,
            size: { width: each, depth },
            ...(smaller.length
                ? {
                      smaller: smaller
                          .map((rung) => ({
                              size: { width: Math.max(600, roundUp(rung.lengthMm / count)), depth },
                              reason: rung.reason,
                          }))
                          .filter((rung) => rung.size.width < each),
                  }
                : {}),
        },
    ];
};

/** The wardrobes of a room's set, lengthened by `extraMm`: storage the hallway could not hold. */
export const withExtraWardrobe = (pieces: SelectedPiece[], extraMm: number): SelectedPiece[] => {
    const isWardrobe = (item: SelectedPiece) => item.definitionId.startsWith("wardrobe-");
    const current = pieces
        .filter(isWardrobe)
        .reduce((sum, item) => sum + (item.size?.width ?? 0) * item.count, 0);
    const index = pieces.findIndex(isWardrobe);
    const rest = pieces.filter((item) => !isWardrobe(item));
    const wardrobes = wardrobesFor(current + extraMm);
    return index === -1
        ? [...pieces, ...wardrobes]
        : [...rest.slice(0, index), ...wardrobes, ...rest.slice(index)];
};

export const DEFAULT_APARTMENT_BRIEF: Required<
    Omit<ApartmentBrief, "sofaSeats" | "armchairs" | "storage">
> &
    Pick<ApartmentBrief, "sofaSeats" | "armchairs" | "storage"> = {
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
    /**
     * The hallway's wardrobe length and the room that takes what the hallway
     * cannot hold; only when the storage block is answered.
     */
    hallwayStorage?: { signature: string; lengthMm: number; overflowTo?: string };
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

/**
 * Screen and stand by the answer: a 65″ screen is about 1450 mm wide and gets
 * the catalogue's 1655 mm stand; a 50″ one is about 1120 mm on the usual stand.
 */
const tvPieces = (tv: "large" | "compact"): SelectedPiece[] =>
    tv === "large"
        ? [
              piece("tv", 1, { width: 1450, depth: 100 }),
              piece("tv-console", 1, { width: 1655, depth: 400 }),
          ]
        : [piece("tv", 1, { width: 1120, depth: 100 }), piece("tv-console")];

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

    // Block 3: wardrobes sized from belongings instead of room area.
    const storage = answers.storage;
    const needs = storage ? storageNeeds(storage) : null;
    const hallway = byArea("hallway")[0] ?? null;
    const sleepersIn = (signature: string) =>
        (beds.get(signature) ?? []).reduce((sum, bed) => sum + bed.sleepers, 0);
    const totalSleepers = rooms.reduce((sum, room) => sum + sleepersIn(room.signature), 0);
    const mainBedroom = bedrooms[0] ?? childrenRooms[0] ?? null;
    const clothesFor = (room: BriefRoom) => {
        if (!needs) return 0;
        const share = totalSleepers
            ? (needs.clothes * sleepersIn(room.signature)) / totalSleepers
            : 0;
        // Without a hallway, coats and shoes go to the main bedroom.
        const hallwayShare =
            !hallway && mainBedroom?.signature === room.signature ? needs.hallway : 0;
        return share + hallwayShare;
    };
    if (needs && !hallway && needs.hallway > 0)
        notes.push("В квартире нет прихожей: верхняя одежда и обувь — в шкафу спальни.");
    // Bookcases for the books: the living room first, then a study, children's rooms, bedrooms.
    const bookRooms = needs
        ? new Set(
              [
                  ...byArea("living"),
                  ...byArea("kitchen-living"),
                  ...byArea("office"),
                  ...childrenRooms,
                  ...bedrooms,
              ]
                  .slice(0, needs.bookcases)
                  .map((room) => room.signature),
          )
        : null;
    if (needs && bookRooms && needs.bookcases > bookRooms.size)
        notes.push(
            `Не хватило комнат: ${plural(needs.bookcases - bookRooms.size, "стеллаж", "стеллажа", "стеллажей")} для книг не поставлено.`,
        );
    const bookcase = (room: BriefRoom, byDefault: boolean) =>
        (bookRooms ? bookRooms.has(room.signature) : byDefault) ? [piece("bookcase")] : [];

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
                    ...(needs
                        ? wardrobesFor(clothesFor(room))
                        : [
                              piece(
                                  room.kind === "children"
                                      ? room.areaM2 < 11
                                          ? "wardrobe-small"
                                          : "wardrobe-medium"
                                      : wardrobeFor(room.areaM2),
                              ),
                          ]),
                    ...(room.kind === "bedroom" && room.areaM2 >= 14 ? [piece("dresser")] : []),
                    ...bookcase(room, room.kind === "children" && room.areaM2 >= 11),
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
                    ...(brief.tv === "none" ? [] : tvPieces(brief.tv)),
                    ...bookcase(room, true),
                    ...(armchairs > 0 ? [piece("armchair", armchairs)] : []),
                    ...(room.areaM2 >= 26 ? [piece("dining-square-four")] : []),
                    ...desk,
                ]);
                break;
            }
            case "hallway":
                // Coats in one tier; giving way, two tiers, then a shorter run.
                pieces.set(
                    room.signature,
                    needs && hallway?.signature === room.signature
                        ? wardrobesFor(needs.hallway, [
                              {
                                  lengthMm: needs.hallwayTwoTiers,
                                  reason: "верхняя одежда в два яруса",
                              },
                              {
                                  lengthMm: needs.hallwayTwoTiers * 0.75,
                                  reason: "шкаф короче: стены не хватает",
                              },
                              {
                                  lengthMm: needs.hallwayTwoTiers * 0.5,
                                  reason: "шкаф короче: стены не хватает",
                              },
                          ])
                        : [piece("wardrobe-medium")],
                );
                break;
            case "office":
                pieces.set(room.signature, [
                    piece("desk"),
                    ...bookcase(room, true),
                    ...(room.areaM2 >= 12 ? [piece("wardrobe-small"), piece("sofa-two")] : []),
                ]);
                break;
        }
    }
    return {
        pieces,
        notes,
        ...(needs && hallway
            ? {
                  hallwayStorage: {
                      signature: hallway.signature,
                      lengthMm: needs.hallway,
                      ...(mainBedroom ? { overflowTo: mainBedroom.signature } : {}),
                  },
              }
            : {}),
    };
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
    const storage = normalizeStorageBrief(source.storage);
    if (storage) brief.storage = storage;
    if (Array.isArray(source.priorities)) {
        const priorities = source.priorities.filter(
            (item, index, all): item is BriefPriority =>
                PRIORITIES.includes(item as BriefPriority) && all.indexOf(item) === index,
        );
        if (priorities.length) brief.priorities = priorities;
    }
    return brief;
};

/** Limits of the storage block's number fields. */
export const STORAGE_LIMITS = { shortHangers: 300, shelfBlocks: 4 } as const;

const normalizeStorageBrief = (input: unknown): StorageBrief | undefined => {
    if (!input || typeof input !== "object") return undefined;
    const source = input as Record<string, unknown>;
    const storage: StorageBrief = {};
    const pick = <Key extends keyof StorageBrief>(key: Key, allowed: readonly string[]) => {
        if (allowed.includes(source[key] as string))
            storage[key] = source[key] as StorageBrief[Key];
    };
    pick("longHangers", Object.keys(LONG_HANGERS));
    pick("shoePairs", Object.keys(SHOE_PAIRS));
    pick("bulkyItems", Object.keys(BULKY_SECTION_MM));
    pick("bookMeters", Object.keys(BOOK_METERS));
    for (const key of Object.keys(STORAGE_LIMITS) as (keyof typeof STORAGE_LIMITS)[]) {
        const value = count(source[key], STORAGE_LIMITS[key]);
        if (value !== undefined) storage[key] = value;
    }
    return storage;
};
