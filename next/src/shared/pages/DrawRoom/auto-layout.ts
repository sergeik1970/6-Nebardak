import {
    arrangeKitchen,
    buildFurnitureInstances,
    getDoorFurnitureObstacles,
    getFurniture,
    getRoomBoundarySegments,
    getRoomSegment,
    getRotatedGeometry,
    isKitchenFloorUnit,
    isKitchenRunUnit,
    kitchenFixedFurniture,
    validateRoomGeometry,
    type DoorOpening,
    type DrawRoomRegion,
    type FurnitureInstance,
    type FurniturePriority,
    type FurnitureSelection,
    type LayoutSuccess,
    type Placement,
    type PreferredPlacementFallbackResult,
    type RadiatorObstacle,
    type Rect,
    type Room,
    type RoomBoundarySegment,
    type WindowOpening,
} from "@/shared/lib/furniture-planner";
import { placedDefinition, type DrawFurniture } from "./furniture";

type Point = { x: number; y: number };

/** The solver's lattice: a sub-room is cut on whole 50 mm steps. */
const SOLVER_GRID_MM = 50;

/**
 * What «Авторасстановка» arranges: the pieces already standing in the room,
 * counted by kind, the largest first. Upper units hang over the worktop and
 * stay where they are, unless the room is laid out as a kitchen (`withUpper`).
 */
export const roomFurnitureSet = (
    pieces: readonly DrawFurniture[],
    withUpper = false,
): Record<string, number> => {
    const area = (id: string) => {
        const geometry = getRotatedGeometry(getFurniture(id), 0);
        return geometry.width * geometry.depth;
    };
    const set: Record<string, number> = {};
    for (const piece of pieces)
        if (withUpper || getFurniture(piece.definitionId).mounting !== "upper")
            set[piece.definitionId] = (set[piece.definitionId] ?? 0) + 1;
    return Object.fromEntries(
        Object.entries(set).sort(([first], [second]) => area(second) - area(first)),
    );
};

/**
 * Pieces that stay where they stand, in the solver room's frame: their
 * bodies are obstacles and their own passages stay free.
 */
export const solverFixedFurniture = (
    pieces: readonly DrawFurniture[],
    offset: Point,
): NonNullable<Room["fixedFurniture"]> => {
    const floor = pieces.filter((item) => getFurniture(item.definitionId).mounting !== "upper");
    const local = (rect: Rect, item: DrawFurniture): Rect => ({
        x: rect.x + item.x - offset.x,
        y: rect.y + item.y - offset.y,
        width: rect.width,
        depth: rect.depth,
    });
    // A mirrored corner sofa keeps its chaise on the side the person put it.
    const geometry = (item: DrawFurniture) =>
        getRotatedGeometry(placedDefinition(item), item.rotation, item);
    return {
        bodies: floor.flatMap((item) => geometry(item).bodyRects.map((rect) => local(rect, item))),
        passages: floor.flatMap((item) =>
            geometry(item).hardClearanceRects.map((rect) => local(rect, item)),
        ),
    };
};

/** The solver room with more pieces held in place. */
export const withFixedFurniture = (room: Room, extra: NonNullable<Room["fixedFurniture"]>): Room =>
    extra.bodies.length
        ? {
              ...room,
              fixedFurniture: {
                  bodies: [...(room.fixedFurniture?.bodies ?? []), ...extra.bodies],
                  passages: [...(room.fixedFurniture?.passages ?? []), ...extra.passages],
              },
          }
        : room;

/** Why the solver may find no spot for a piece, in the catalogue's own rules. */
export const placementRules = (definitionId: string): string[] => {
    const definition = getFurniture(definitionId);
    const { placement } = definition;
    const geometry = getRotatedGeometry(definition, 0);
    const front = Math.max(
        0,
        ...geometry.hardClearanceRects
            .filter((zone) => zone.y >= geometry.depth - 1)
            .map((zone) => zone.depth),
    );
    const backOnly =
        placement.allowedWallContactEdges.length === 1 &&
        placement.allowedWallContactEdges[0] === "back";
    return [
        ...(placement.requiredWallContact
            ? [backOnly ? "спиной к стене" : "вплотную к стене"]
            : !placement.centerAllowed
              ? ["у стены"]
              : []),
        ...(front ? [`${Math.round(front)} мм спереди`] : []),
        ...(placement.windowPolicy === "forbidden" ? ["не у окна"] : []),
    ];
};

/** One fallback solve: what it placed and what it could not. */
export type FallbackSolve = (
    room: Room,
    instances: FurnitureInstance[],
) => Promise<PreferredPlacementFallbackResult | null>;

