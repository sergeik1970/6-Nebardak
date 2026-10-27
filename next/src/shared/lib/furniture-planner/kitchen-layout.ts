import { getFurniture } from "./catalog";
import {
    getDoorFurnitureObstacles,
    getFixedFurnitureBodies,
    getPartitionObstacleRects,
    getRadiatorBody,
    getRadiatorServiceObstacle,
} from "./geometry";
import {
    expandRect,
    getRotatedGeometry,
    getWorldBodyRects,
    getWorldHardClearanceRects,
    rectsIntersect,
} from "./geometry-shapes";
import {
    getRoomBoundarySegments,
    getRoomSegment,
    getSegmentSpanRect,
    rectInsideRoomGeometry,
} from "./room-geometry";
import type { Placement, Rect, Room, RoomBoundarySegment, Rotation } from "./types";

/**
 * Kitchen units do not go through the general solver: a kitchen is one
 * continuous worktop, along one wall or two walls meeting in a corner, with
 * the units side by side. This module builds such runs from the units the
 * person put in the room and ranks them by the usual kitchen rules.
 */

type KitchenRole =
    | "base"
    | "sink"
    | "cooker"
    | "dishwasher"
    | "washer"
    | "fridge"
    | "tall"
    | "upper"
    | "hood";

const KITCHEN_ROLES: Record<string, KitchenRole> = {
    "kitchen-base-600": "base",
    "kitchen-base-400": "base",
    "kitchen-sink": "sink",
    "kitchen-cooker": "cooker",
    "kitchen-dishwasher": "dishwasher",
    "kitchen-washer": "washer",
    "kitchen-fridge": "fridge",
    "kitchen-fridge-wide": "fridge",
    "kitchen-tall": "tall",
    "kitchen-upper-600": "upper",
    "kitchen-upper-400": "upper",
    "kitchen-hood": "hood",
};

/** A unit that belongs to the worktop run or hangs over it; an island does not. */
export const isKitchenRunUnit = (definitionId: string): boolean => definitionId in KITCHEN_ROLES;

/** A floor unit of the worktop run: with one in the room, the room is laid out as a kitchen. */
export const isKitchenFloorUnit = (definitionId: string): boolean =>
    isKitchenRunUnit(definitionId) && getFurniture(definitionId).mounting !== "upper";

/** A laid kitchen as obstacles for the rest of the room: floor bodies and their worktop zones. */
export const kitchenFixedFurniture = (
    placements: readonly Placement[],
): NonNullable<Room["fixedFurniture"]> => {
    const floor = placements.filter((placement) => isKitchenFloorUnit(placement.definitionId));
    return {
        bodies: floor.flatMap(getWorldBodyRects),
        passages: floor.flatMap(getWorldHardClearanceRects),
    };
};

export interface KitchenPiece {
    instanceId: string;
    definitionId: string;
}

export interface KitchenLayout {
    shape: "linear" | "corner";
    label: string;
    /** Floor units first, then upper units and the hood. */
    placements: Placement[];
    /** Units with no place in this layout; they stay where the person put them. */
    unplacedInstanceIds: string[];
    /** Lower is better. */
    score: number;
}

interface Unit {
    piece: KitchenPiece;
    role: KitchenRole;
    /** Along the wall. */
    width: number;
    /** Out from the wall. */
    depth: number;
}

const unitOf = (piece: KitchenPiece): Unit => {
    const geometry = getRotatedGeometry(getFurniture(piece.definitionId), 0);
    return {
        piece,
        role: KITCHEN_ROLES[piece.definitionId],
        width: geometry.width,
        depth: geometry.depth,
    };
};

const isTall = (unit: Unit) => unit.role === "fridge" || unit.role === "tall";
const isUpper = (unit: Unit) => unit.role === "upper" || unit.role === "hood";

/** The turn that puts a unit's back to a wall with this inward normal. */
const rotationFor = (segment: RoomBoundarySegment): Rotation =>
    segment.inwardNormal.y === 1
        ? 0
        : segment.inwardNormal.x === -1
          ? 90
          : segment.inwardNormal.y === -1
            ? 180
            : 270;

