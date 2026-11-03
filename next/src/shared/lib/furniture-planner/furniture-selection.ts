import { buildFurnitureInstances, getFurniture } from "./catalog";
import {
    getDoorFurnitureObstacles,
    getPartitionObstacleRects,
    getRadiatorBody,
    getRadiatorServiceObstacle,
    getWindowCurtainObstacle,
    rectsIntersect,
} from "./geometry";
import {
    getRoomArea,
    getRoomBoundarySegments,
    getSegmentSpanRect,
    rectInsideRoomGeometry,
} from "./room-geometry";
import { solveRoom, solveRoomFromMainPiece, solveWithPreferredPlacementFallback } from "./solver";
import type {
    FurnitureInstance,
    FurnitureSelection,
    FurnitureSize,
    LayoutPreferences,
    LayoutVariant,
    Placement,
    Rect,
    Room,
    RoomKind,
    Wall,
} from "./types";

/**
 * Bump when the rules below change: a saved choice can then say which rules
 * made it. The first draft is ours; the designer edits it.
 */
export const FURNITURE_RULES_VERSION = 1;

/** What the people living there need. Every answer is optional. */
export interface RoomBrief {
    /** Ages of the children who sleep in this room. */
    childrenAges?: number[];
    worksFromHome?: boolean;
    /** Missing means yes: most living rooms get a TV. */
    watchesTv?: boolean;
    pets?: ("cat" | "dog")[];
}

export type FurnishableRoomKind = Extract<
    RoomKind,
    "bedroom" | "living" | "kitchen-living" | "children" | "office"
>;

export const isFurnishableRoomKind = (kind: RoomKind | undefined): kind is FurnishableRoomKind =>
    kind === "bedroom" ||
    kind === "living" ||
    kind === "kitchen-living" ||
    kind === "children" ||
    kind === "office";

export interface SelectedPiece {
    definitionId: string;
    count: number;
    /** A size other than the catalogue's. */
    size?: FurnitureSize;
}

export type SelectionChange =
    | { kind: "smaller"; definitionId: string; from: string; to: string; reason: string }
    | { kind: "left-out"; definitionId: string; count: number; reason: string };

/** One rung of the ladder: a set, and how it differs from the full one. */
export interface SelectionStep {
    pieces: SelectedPiece[];
    changes: SelectionChange[];
}

const piece = (definitionId: string, count = 1, size?: FurnitureSize): SelectedPiece => ({
    definitionId,
    count,
    ...(size ? { size } : {}),
});

const childBed = (age: number): string =>
    age < 3 ? "cradle" : age < 7 ? "child-bed" : "single-bed";

/**
 * The set a room of this kind and area gets when nothing is in the way. The
 * first piece is what the room is for; the ladder never takes it away.
 */
export const fullFurnitureSet = (
    kind: FurnishableRoomKind,
    areaM2: number,
    brief: RoomBrief = {},
): SelectedPiece[] => {
    switch (kind) {
        case "bedroom":
            return [
                piece("double-bed"),
                piece("bedside-table", 2),
                piece(
                    areaM2 < 11
                        ? "wardrobe-small"
                        : areaM2 < 14
                          ? "wardrobe-medium"
                          : "wardrobe-large",
                ),
                ...(areaM2 >= 14 ? [piece("dresser")] : []),
                ...(brief.worksFromHome && areaM2 >= 14 ? [piece("desk")] : []),
            ];
        case "living":
        case "kitchen-living": {
            const tv = brief.watchesTv !== false;
            return [
                piece(areaM2 >= 16 ? "sofa-three" : "sofa-two"),
                piece("coffee-table"),
                ...(tv ? [piece("tv"), piece("tv-console")] : []),
                piece("bookcase"),
                ...(areaM2 >= 20 ? [piece("armchair")] : []),
                ...(areaM2 >= 26 ? [piece("dining-square-four")] : []),
                ...(brief.worksFromHome && areaM2 >= 18 ? [piece("desk")] : []),
                ...(brief.pets?.includes("dog") ? [piece("pet-bed")] : []),
            ];
        }
        case "children": {
            const ages = brief.childrenAges?.length ? brief.childrenAges : [8];
            const beds = ages.slice(0, 2).map(childBed);
            // The catalogue holds one single bed; a second older child gets a child's bed.
            const counted = beds.reduce<Record<string, number>>((counts, id, index) => {
                const bed =
                    id === "single-bed" && index > 0 && beds[0] === "single-bed" ? "child-bed" : id;
                counts[bed] = (counts[bed] ?? 0) + 1;
                return counts;
            }, {});
            return [
                ...Object.entries(counted).map(([id, count]) => piece(id, count)),
                ...(ages.some((age) => age >= 6) ? [piece("desk")] : []),
                piece(areaM2 < 11 ? "wardrobe-small" : "wardrobe-medium"),
                ...(areaM2 >= 11 ? [piece("bookcase")] : []),
            ];
        }
        case "office":
            return [
                piece("desk"),
                piece("bookcase"),
                ...(areaM2 >= 12 ? [piece("wardrobe-small"), piece("sofa-two")] : []),
            ];
    }
};