/**
 * Solves what fits; then, if something found no spot, leaves those pieces
 * where the person put them and arranges the rest around them. The second
 * pass is taken only when it places all the rest.
 */
export async function arrangeAroundLeftovers(
    room: Room,
    instances: FurnitureInstance[],
    standingFor: (unplacedIds: string[]) => NonNullable<Room["fixedFurniture"]>,
    solve: FallbackSolve,
): Promise<{ core: LayoutSuccess; unplaced: FurnitureInstance[]; around: boolean } | null> {
    const first = await solve(room, instances);
    if (!first || first.result.status !== "success") return null;
    const unplaced = first.unplacedInstances;
    const rest = instances.filter(
        (instance) => !unplaced.some((item) => item.instanceId === instance.instanceId),
    );
    if (unplaced.length && rest.length) {
        const ids = unplaced.map((item) => item.instanceId);
        const second = await solve(withFixedFurniture(room, standingFor(ids)), rest);
        if (second?.result.status === "success" && second.unplacedInstances.length === 0)
            return { core: second.result, unplaced, around: true };
    }
    return { core: first.result, unplaced, around: false };
}

/** The first piece of a set is what the room is for; the rest may give way. */
export const buildRoomInstances = (set: Record<string, number>): FurnitureInstance[] => {
    const ids = Object.keys(set).filter((id) => set[id] > 0);
    const selection: FurnitureSelection = Object.fromEntries(
        ids.map((id, index) => {
            const priority: FurniturePriority = index === 0 ? "required" : "preferred";
            return [id, { count: set[id], required: index === 0, priority }];
        }),
    );
    return buildFurnitureInstances(selection);
};

export type RegionSolverRoom =
    | { status: "ready"; room: Room; origin: Point }
    | { status: "unsupported"; message: string };

const roundInward = (value: number, inward: number) =>
    inward > 0
        ? Math.ceil(value / SOLVER_GRID_MM) * SOLVER_GRID_MM
        : Math.floor(value / SOLVER_GRID_MM) * SOLVER_GRID_MM;

/**
 * The region's clear outline as a clockwise polygon, each face pulled inward
 * onto the 50 mm lattice so no solved piece can reach into wall material.
 */
const regionOutline = (region: Pick<DrawRoomRegion, "clearEdges">): Point[] | null => {
    const edges = region.clearEdges.map((edge) => {
        // Clockwise in screen axes: the inward normal is the direction turned right.
        const direction = { x: edge.inward.y, y: -edge.inward.x };
        const forward =
            (edge.end.x - edge.start.x) * direction.x + (edge.end.y - edge.start.y) * direction.y >
            0;
        return {
            start: forward ? edge.start : edge.end,
            end: forward ? edge.end : edge.start,
            inward: edge.inward,
        };
    });
    if (edges.length < 4) return null;
    const ordered = [edges[0]];
    while (ordered.length < edges.length) {
        const last = ordered[ordered.length - 1];
        const next = edges.find(
            (edge) => edge.start.x === last.end.x && edge.start.y === last.end.y,
        );
        if (!next || next === ordered[0]) return null;
        ordered.push(next);
    }
    const last = ordered[ordered.length - 1];
    if (last.end.x !== ordered[0].start.x || last.end.y !== ordered[0].start.y) return null;
    const lines = ordered.map((edge) =>
        edge.start.y === edge.end.y
            ? { horizontal: true, value: roundInward(edge.start.y, edge.inward.y) }
            : { horizontal: false, value: roundInward(edge.start.x, edge.inward.x) },
    );
    return ordered.map((_, index) => {
        const previous = lines[(index - 1 + lines.length) % lines.length];
        const current = lines[index];
        return current.horizontal
            ? { x: previous.value, y: current.value }
            : { x: current.value, y: previous.value };
    });
};

interface WallItem {
    wall: Room["doors"][number]["wall"];
    segmentId?: string;
    partitionId?: string;
    offset: number;
    width: number;
}

/** Where a wall item lies: its line, its span along that line and the travel sign. */
const itemPlacement = (room: Room, item: WallItem) => {
    const segment = getRoomSegment(room, item);
    if (!segment) return null;
    const horizontal = segment.orientation === "horizontal";
    const sign = horizontal
        ? Math.sign(segment.end.x - segment.start.x)
        : Math.sign(segment.end.y - segment.start.y);
    const startAxis = horizontal ? segment.start.x : segment.start.y;
    const a = startAxis + sign * item.offset;
    const b = a + sign * item.width;
    return {
        horizontal,
        line: horizontal ? segment.start.y : segment.start.x,
        from: Math.min(a, b),
        to: Math.max(a, b),
        sign,
    };
};