/** Worktop orders: the sink with its machines, the cooker and the plain units. */
const worktopOrders = (units: Unit[]): Unit[][] => {
    const [sink, ...extraSinks] = units.filter((unit) => unit.role === "sink");
    const [cooker, ...extraCookers] = units.filter((unit) => unit.role === "cooker");
    const machines = units.filter((unit) => unit.role === "dishwasher" || unit.role === "washer");
    const fillers = [
        ...units.filter((unit) => unit.role === "base").sort((a, b) => b.width - a.width),
        ...extraSinks,
        ...extraCookers,
        // Without a sink the machines simply stand in the run.
        ...(sink ? [] : machines),
    ];
    const permutations = <T>(items: T[]): T[][] =>
        items.length <= 1
            ? [items]
            : items.flatMap((item, index) =>
                  permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
                      (rest) => [item, ...rest],
                  ),
              );
    const wetBlocks = sink ? permutations([sink, ...machines]) : [[]];
    const blockCount = fillers.length + (sink ? 1 : 0) + (cooker ? 1 : 0);
    const orders: Unit[][] = [];
    const seen = new Set<string>();
    for (const wet of wetBlocks)
        for (let wetAt = 0; wetAt < (sink ? blockCount : 1); wetAt += 1)
            for (let cookerAt = 0; cookerAt < (cooker ? blockCount : 1); cookerAt += 1) {
                if (sink && cooker && wetAt === cookerAt) continue;
                const queue = [...fillers];
                const order: Unit[] = [];
                for (let at = 0; at < blockCount; at += 1) {
                    if (sink && at === wetAt) order.push(...wet);
                    else if (cooker && at === cookerAt) order.push(cooker);
                    else order.push(queue.shift()!);
                }
                const key = order.map((unit) => unit.piece.definitionId).join(",");
                if (seen.has(key)) continue;
                seen.add(key);
                orders.push(order);
            }
    return orders;
};

/** Tall units stand only at the ends of the run, a fridge nearest the worktop. */
const tallEnds = (units: Unit[]): [Unit[], Unit[]][] => {
    const fridges = units.filter((unit) => unit.role === "fridge");
    const others = units.filter((unit) => unit.role === "tall");
    if (!units.length) return [[[], []]];
    const ends: [Unit[], Unit[]][] = [
        [[...others, ...fridges], []],
        [[], [...fridges, ...others]],
    ];
    if (fridges.length && others.length)
        ends.push([others, fridges], [fridges.slice().reverse(), others]);
    return ends;
};

const sequences = (floor: Unit[]): Unit[][] => {
    const talls = floor.filter(isTall);
    const worktop = floor.filter((unit) => !isTall(unit));
    return tallEnds(talls).flatMap(([start, end]) =>
        worktopOrders(worktop).map((order) => [...start, ...order, ...end]),
    );
};

interface Leg {
    segment: RoomBoundarySegment;
    /** Where the first unit begins, as an offset along the segment. */
    start: number;
    /** The units follow the segment's direction (1) or go against it (-1). */
    direction: 1 | -1;
    units: Unit[];
}

interface Laid {
    unit: Unit;
    segment: RoomBoundarySegment;
    /** Span along the segment. */
    from: number;
    to: number;
    /** Distance along the whole run, through the corner. */
    runFrom: number;
    runTo: number;
    placement: Placement;
    body: Rect;
}

const lay = (legs: Leg[], cornerGap: number): Laid[] => {
    const laid: Laid[] = [];
    let run = 0;
    legs.forEach((leg, legIndex) => {
        if (legIndex > 0) run += cornerGap;
        let along = leg.start;
        for (const unit of leg.units) {
            const from = leg.direction === 1 ? along : along - unit.width;
            const body = getSegmentSpanRect(leg.segment, from, unit.width, 0, unit.depth);
            laid.push({
                unit,
                segment: leg.segment,
                from,
                to: from + unit.width,
                runFrom: run,
                runTo: run + unit.width,
                placement: {
                    instanceId: unit.piece.instanceId,
                    definitionId: unit.piece.definitionId,
                    x: body.x,
                    y: body.y,
                    rotation: rotationFor(leg.segment),
                },
                body,
            });
            along += leg.direction * unit.width;
            run += unit.width;
        }
    });
    return laid;
};

const spansOverlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

interface RoomFacts {
    room: Room;
    obstacles: Rect[];
    zoneObstacles: Rect[];
    doorZones: Rect[];
    windows: { segmentId: string; from: number; to: number; panoramic: boolean }[];
}