/** One way to give way, tried only when the set holds the piece it names. */
type Move =
    | { kind: "size"; definitionId: string; size: FurnitureSize; reason: string }
    | { kind: "swap"; definitionId: string; to: string; reason: string }
    | { kind: "less"; definitionId: string; reason: string };

/**
 * The order in which a room gives way: what people miss least goes first.
 * The main piece is never left out.
 */
const LADDERS: Record<FurnishableRoomKind, Move[]> = {
    bedroom: [
        {
            kind: "size",
            definitionId: "double-bed",
            size: { width: 1600, depth: 2000 },
            reason: "кровать 1800 мм не помещается с проходами",
        },
        { kind: "less", definitionId: "desk", reason: "рабочему столу не хватает места" },
        { kind: "less", definitionId: "dresser", reason: "комоду не хватает места" },
        {
            kind: "swap",
            definitionId: "wardrobe-large",
            to: "wardrobe-medium",
            reason: "большой шкаф не помещается",
        },
        {
            kind: "swap",
            definitionId: "wardrobe-medium",
            to: "wardrobe-small",
            reason: "средний шкаф не помещается",
        },
        {
            kind: "size",
            definitionId: "double-bed",
            size: { width: 1400, depth: 2000 },
            reason: "кровать 1600 мм не помещается с проходами",
        },
        { kind: "less", definitionId: "bedside-table", reason: "с двух сторон тумбам тесно" },
        { kind: "less", definitionId: "wardrobe-small", reason: "шкафу не хватает места" },
        {
            kind: "swap",
            definitionId: "double-bed",
            to: "single-bed",
            reason: "двуспальная кровать не помещается даже шириной 1400 мм",
        },
    ],
    living: [
        { kind: "less", definitionId: "pet-bed", reason: "лежанке не хватает места" },
        { kind: "less", definitionId: "desk", reason: "рабочему столу не хватает места" },
        {
            kind: "less",
            definitionId: "dining-square-four",
            reason: "обеденной группе не хватает места",
        },
        { kind: "less", definitionId: "armchair", reason: "креслу не хватает места" },
        {
            kind: "swap",
            definitionId: "sofa-three",
            to: "sofa-two",
            reason: "диван на 3 места не помещается",
        },
        { kind: "less", definitionId: "bookcase", reason: "стеллажу не хватает места" },
        {
            kind: "less",
            definitionId: "coffee-table",
            reason: "журнальному столику не хватает места",
        },
    ],
    "kitchen-living": [],
    children: [
        { kind: "less", definitionId: "bookcase", reason: "стеллажу не хватает места" },
        {
            kind: "swap",
            definitionId: "wardrobe-medium",
            to: "wardrobe-small",
            reason: "средний шкаф не помещается",
        },
        { kind: "less", definitionId: "desk", reason: "рабочему столу не хватает места" },
        { kind: "less", definitionId: "wardrobe-small", reason: "шкафу не хватает места" },
    ],
    office: [
        { kind: "less", definitionId: "sofa-two", reason: "дивану не хватает места" },
        { kind: "less", definitionId: "wardrobe-small", reason: "шкафу не хватает места" },
        { kind: "less", definitionId: "bookcase", reason: "стеллажу не хватает места" },
    ],
};