/** The sub-room wall a building item stands on, and its offset along it. */
const mapOntoSubRoom = (
    placement: NonNullable<ReturnType<typeof itemPlacement>>,
    segments: RoomBoundarySegment[],
    origin: Point,
    tolerance: number,
) => {
    for (const segment of segments) {
        const horizontal = segment.orientation === "horizontal";
        if (horizontal !== placement.horizontal) continue;
        const line =
            (horizontal ? segment.start.y : segment.start.x) + (horizontal ? origin.y : origin.x);
        if (Math.abs(line - placement.line) > tolerance) continue;
        const shift = horizontal ? origin.x : origin.y;
        const startAxis = (horizontal ? segment.start.x : segment.start.y) + shift;
        const endAxis = (horizontal ? segment.end.x : segment.end.y) + shift;
        if (
            placement.from < Math.min(startAxis, endAxis) ||
            placement.to > Math.max(startAxis, endAxis)
        )
            continue;
        const sign = Math.sign(endAxis - startAxis);
        const offset = sign > 0 ? placement.from - startAxis : startAxis - placement.to;
        return { segment, offset, reversed: sign !== placement.sign };
    }
    return null;
};

const flip = <T extends "start" | "end">(value: T | undefined, reversed: boolean) =>
    value && reversed ? ((value === "start" ? "end" : "start") as T) : value;

const rectsTouch = (
    first: Rect,
    second: { left: number; top: number; right: number; bottom: number },
) =>
    first.x < second.right &&
    first.x + first.width > second.left &&
    first.y < second.bottom &&
    first.y + first.depth > second.top;

/**
 * Cuts one room of the drawn apartment out as a planner room: its outline on
 * the 50 mm lattice, and the doors, windows and radiators of its own walls.
 * A partition door joins as a door of this room's wall; it opens into the
 * room when its leaf or approach reaches the room. The solved pieces are
 * checked again against the whole apartment, so these are only inputs.
 */
export const buildRegionSolverRoom = (
    building: Room,
    region: Pick<DrawRoomRegion, "clearEdges" | "clearRects">,
): RegionSolverRoom => {
    const outline = regionOutline(region);
    if (!outline)
        return {
            status: "unsupported",
            message: "Подбор пока работает для комнат без выступов внутри.",
        };
    const minX = Math.min(...outline.map((point) => point.x));
    const minY = Math.min(...outline.map((point) => point.y));
    const origin = { x: minX, y: minY };
    const vertices = outline.map((point, index) => ({
        id: `v${index + 1}`,
        x: point.x - minX,
        y: point.y - minY,
    }));
    const shell: Room = {
        width: Math.max(...vertices.map((vertex) => vertex.x)),
        depth: Math.max(...vertices.map((vertex) => vertex.y)),
        // A rectangle is the planner's plain room; any other outline is orthogonal.
        ...(vertices.length === 4
            ? {}
            : { geometry: { version: 1 as const, kind: "orthogonal" as const, vertices } }),
        doors: [],
        windows: [],
        radiators: [],
        partitions: [],
        ...(building.wallThickness ? { wallThickness: building.wallThickness } : {}),
    };
    const shapeError = validateRoomGeometry(shell);
    if (shapeError)
        return {
            status: "unsupported",
            message:
                shell.width < 2400 || shell.depth < 2400
                    ? "Подбор работает для комнат от 2,4 × 2,4 м. Эту комнату обставьте вручную."
                    : "Подбор пока работает для прямоугольных и простых Г-образных комнат.",
        };
    const segments = getRoomBoundarySegments(shell);
    const partitionHalf = (id?: string) =>
        (building.partitions?.find((partition) => partition.id === id)?.thickness ?? 0) / 2;

    const doors: DoorOpening[] = building.doors.flatMap((door) => {
        const placement = itemPlacement(building, door);
        const tolerance = partitionHalf(door.partitionId) + SOLVER_GRID_MM;
        const mapped = placement && mapOntoSubRoom(placement, segments, origin, tolerance);
        if (!mapped) return [];
        const {
            partitionId: _partitionId,
            segmentId: _segmentId,
            drawingHostId: _drawingHostId,
            ...fields
        } = door;
        const swingsIn =
            !door.partitionId ||
            getDoorFurnitureObstacles(door, building).some((rect) =>
                region.clearRects.some((cell) => rectsTouch(rect, cell)),
            );
        return [
            {
                ...fields,
                wall: mapped.segment.wall,
                segmentId: mapped.segment.id,
                offset: mapped.offset,
                hinge: flip(door.hinge, mapped.reversed),
                slidingDirection: flip(door.slidingDirection, mapped.reversed),
                ...(door.partitionId ? { swingDirection: swingsIn ? "inward" : "outward" } : {}),
            } as DoorOpening,
        ];
    });
    const onOwnWalls = <T extends WindowOpening | RadiatorObstacle>(item: T): T[] => {
        const placement = itemPlacement(building, item);
        const mapped = placement && mapOntoSubRoom(placement, segments, origin, SOLVER_GRID_MM);
        if (!mapped) return [];
        const { segmentId: _segmentId, drawingHostId: _drawingHostId, ...fields } = item;
        return [
            {
                ...fields,
                wall: mapped.segment.wall,
                segmentId: mapped.segment.id,
                offset: mapped.offset,
            } as T,
        ];
    };
    const room: Room = {
        ...shell,
        doors,
        windows: building.windows.flatMap(onOwnWalls),
        radiators: (building.radiators ?? []).flatMap(onOwnWalls),
    };
    // An item the shrunken walls no longer fit is left to the apartment check.
    const fitted = validateRoomGeometry(room) ? { ...room, radiators: [] } : room;
    return validateRoomGeometry(fitted)
        ? {
              status: "unsupported",
              message: "Двери или окна этой комнаты не удалось перенести в подбор.",
          }
        : { status: "ready", room: fitted, origin };
};