const roomFacts = (room: Room): RoomFacts => {
    const doors = room.doors.flatMap((door) => getDoorFurnitureObstacles(door, room));
    const radiators = (room.radiators ?? []).flatMap((radiator) => [
        getRadiatorBody(radiator, room),
        getRadiatorServiceObstacle(radiator, room),
    ]);
    const partitions = getPartitionObstacleRects(room);
    const fixedBodies = getFixedFurnitureBodies(room);
    return {
        room,
        obstacles: [
            ...doors,
            ...radiators,
            ...partitions,
            ...fixedBodies,
            ...(room.fixedFurniture?.passages ?? []),
        ],
        zoneObstacles: [...partitions, ...fixedBodies],
        doorZones: doors,
        windows: room.windows.flatMap((window) => {
            const segment = getRoomSegment(room, window);
            if (!segment || !Number.isFinite(window.offset) || !Number.isFinite(window.width))
                return [];
            return [
                {
                    segmentId: segment.id,
                    from: window.offset,
                    to: window.offset + window.width,
                    panoramic: window.windowKind === "floor-to-ceiling",
                },
            ];
        }),
    };
};

const underWindow = (facts: RoomFacts, item: Pick<Laid, "segment" | "from" | "to">) =>
    facts.windows.filter(
        (window) =>
            window.segmentId === item.segment.id &&
            spansOverlap(item.from, item.to, window.from, window.to),
    );

/** Hard rules: the run stands inside the room, clear of doors and pinned pieces. */
const fits = (facts: RoomFacts, laid: Laid[]): boolean =>
    laid.every((item) => {
        if (!rectInsideRoomGeometry(item.body, facts.room)) return false;
        if (facts.obstacles.some((rect) => rectsIntersect(item.body, rect))) return false;
        const windows = underWindow(facts, item);
        if (windows.some((window) => window.panoramic)) return false;
        if (isTall(item.unit) && windows.length) return false;
        return getWorldHardClearanceRects(item.placement).every(
            (zone) =>
                rectInsideRoomGeometry(zone, facts.room) &&
                !facts.zoneObstacles.some((rect) => rectsIntersect(zone, rect)) &&
                // A deeper neighbour (a fridge) may stand a few centimetres into a zone.
                !laid.some(
                    (other) => other !== item && rectsIntersect(expandRect(zone, -100), other.body),
                ),
        );
    });

/** Soft rules, as a designer would rank a kitchen; lower is better. */
const score = (facts: RoomFacts, laid: Laid[], shape: KitchenLayout["shape"]): number => {
    let total = shape === "corner" ? 15 : 0;
    const find = (role: KitchenRole) => laid.find((item) => item.unit.role === role);
    const index = (item: Laid) => laid.indexOf(item);
    const neighbours = (item: Laid) =>
        [laid[index(item) - 1], laid[index(item) + 1]].filter(
            (other) => other && other.segment === item.segment,
        );
    const gap = (a: Laid, b: Laid) => Math.max(a.runFrom - b.runTo, b.runFrom - a.runTo, 0);
    // A unit beside the empty corner square: its door hits the other leg.
    const byCorner = (item: Laid) =>
        shape === "corner" &&
        neighbours(item).length < 2 &&
        index(item) !== 0 &&
        index(item) !== laid.length - 1;
    const sink = find("sink");
    const cooker = find("cooker");
    if (sink && underWindow(facts, sink).length) total -= 40;
    if (sink && cooker) {
        const between = gap(sink, cooker);
        // Somewhere to chop between washing and cooking, but not across the room.
        if (between === 0) total += 60;
        else if (between > 1200) total += ((between - 1200) / 100) * 3;
    }
    if (cooker) {
        if (index(cooker) === 0 || index(cooker) === laid.length - 1) total += 40;
        if (neighbours(cooker).some((other) => isTall(other.unit))) total += 50;
        if (underWindow(facts, cooker).length) total += 150;
        if (byCorner(cooker)) total += 15;
    }
    for (const machine of laid.filter(
        (item) => item.unit.role === "dishwasher" || item.unit.role === "washer",
    )) {
        if (sink && !neighbours(machine).includes(sink))
            total += machine.unit.role === "dishwasher" ? 40 : 20;
        if (byCorner(machine)) total += 20;
    }
    const fridge = find("fridge");
    if (fridge && sink) {
        const reach = gap(fridge, sink);
        if (reach > 2400) total += ((reach - 2400) / 100) * 2;
    }
    for (const item of laid)
        if (
            getWorldHardClearanceRects(item.placement).some((zone) =>
                facts.doorZones.some((rect) => rectsIntersect(zone, rect)),
            )
        )
            total += 30;
    return total;
};