const sizeLabel = (definitionId: string, size?: FurnitureSize): string => {
    const definition = getFurniture(definitionId);
    const width =
        size?.width ?? Math.max(...definition.body.rects.map((rect) => rect.x + rect.width));
    const depth =
        size?.depth ?? Math.max(...definition.body.rects.map((rect) => rect.y + rect.depth));
    return `${definition.shortLabel} ${width} × ${depth} мм`;
};

const applyMove = (pieces: SelectedPiece[], move: Move): SelectionStep | null => {
    const index = pieces.findIndex((item) => item.definitionId === move.definitionId);
    if (index === -1) return null;
    const current = pieces[index];
    // The first piece is what the room is for: it may shrink but never goes.
    if (move.kind === "less" && index === 0) return null;

    switch (move.kind) {
        case "size": {
            const next = [...pieces];
            next[index] = { ...current, size: move.size };
            return {
                pieces: next,
                changes: [
                    {
                        kind: "smaller",
                        definitionId: move.definitionId,
                        from: sizeLabel(current.definitionId, current.size),
                        to: sizeLabel(current.definitionId, move.size),
                        reason: move.reason,
                    },
                ],
            };
        }
        case "swap": {
            const next = [...pieces];
            next[index] = { definitionId: move.to, count: current.count };
            return {
                pieces: next,
                changes: [
                    {
                        kind: "smaller",
                        definitionId: move.definitionId,
                        from: getFurniture(move.definitionId).shortLabel,
                        to: getFurniture(move.to).shortLabel,
                        reason: move.reason,
                    },
                ],
            };
        }
        case "less": {
            const next =
                current.count > 1
                    ? pieces.map((item, at) =>
                          at === index ? { ...item, count: item.count - 1 } : item,
                      )
                    : pieces.filter((_, at) => at !== index);
            return {
                pieces: next,
                changes: [
                    {
                        kind: "left-out",
                        definitionId: move.definitionId,
                        count: 1,
                        reason: move.reason,
                    },
                ],
            };
        }
    }
};

/**
 * The full set first, then each move that applies, one after another. Every
 * rung keeps the changes made so far, so a result can explain itself.
 */
export const selectionLadder = (
    kind: FurnishableRoomKind,
    areaM2: number,
    brief: RoomBrief = {},
): SelectionStep[] => {
    const steps: SelectionStep[] = [{ pieces: fullFurnitureSet(kind, areaM2, brief), changes: [] }];
    const moves = kind === "kitchen-living" ? LADDERS.living : LADDERS[kind];
    for (const move of moves) {
        // A piece left out one at a time may take several rungs, e.g. two bedside tables.
        for (;;) {
            const previous = steps[steps.length - 1];
            const next = applyMove(previous.pieces, move);
            if (!next) break;
            steps.push({ pieces: next.pieces, changes: [...previous.changes, ...next.changes] });
            if (move.kind !== "less") break;
            if (!next.pieces.some((item) => item.definitionId === move.definitionId)) break;
        }
    }
    return steps;
};

/** Solver input: the first piece is required, the rest may give way. */
export const selectionInstances = (pieces: SelectedPiece[]): FurnitureInstance[] => {
    const selection: FurnitureSelection = Object.fromEntries(
        pieces.map((item, index) => [
            item.definitionId,
            {
                count: item.count,
                required: index === 0,
                priority: index === 0 ? "required" : "preferred",
            },
        ]),
    );
    const sizes = new Map(pieces.map((item) => [item.definitionId, item.size]));
    return buildFurnitureInstances(selection).map((instance) => {
        const size = sizes.get(instance.definitionId);
        return size ? { ...instance, ...size } : instance;
    });
};