/** Solved pieces in apartment coordinates, as ordinary drawing furniture. */
export const solvedToDrawFurniture = (
    placements: Placement[],
    offset: Point,
    idPrefix: string,
): DrawFurniture[] =>
    placements.map((placement, index) => {
        const base = getRotatedGeometry(getFurniture(placement.definitionId), 0);
        return {
            id: `${idPrefix}-${index + 1}`,
            definitionId: placement.definitionId,
            x: placement.x + offset.x,
            y: placement.y + offset.y,
            width: placement.width ?? base.width,
            depth: placement.depth ?? base.depth,
            rotation: placement.rotation,
            ...(placement.photoId ? { photoId: placement.photoId } : {}),
        };
    });

/** With a floor unit of a kitchen in the room, the room is laid out as a kitchen. */
export const hasKitchenRun = (pieces: readonly DrawFurniture[]): boolean =>
    pieces.some((piece) => isKitchenFloorUnit(piece.definitionId));

export interface KitchenVariant {
    label: string;
    /** In the solver room's frame: the kitchen, then the rest of the room. */
    placements: Placement[];
    /** Pieces with no place in this variant; they stay where they stand. */
    leftover: DrawFurniture[];
    score: number;
}

/**
 * A kitchen room: the worktop run is laid by the kitchen rules, then the
 * rest of the room (a table, chairs, an island) is solved around it.
 */
export async function solveKitchenVariants(
    room: Room,
    pieces: readonly DrawFurniture[],
    solveRest: FallbackSolve,
    limit = 3,
): Promise<KitchenVariant[]> {
    const kitchen = pieces.filter((piece) => isKitchenRunUnit(piece.definitionId));
    const rest = pieces.filter((piece) => !isKitchenRunUnit(piece.definitionId));
    const layouts = arrangeKitchen(
        room,
        kitchen.map((piece) => ({ instanceId: piece.id, definitionId: piece.definitionId })),
        limit,
    );
    const variants: KitchenVariant[] = [];
    for (const layout of layouts) {
        const left = kitchen.filter((piece) => layout.unplacedInstanceIds.includes(piece.id));
        let around: Placement[] = [];
        let restLeft = [...rest];
        if (rest.length) {
            const instances = buildRoomInstances(roomFurnitureSet(rest));
            const solved = await solveRest(
                withFixedFurniture(room, kitchenFixedFurniture(layout.placements)),
                instances,
            );
            if (solved?.result.status === "success") {
                around = solved.result.placements;
                // The pieces standing for what found no spot, one per instance.
                const remaining = [...rest];
                restLeft = solved.unplacedInstances.flatMap((instance) => {
                    const index = remaining.findIndex(
                        (piece) => piece.definitionId === instance.definitionId,
                    );
                    return index === -1 ? [] : remaining.splice(index, 1);
                });
            }
        }
        variants.push({
            label: layout.label,
            placements: [...layout.placements, ...around],
            leftover: [...left, ...restLeft],
            score: layout.score,
        });
    }
    return variants;
}