/** Where along a segment the run could start: in a corner or beside an obstacle. */
const linearStarts = (facts: RoomFacts, segment: RoomBoundarySegment, length: number) => {
    const strip = getSegmentSpanRect(segment, 0, segment.length, 0, 1500);
    const starts = new Set([0, segment.length - length]);
    const tangent = {
        x: (segment.end.x - segment.start.x) / segment.length,
        y: (segment.end.y - segment.start.y) / segment.length,
    };
    for (const rect of facts.obstacles) {
        if (!rectsIntersect(strip, rect)) continue;
        const along = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.depth },
        ].map(
            (point) =>
                (point.x - segment.start.x) * tangent.x + (point.y - segment.start.y) * tangent.y,
        );
        starts.add(Math.max(...along));
        starts.add(Math.min(...along) - length);
    }
    return Array.from(starts).filter((start) => start >= 0 && start + length <= segment.length);
};

const sameCorner = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

interface Candidate {
    shape: KitchenLayout["shape"];
    key: string;
    laid: Laid[];
    score: number;
}

const floorCandidates = (facts: RoomFacts, floor: Unit[]): Candidate[] => {
    const segments = getRoomBoundarySegments(facts.room);
    const orders = sequences(floor);
    const length = floor.reduce((sum, unit) => sum + unit.width, 0);
    const best = new Map<string, Candidate>();
    const offer = (candidate: Omit<Candidate, "score">) => {
        if (!fits(facts, candidate.laid)) return;
        const value = score(facts, candidate.laid, candidate.shape);
        const current = best.get(candidate.key);
        if (!current || value < current.score)
            best.set(candidate.key, { ...candidate, score: value });
    };
    for (const segment of segments) {
        if (segment.length < length) continue;
        for (const start of linearStarts(facts, segment, length))
            for (const order of orders)
                offer({
                    shape: "linear",
                    key: `line:${segment.id}`,
                    laid: lay([{ segment, start, direction: 1, units: order }], 0),
                });
    }
    // A wall's end at the corner, and the direction along it away from the corner.
    const away = (segment: RoomBoundarySegment, corner: { x: number; y: number }) => {
        const atStart = sameCorner(segment.start, corner);
        const sign = atStart ? 1 : -1;
        return {
            atStart,
            x: (sign * (segment.end.x - segment.start.x)) / segment.length,
            y: (sign * (segment.end.y - segment.start.y)) / segment.length,
        };
    };
    for (const first of segments)
        for (const second of segments) {
            if (first === second) continue;
            const corner = [first.start, first.end].find((point) =>
                [second.start, second.end].some((other) => sameCorner(point, other)),
            );
            if (!corner) continue;
            const firstAway = away(first, corner);
            const secondAway = away(second, corner);
            // Only an inside corner; the outer corner of an L-shaped room has no walls to use.
            if (
                first.inwardNormal.x * secondAway.x + first.inwardNormal.y * secondAway.y <= 0 ||
                second.inwardNormal.x * firstAway.x + second.inwardNormal.y * firstAway.y <= 0
            )
                continue;
            for (const order of orders)
                for (let split = 1; split < order.length; split += 1) {
                    // The run comes along the first wall into the corner and leaves along the second.
                    const along = order.slice(0, split);
                    const across = order.slice(split);
                    const alongDepth = along[along.length - 1].depth;
                    const acrossDepth = across[0].depth;
                    const alongLength = along.reduce((sum, unit) => sum + unit.width, 0);
                    const acrossLength = across.reduce((sum, unit) => sum + unit.width, 0);
                    if (
                        acrossDepth + alongLength > first.length ||
                        alongDepth + acrossLength > second.length
                    )
                        continue;
                    offer({
                        shape: "corner",
                        key: `corner:${[first.id, second.id].sort().join(":")}`,
                        laid: lay(
                            [
                                {
                                    segment: first,
                                    // Towards the corner: against "away".
                                    start: firstAway.atStart
                                        ? acrossDepth + alongLength
                                        : first.length - acrossDepth - alongLength,
                                    direction: firstAway.atStart ? -1 : 1,
                                    units: along,
                                },
                                {
                                    segment: second,
                                    start: secondAway.atStart
                                        ? alongDepth
                                        : second.length - alongDepth,
                                    direction: secondAway.atStart ? 1 : -1,
                                    units: across,
                                },
                            ],
                            Math.max(alongDepth, acrossDepth),
                        ),
                    });
                }
        }
    return Array.from(best.values()).sort((a, b) => a.score - b.score);
};