export interface FurnishResult {
    /** Furnished: some rung fits in full. Partial: even the last rung does not. */
    status: "furnished" | "partial";
    step: SelectionStep;
    /** Index of the rung used; 0 is the full set. */
    rung: number;
    variants: LayoutVariant[];
    /** The plan shown first. */
    placements: Placement[];
    /** Pieces of the last rung that found no spot, for a partial result. */
    unplaced: FurnitureInstance[];
    /** A kitchen-living room's reserved kitchen, or null when no wall can take it. */
    kitchenZone?: KitchenZone | null;
}

/** The kitchen of a kitchen-living room: a run of units and the space to work at it. */
export interface KitchenZone {
    segmentId: string;
    wall: Wall;
    /** The units: 600 mm deep along the wall. */
    run: Rect;
    /** Kept clear in front of the units. */
    passage: Rect;
}

export const KITCHEN_RUN_DEPTH_MM = 600;
export const KITCHEN_PASSAGE_DEPTH_MM = 1200;
export const KITCHEN_RUN_MIN_MM = 1800;
export const KITCHEN_RUN_MAX_MM = 3000;
/**
 * Kitchen walls tried with the full set. Chosen on the benchmark: six let all
 * 49 kitchen-living rooms keep the full set, four leave one to give way.
 */
const KITCHEN_ZONE_TRIALS = 6;

const rectArea = (rect: Rect) => rect.width * rect.depth;

/**
 * Where a straight kitchen run can stand: along a wall, clear of doors,
 * windows, radiators and partitions, with its working space inside the room.
 * Corners come first, then walls without a window.
 */
export const kitchenZoneCandidates = (room: Room): KitchenZone[] => {
    const obstacles = [
        ...room.doors.flatMap((door) => getDoorFurnitureObstacles(door, room)),
        ...room.windows.map((window) => getWindowCurtainObstacle(window, room)),
        ...(room.radiators ?? []).flatMap((radiator) => [
            getRadiatorBody(radiator, room),
            getRadiatorServiceObstacle(radiator, room),
        ]),
        ...getPartitionObstacleRects(room),
        ...(room.fixedFurniture?.bodies ?? []),
    ];
    const zones: { zone: KitchenZone; corner: boolean; length: number }[] = [];
    for (const segment of getRoomBoundarySegments(room)) {
        if (segment.length < KITCHEN_RUN_MIN_MM) continue;
        const length = Math.min(KITCHEN_RUN_MAX_MM, segment.length);
        const offsets = Array.from(
            new Set([
                0,
                segment.length - length,
                ...[1, 2, 3].map(
                    (part) => Math.round(((segment.length - length) * part) / 4 / 50) * 50,
                ),
            ]),
        );
        for (const offset of offsets) {
            const run = getSegmentSpanRect(segment, offset, length, 0, KITCHEN_RUN_DEPTH_MM);
            const passage = getSegmentSpanRect(
                segment,
                offset,
                length,
                KITCHEN_RUN_DEPTH_MM,
                KITCHEN_PASSAGE_DEPTH_MM,
            );
            if (!rectInsideRoomGeometry(run, room) || !rectInsideRoomGeometry(passage, room))
                continue;
            if (
                obstacles.some(
                    (obstacle) =>
                        rectsIntersect(obstacle, run) || rectsIntersect(obstacle, passage),
                )
            )
                continue;
            zones.push({
                zone: { segmentId: segment.id, wall: segment.wall, run, passage },
                corner: offset === 0 || offset === segment.length - length,
                length: segment.length,
            });
        }
    }
    // Corners keep the rest of the room in one piece; a short wall leaves the
    // long ones for the sofa and the TV.
    return zones
        .sort(
            (first, second) =>
                Number(second.corner) - Number(first.corner) || first.length - second.length,
        )
        .map(({ zone }) => zone);
};

/** The room with its kitchen held in place: the living part is furnished around it. */
export const withKitchenZone = (room: Room, zone: KitchenZone): Room => ({
    ...room,
    fixedFurniture: {
        bodies: [...(room.fixedFurniture?.bodies ?? []), zone.run],
        passages: [...(room.fixedFurniture?.passages ?? []), zone.passage],
    },
});

const preferencesFor = (kind: FurnishableRoomKind): LayoutPreferences =>
    kind === "living" || kind === "kitchen-living" ? { tvTargetCategory: "living" } : {};

/**
 * Picks the set for an empty room and lays it out: the first rung that fits in
 * full wins. A rung whose main piece cannot stand alone is skipped without a
 * full search, so hopeless rungs cost milliseconds. A kitchen-living room first
 * reserves its kitchen, trying a few walls and keeping the one that leaves the
 * living part best furnished.
 */
export const furnishRoom = (
    room: Room,
    kind: FurnishableRoomKind,
    brief: RoomBrief = {},
): FurnishResult => {
    if (kind !== "kitchen-living") return furnishWithin(room, kind, getRoomArea(room), brief);

    const zones = kitchenZoneCandidates(room).slice(0, KITCHEN_ZONE_TRIALS);
    if (zones.length === 0)
        return { ...furnishWithin(room, kind, getRoomArea(room), brief), kitchenZone: null };
    const furnishAround = (zone: KitchenZone, lastRung?: number): FurnishResult => ({
        ...furnishWithin(
            withKitchenZone(room, zone),
            kind,
            getRoomArea(room) - rectArea(zone.run) - rectArea(zone.passage),
            brief,
            lastRung,
        ),
        kitchenZone: zone,
    });
    // Each wall gets one try with the full set; only if none holds it does the
    // first wall walk the whole ladder. Walking it on every wall is what is slow.
    for (const zone of zones) {
        const full = furnishAround(zone, 0);
        if (full.status === "furnished") return full;
    }
    return furnishAround(zones[0]);
};

const furnishWithin = (
    room: Room,
    kind: FurnishableRoomKind,
    areaMm2: number,
    brief: RoomBrief,
    /** Stop after this rung, without the partial fallback. */
    lastRung?: number,
): FurnishResult => {
    const fullLadder = selectionLadder(kind, areaMm2 / 1_000_000, brief);
    const ladder = lastRung === undefined ? fullLadder : fullLadder.slice(0, lastRung + 1);
    const preferences = preferencesFor(kind);
    const mainFits = new Map<string, boolean>();

    for (let rung = 0; rung < ladder.length; rung += 1) {
        const step = ladder[rung];
        const instances = selectionInstances(step.pieces);
        const main = instances.find((instance) => instance.priority === "required");
        if (main) {
            const key = `${main.definitionId}:${main.width ?? ""}x${main.depth ?? ""}`;
            if (!mainFits.has(key)) {
                mainFits.set(key, solveRoom(room, [main], preferences).status === "success");
            }
            if (!mainFits.get(key)) continue;
        }
        const result = solveRoomFromMainPiece(room, instances, preferences, 3);
        if (result.status === "success") {
            return {
                status: "furnished",
                step,
                rung,
                variants: result.variants,
                placements: result.variants[0].placements,
                unplaced: [],
            };
        }
    }

    // Nothing fits in full: show what the most modest rung can place, and name the rest.
    const rung = ladder.length - 1;
    const step = ladder[rung];
    const instances = selectionInstances(step.pieces);
    // A trial of a few rungs only: the caller walks the ladder elsewhere.
    if (lastRung !== undefined) {
        return { status: "partial", step, rung, variants: [], placements: [], unplaced: instances };
    }
    const fallback = solveWithPreferredPlacementFallback(room, instances, preferences);
    const placements = fallback.result.placements;
    return {
        status: "partial",
        step,
        rung,
        variants: [],
        placements,
        // The fallback names nothing when it places nothing: every piece is then left.
        unplaced: instances.filter(
            (instance) =>
                !placements.some((placement) => placement.instanceId === instance.instanceId),
        ),
    };
};