/**
 * Upper units over the worktop: never over a window, a tall unit or the
 * cooker; the hood goes over the cooker. What finds no room is left over.
 */
const hangUppers = (facts: RoomFacts, laid: Laid[], uppers: Unit[]) => {
    const placements: Placement[] = [];
    const placed = new Set<string>();
    const hang = (unit: Unit, segment: RoomBoundarySegment, from: number) => {
        const body = getSegmentSpanRect(segment, from, unit.width, 0, unit.depth);
        if (!rectInsideRoomGeometry(body, facts.room)) return false;
        placements.push({
            instanceId: unit.piece.instanceId,
            definitionId: unit.piece.definitionId,
            x: body.x,
            y: body.y,
            rotation: rotationFor(segment),
        });
        placed.add(unit.piece.instanceId);
        return true;
    };
    const cooker = laid.find((item) => item.unit.role === "cooker");
    const hood = uppers.find((unit) => unit.role === "hood");
    if (hood && cooker)
        hang(hood, cooker.segment, cooker.from + (cooker.unit.width - hood.width) / 2);
    // Free stretches over the worktop, split by windows, tall units and the cooker.
    const stretches: { segment: RoomBoundarySegment; from: number; to: number }[] = [];
    for (const item of laid) {
        if (isTall(item.unit) || item.unit.role === "cooker") continue;
        const windows = underWindow(facts, item);
        let pieces = [{ from: item.from, to: item.to }];
        for (const window of windows)
            pieces = pieces.flatMap((piece) =>
                [
                    { from: piece.from, to: Math.min(piece.to, window.from) },
                    { from: Math.max(piece.from, window.to), to: piece.to },
                ].filter((part) => part.to - part.from > 0),
            );
        for (const piece of pieces) {
            const last = stretches[stretches.length - 1];
            if (last && last.segment === item.segment && Math.abs(last.to - piece.from) < 1)
                last.to = piece.to;
            else stretches.push({ segment: item.segment, ...piece });
        }
    }
    const queue = uppers.filter((unit) => unit.role === "upper").sort((a, b) => b.width - a.width);
    for (const stretch of stretches) {
        let at = stretch.from;
        for (const unit of [...queue]) {
            if (stretch.to - at < unit.width) continue;
            if (hang(unit, stretch.segment, at)) {
                at += unit.width;
                queue.splice(queue.indexOf(unit), 1);
            }
        }
    }
    return { placements, placed };
};

const LABELS: Record<KitchenLayout["shape"], string> = {
    linear: "Кухня вдоль одной стены",
    corner: "Угловая кухня",
};

const labelOf = (facts: RoomFacts, candidate: Candidate) => {
    const sink = candidate.laid.find((item) => item.unit.role === "sink");
    return `${LABELS[candidate.shape]}${sink && underWindow(facts, sink).length ? ", мойка у окна" : ""}`;
};

/**
 * Up to `limit` kitchens for the units, each along a different wall or
 * corner. If the whole set does not fit, plain cabinets are left out one by
 * one, the narrowest first, and stay where they stand.
 */
export function arrangeKitchen(room: Room, pieces: KitchenPiece[], limit = 3): KitchenLayout[] {
    const units = pieces.filter((piece) => isKitchenRunUnit(piece.definitionId)).map(unitOf);
    const floor = units.filter((unit) => !isUpper(unit));
    const uppers = units.filter(isUpper);
    if (!floor.length) return [];
    const facts = roomFacts(room);
    const spare = floor.filter((unit) => unit.role === "base").sort((a, b) => a.width - b.width);
    for (let dropped = 0; dropped <= spare.length; dropped += 1) {
        const left = new Set(spare.slice(0, dropped));
        const kept = floor.filter((unit) => !left.has(unit));
        if (!kept.length) break;
        const candidates = floorCandidates(facts, kept);
        if (!candidates.length) continue;
        return candidates.slice(0, limit).map((candidate) => {
            const hung = hangUppers(facts, candidate.laid, uppers);
            return {
                shape: candidate.shape,
                label: labelOf(facts, candidate),
                placements: [...candidate.laid.map((item) => item.placement), ...hung.placements],
                unplacedInstanceIds: [
                    ...Array.from(left).map((unit) => unit.piece.instanceId),
                    ...uppers
                        .filter((unit) => !hung.placed.has(unit.piece.instanceId))
                        .map((unit) => unit.piece.instanceId),
                ],
                score: candidate.score,
            };
        });
    }
    return [];
}
