import {
    FURNITURE_CATALOG,
    getRotatedGeometry,
    type ClearanceZone,
    type DrawWallSegment,
    type FurnitureDefinition,
    type Rotation,
    type Rect,
    type RoomKind,
} from "@/shared/lib/furniture-planner";
import { getFurniturePhotos } from "@/shared/lib/furniture-planner/furniture-photos";

export interface DrawFurniture {
    id: string;
    definitionId: string;
    x: number;
    y: number;
    width: number;
    depth: number;
    rotation: Rotation;
    photoId?: string;
    locked?: boolean;
    /** Flipped left to right, before rotation: a left-hand corner sofa made right-hand. */
    mirrored?: boolean;
}
export const furnitureDefinition = (id: string) => FURNITURE_CATALOG.find((item) => item.id === id);

const mirroredDefinitions = new Map<string, FurnitureDefinition>();
/** The catalogue piece flipped left to right: body and clearance zones alike. */
const mirroredDefinition = (definition: FurnitureDefinition): FurnitureDefinition => {
    const cached = mirroredDefinitions.get(definition.id);
    if (cached) return cached;
    const { width } = getRotatedGeometry(definition, 0);
    const flip = <T extends Rect>(rect: T): T => ({ ...rect, x: width - rect.x - rect.width });
    const mirrored = {
        ...definition,
        body: { ...definition.body, rects: definition.body.rects.map(flip) },
        clearanceZones: definition.clearanceZones.map(flip),
    };
    mirroredDefinitions.set(definition.id, mirrored);
    return mirrored;
};
/** The catalogue piece as this item stands: flipped when the person mirrored it. */
export const placedDefinition = (item: Pick<DrawFurniture, "definitionId" | "mirrored">) => {
    const definition = furnitureDefinition(item.definitionId)!;
    return item.mirrored ? mirroredDefinition(definition) : definition;
};
export function furnitureGeometry(item: DrawFurniture) {
    const definition = placedDefinition(item);
    const base = getRotatedGeometry(definition, 0);
    return getRotatedGeometry(
        {
            ...definition,
            body: {
                ...definition.body,
                rects: definition.body.rects.map((rect) => ({
                    x: (rect.x * item.width) / base.width,
                    y: (rect.y * item.depth) / base.depth,
                    width: (rect.width * item.width) / base.width,
                    depth: (rect.depth * item.depth) / base.depth,
                })),
            },
        },
        item.rotation,
    );
}
export function readFurniture(value: unknown): DrawFurniture[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value
        .filter((item): item is DrawFurniture => {
            if (
                !item ||
                typeof item.id !== "string" ||
                ids.has(item.id) ||
                !furnitureDefinition(item.definitionId) ||
                ![item.x, item.y, item.width, item.depth].every(Number.isFinite) ||
                item.width < 10 ||
                item.depth < 10 ||
                item.width > 10000 ||
                item.depth > 10000 ||
                (item.locked !== undefined && typeof item.locked !== "boolean") ||
                (item.mirrored !== undefined && typeof item.mirrored !== "boolean") ||
                ![0, 90, 180, 270].includes(item.rotation)
            )
                return false;
            ids.add(item.id);
            return true;
        })
        .map((item) => ({
            ...item,
            photoId: getFurniturePhotos(item.definitionId).some(
                (photo) => photo.id === item.photoId,
            )
                ? item.photoId
                : undefined,
        }));
}
const overlaps = (
    a: { x: number; y: number; width: number; depth: number },
    b: { x: number; y: number; width: number; depth: number },
) =>
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.depth - 0.01 &&
    a.y + a.depth > b.y + 0.01;
export interface FurnitureConflict {
    kind: "door" | "wall" | "furniture" | "room" | "radiator";
    rect: Rect;
    message: string;
}

/** The room furniture is being placed in, as clear rectangles in plan coordinates. */
export interface FurnitureRoom {
    name: string;
    kind?: RoomKind;
    rects: readonly { left: number; top: number; right: number; bottom: number }[];
}

const coveredArea = (rect: Rect, room: FurnitureRoom) =>
    room.rects.reduce((total, cell) => {
        const width = Math.min(rect.x + rect.width, cell.right) - Math.max(rect.x, cell.left);
        const depth = Math.min(rect.y + rect.depth, cell.bottom) - Math.max(rect.y, cell.top);
        return width > 0 && depth > 0 ? total + width * depth : total;
    }, 0);

/** Room cells never overlap, so a body is inside when they cover its whole area. */
export const furnitureInsideRoom = (item: DrawFurniture, room: FurnitureRoom) =>
    furnitureGeometry(item).bodyRects.every((body) => {
        const rect = { ...body, x: body.x + item.x, y: body.y + item.y };
        return coveredArea(rect, room) >= rect.width * rect.depth - 1;
    });

/** A piece belongs to the room its centre stands in. */
export const furnitureBelongsToRoom = (item: DrawFurniture, room: FurnitureRoom) => {
    const { width, depth } = furnitureGeometry(item);
    const centre = { x: item.x + width / 2, y: item.y + depth / 2 };
    return room.rects.some(
        (cell) =>
            centre.x >= cell.left &&
            centre.x <= cell.right &&
            centre.y >= cell.top &&
            centre.y <= cell.bottom,
    );
};

const wallRect = (wall: DrawWallSegment, thickness: number): Rect => ({
    x: Math.min(wall.start.x, wall.end.x) - thickness / 2,
    y: Math.min(wall.start.y, wall.end.y) - thickness / 2,
    width: Math.abs(wall.end.x - wall.start.x) + thickness,
    depth: Math.abs(wall.end.y - wall.start.y) + thickness,
});

export function furnitureConflicts(
    item: DrawFurniture,
    items: DrawFurniture[],
    walls: DrawWallSegment[],
    thickness: number,
    doorObstacles: readonly Rect[] = [],
    room: FurnitureRoom | null = null,
    radiatorObstacles: readonly Rect[] = [],
): FurnitureConflict[] {
    if (room && !furnitureInsideRoom(item, room)) {
        const { width, depth } = furnitureGeometry(item);
        return [
            {
                kind: "room",
                rect: { x: item.x, y: item.y, width, depth },
                message: `Предмет выходит за пределы комнаты «${room.name}». Мебель ставится в выбранную комнату.`,
            },
        ];
    }
    const rects = furnitureGeometry(item).bodyRects.map((rect) => ({
        ...rect,
        x: rect.x + item.x,
        y: rect.y + item.y,
    }));
    const mounting = furnitureDefinition(item.definitionId)?.mounting;
    const candidates: FurnitureConflict[] = [
        // A swinging door leaf passes under upper units.
        ...(mounting === "upper" ? [] : doorObstacles).map((rect) => ({
            kind: "door" as const,
            rect,
            message:
                "Мебель перекрывает дверной проём или мешает открыванию двери. Оставьте проход свободным.",
        })),
        // Upper units hang above a radiator and the warm air rising from it.
        ...(mounting === "upper" ? [] : radiatorObstacles).map((rect) => ({
            kind: "radiator" as const,
            rect,
            message: "Мебель закрывает радиатор. Перед ним нужно оставить 30 см свободными.",
        })),
        ...walls.map((wall) => ({
            kind: "wall" as const,
            rect: wallRect(wall, thickness),
            message: "Предмет пересекает стену. Выберите свободное место.",
        })),
        ...items
            // Upper units hang over base units; each tier meets only its own.
            .filter(
                (other) =>
                    other.id !== item.id &&
                    furnitureDefinition(other.definitionId)?.mounting === mounting,
            )
            .flatMap((other) =>
                furnitureGeometry(other).bodyRects.map((body) => ({
                    kind: "furniture" as const,
                    rect: { ...body, x: body.x + other.x, y: body.y + other.y },
                    message: "Это место занято другой мебелью. Выберите свободное место.",
                })),
            ),
    ];
    const seen = new Set<string>();
    return candidates.filter(({ kind, rect }) => {
        const key = `${kind}:${rect.x}:${rect.y}:${rect.width}:${rect.depth}`;
        if (seen.has(key) || !rects.some((body) => overlaps(body, rect))) return false;
        seen.add(key);
        return true;
    });
}

export function furnitureError(
    item: DrawFurniture,
    items: DrawFurniture[],
    walls: DrawWallSegment[],
    thickness: number,
    doorObstacles: readonly Rect[] = [],
    room: FurnitureRoom | null = null,
    radiatorObstacles: readonly Rect[] = [],
): string | null {
    return (
        furnitureConflicts(item, items, walls, thickness, doorObstacles, room, radiatorObstacles)[0]
            ?.message ?? null
    );
}

/**
 * A passage a piece needs in front of it or beside it, after the catalogue's
 * clearance zones: in the plan's frame, with how much of it is clear.
 */
export interface FurniturePassage {
    itemId: string;
    label: string;
    rect: Rect;
    /** Millimetres the passage needs, measured away from the piece. */
    need: number;
    /** Millimetres clear from the piece's face to the nearest obstacle. */
    free: number;
}

/** Positive-area intersection; pieces that only touch leave the passage open. */
const intersection = (first: Rect, second: Rect): Rect | null => {
    const x = Math.max(first.x, second.x);
    const y = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.depth, second.y + second.depth);
    return right - x > 1 && bottom - y > 1 ? { x, y, width: right - x, depth: bottom - y } : null;
};

/**
 * The passages manual placement keeps an eye on: every hard zone, and for
 * either-side zones (a bed's left or right) the open ones, or the roomiest
 * one when every side is taken. Other floor pieces and walls block a passage;
 * upper units hang above it and do not.
 */
export function furniturePassages(
    items: DrawFurniture[],
    walls: DrawWallSegment[],
    thickness: number,
): FurniturePassage[] {
    const floor = items.filter(
        (item) => furnitureDefinition(item.definitionId)?.mounting !== "upper",
    );
    const bodies = floor.map((item) => ({
        id: item.id,
        definitionId: item.definitionId,
        rects: furnitureGeometry(item).bodyRects.map((rect) => ({
            ...rect,
            x: rect.x + item.x,
            y: rect.y + item.y,
        })),
    }));
    const wallRects = walls.map((wall) => wallRect(wall, thickness));
    return floor.flatMap((item) => {
        const definition = furnitureDefinition(item.definitionId);
        if (!definition) return [];
        const geometry = getRotatedGeometry(placedDefinition(item), item.rotation, item);
        const face = {
            left: item.x,
            top: item.y,
            right: item.x + geometry.width,
            bottom: item.y + geometry.depth,
        };
        const others = bodies.filter((body) => body.id !== item.id);
        const measure = (zone: ClearanceZone, label: string): FurniturePassage => {
            // A coffee table belongs in a sofa's passage; the zone says what may stand in it.
            const obstacles = [
                ...others
                    .filter((body) => !zone.allows?.includes(body.definitionId))
                    .flatMap((body) => body.rects),
                ...wallRects,
            ];
            const rect = {
                x: zone.x + item.x,
                y: zone.y + item.y,
                width: zone.width,
                depth: zone.depth,
            };
            const hits = obstacles.flatMap((obstacle) => intersection(rect, obstacle) ?? []);
            // Which face the passage opens from decides how clearance is measured.
            const side =
                rect.y >= face.bottom - 1
                    ? "bottom"
                    : rect.y + rect.depth <= face.top + 1
                      ? "top"
                      : rect.x >= face.right - 1
                        ? "right"
                        : rect.x + rect.width <= face.left + 1
                          ? "left"
                          : null;
            const need = side === "top" || side === "bottom" ? rect.depth : rect.width;
            const gaps = hits.map((hit) =>
                side === "bottom"
                    ? hit.y - face.bottom
                    : side === "top"
                      ? face.top - (hit.y + hit.depth)
                      : side === "right"
                        ? hit.x - face.right
                        : side === "left"
                          ? face.left - (hit.x + hit.width)
                          : 0,
            );
            const free = Math.max(0, Math.min(need, ...gaps));
            return { itemId: item.id, label, rect, need, free: Math.round(free) };
        };
        const hard = geometry.hardClearanceRects.map((zone) => measure(zone, zone.label));
        const either = geometry.alternativeClearanceRects.map((zone) => measure(zone, zone.label));
        const open = either.filter((passage) => passage.free >= passage.need);
        // Every side taken: the roomiest one is the one worth freeing.
        const best = either.reduce<FurniturePassage[]>(
            (found, passage) => (found.length && found[0].free >= passage.free ? found : [passage]),
            [],
        );
        return [...hard, ...(open.length ? open : best)];
    });
}

export const passageBlocked = (passage: FurniturePassage) => passage.free < passage.need;

export interface FurnitureWallDistance {
    side: "left" | "right" | "top" | "bottom";
    distance: number;
    axis: "x" | "y";
    direction: 1 | -1;
}

/** Nearest wall face whose projection overlaps the furniture bounding box. */
export function furnitureWallDistances(
    item: DrawFurniture,
    walls: DrawWallSegment[],
    thickness: number,
): FurnitureWallDistance[] {
    const { width, depth } = furnitureGeometry(item);
    const found = new Map<FurnitureWallDistance["side"], FurnitureWallDistance>();
    const add = (
        side: FurnitureWallDistance["side"],
        distance: number,
        axis: "x" | "y",
        direction: 1 | -1,
    ) => {
        if (distance < -0.01) return;
        const current = found.get(side);
        if (!current || distance < current.distance)
            found.set(side, { side, distance: Math.max(0, distance), axis, direction });
    };
    walls.forEach((wall) => {
        const r = wallRect(wall, thickness);
        if (wall.start.x === wall.end.x && r.y < item.y + depth && r.y + r.depth > item.y) {
            add("left", item.x - r.x - r.width, "x", 1);
            add("right", r.x - item.x - width, "x", -1);
        }
        if (wall.start.y === wall.end.y && r.x < item.x + width && r.x + r.width > item.x) {
            add("top", item.y - r.y - r.depth, "y", 1);
            add("bottom", r.y - item.y - depth, "y", -1);
        }
    });
    return (["left", "right", "top", "bottom"] as const).flatMap((side) =>
        found.has(side) ? [found.get(side)!] : [],
    );
}

/** Try rotation around the centre, then preserve a nearby corner when against a wall. */
export function rotatedFurnitureCandidates(item: DrawFurniture): DrawFurniture[] {
    const next = { ...item, rotation: ((item.rotation + 90) % 360) as Rotation };
    const before = furnitureGeometry(item);
    const after = furnitureGeometry(next);
    const dx = before.width - after.width;
    const dy = before.depth - after.depth;
    return [
        [dx / 2, dy / 2],
        [0, 0],
        [dx, 0],
        [0, dy],
        [dx, dy],
    ].map(([x, y]) => ({
        ...next,
        x: item.x + x,
        y: item.y + y,
    }));
}

/** Closer than this to a wall face, a piece is pulled flush against it. */
export const FURNITURE_WALL_SNAP_MM = 150;

/** Pulls a piece flush to the nearest wall on each axis when it is close enough. */
export function snapFurnitureToWalls(
    item: DrawFurniture,
    walls: DrawWallSegment[],
    thickness: number,
): DrawFurniture {
    const distances = furnitureWallDistances(item, walls, thickness).filter(
        (entry) => entry.distance > 0 && entry.distance < FURNITURE_WALL_SNAP_MM,
    );
    const next = { ...item };
    (["x", "y"] as const).forEach((axis) => {
        const nearest = distances
            .filter((entry) => entry.axis === axis)
            .sort((first, second) => first.distance - second.distance)[0];
        if (nearest) next[axis] = item[axis] - nearest.direction * nearest.distance;
    });
    return next;
}

/** Rotation that puts each side of the plan behind a piece's back. */
const BACK_TO: Record<"top" | "right" | "bottom" | "left", Rotation> = {
    top: 0,
    right: 90,
    bottom: 180,
    left: 270,
};
/** Within this of a wall, a piece that stands against walls turns its back to it. */
export const FURNITURE_AUTO_ROTATE_MM = 300;

/** Pieces that belong back to a wall; round and all-sided ones keep their turn. */
export const turnsToWall = (definitionId: string) => {
    const edges = furnitureDefinition(definitionId)?.placement.allowedWallContactEdges ?? [];
    return edges.includes("back") && edges.length < 4;
};

/**
 * Turns a piece so its back faces the nearest wall, as Remplanner does while
 * a piece is carried: the wall faces around the piece's centre are measured,
 * the closest one within reach of the turned piece's back wins, and the piece
 * is set back against it. The current turn wins a near tie, so a piece in a
 * corner does not flicker between the two walls.
 */
export function turnToNearestWall(
    item: DrawFurniture,
    walls: DrawWallSegment[],
    thickness: number,
): DrawFurniture {
    if (!turnsToWall(item.definitionId)) return item;
    const current = furnitureGeometry(item);
    const centre = { x: item.x + current.width / 2, y: item.y + current.depth / 2 };
    const half = thickness / 2;
    const faces: { side: keyof typeof BACK_TO; at: number; distance: number }[] = [];
    for (const wall of walls) {
        if (wall.start.x === wall.end.x) {
            const [y0, y1] = [wall.start.y, wall.end.y].sort((a, b) => a - b);
            if (centre.y < y0 || centre.y > y1) continue;
            if (wall.start.x + half <= centre.x)
                faces.push({
                    side: "left",
                    at: wall.start.x + half,
                    distance: centre.x - wall.start.x - half,
                });
            if (wall.start.x - half >= centre.x)
                faces.push({
                    side: "right",
                    at: wall.start.x - half,
                    distance: wall.start.x - half - centre.x,
                });
        } else if (wall.start.y === wall.end.y) {
            const [x0, x1] = [wall.start.x, wall.end.x].sort((a, b) => a - b);
            if (centre.x < x0 || centre.x > x1) continue;
            if (wall.start.y + half <= centre.y)
                faces.push({
                    side: "top",
                    at: wall.start.y + half,
                    distance: centre.y - wall.start.y - half,
                });
            if (wall.start.y - half >= centre.y)
                faces.push({
                    side: "bottom",
                    at: wall.start.y - half,
                    distance: wall.start.y - half - centre.y,
                });
        }
    }
    // A long side the catalogue lets stand at a wall (a bed along the wall) keeps
    // its turn; a short one (a sofa's arm) turns the back to the wall instead.
    const definition = furnitureDefinition(item.definitionId)!;
    const base = getRotatedGeometry(definition, 0);
    const edgeAngle = { back: 0, right: 90, front: 180, left: 270 } as const;
    // Either long side counts: a bed is passed from both sides now (see its passages).
    const sideAllowed =
        base.depth > base.width &&
        definition.placement.allowedWallContactEdges.some(
            (edge) => edge === "left" || edge === "right",
        );
    const longSideTo = (side: keyof typeof BACK_TO) =>
        sideAllowed &&
        [edgeAngle.left, edgeAngle.right].some(
            (angle) => (BACK_TO[side] - angle + 360) % 360 === item.rotation,
        );
    const nearest = [...faces].sort(
        (first, second) =>
            first.distance -
            (first.side === "left" || first.side === "right" ? current.width : current.depth) / 2 -
            (second.distance -
                (second.side === "left" || second.side === "right"
                    ? current.width
                    : current.depth) /
                    2),
    )[0];
    if (nearest && longSideTo(nearest.side)) return item;
    const options = faces.flatMap((face) => {
        const turned = { ...item, rotation: BACK_TO[face.side] };
        const geometry = furnitureGeometry(turned);
        const across =
            face.side === "left" || face.side === "right" ? geometry.width : geometry.depth;
        // How far the turned piece's back would stand from this face.
        const gap = face.distance - across / 2;
        if (gap > FURNITURE_AUTO_ROTATE_MM) return [];
        const placed = {
            ...turned,
            x:
                face.side === "left"
                    ? face.at
                    : face.side === "right"
                      ? face.at - geometry.width
                      : snapMm(centre.x - geometry.width / 2),
            y:
                face.side === "top"
                    ? face.at
                    : face.side === "bottom"
                      ? face.at - geometry.depth
                      : snapMm(centre.y - geometry.depth / 2),
        };
        return [{ placed, score: gap - (turned.rotation === item.rotation ? 60 : 0) }];
    });
    options.sort((first, second) => first.score - second.score);
    return options[0]?.placed ?? item;
}
const snapMm = (n: number) => Math.round(n / 10) * 10;

/** Closer than this to another piece, a piece is pulled against it. */
export const FURNITURE_NEIGHBOUR_SNAP_MM = 100;

/**
 * Magnets between pieces: a side within reach of a neighbour's opposite side
 * is pulled against it, and then the two are lined up along that side when
 * their ends are close. Upper units meet upper units; floor pieces, floor
 * pieces. An axis already held by a wall keeps the wall.
 */
export function snapFurnitureToNeighbours(
    item: DrawFurniture,
    items: DrawFurniture[],
    held: { x: boolean; y: boolean } = { x: false, y: false },
): DrawFurniture {
    const tier = furnitureDefinition(item.definitionId)?.mounting;
    const box = (piece: DrawFurniture) => {
        const { width, depth } = furnitureGeometry(piece);
        return { left: piece.x, top: piece.y, right: piece.x + width, bottom: piece.y + depth };
    };
    const others = items
        .filter(
            (other) =>
                other.id !== item.id && furnitureDefinition(other.definitionId)?.mounting === tier,
        )
        .map(box);
    const me = box(item);
    const overlap = (a0: number, a1: number, b0: number, b1: number) =>
        Math.min(a1, b1) - Math.max(a0, b0);
    let dx: number | null = null;
    let dy: number | null = null;
    const closer = (current: number | null, next: number) =>
        Math.abs(next) < FURNITURE_NEIGHBOUR_SNAP_MM &&
        (current === null || Math.abs(next) < Math.abs(current))
            ? next
            : current;
    for (const other of others) {
        // Side by side: facing sides along x, while the two share some depth.
        if (!held.x && overlap(me.top, me.bottom, other.top, other.bottom) > 0) {
            dx = closer(dx, other.left - me.right);
            dx = closer(dx, other.right - me.left);
        }
        if (!held.y && overlap(me.left, me.right, other.left, other.right) > 0) {
            dy = closer(dy, other.top - me.bottom);
            dy = closer(dy, other.bottom - me.top);
        }
    }
    const next = { ...item, x: item.x + (dx ?? 0), y: item.y + (dy ?? 0) };
    // Line up the fronts or backs of pieces now standing side by side.
    const placed = box(next);
    let ax: number | null = null;
    let ay: number | null = null;
    for (const other of others) {
        const touchingX =
            Math.abs(other.left - placed.right) < 1 || Math.abs(other.right - placed.left) < 1;
        const touchingY =
            Math.abs(other.top - placed.bottom) < 1 || Math.abs(other.bottom - placed.top) < 1;
        if (touchingX && !held.y) {
            ay = closer(ay, other.top - placed.top);
            ay = closer(ay, other.bottom - placed.bottom);
        }
        if (touchingY && !held.x) {
            ax = closer(ax, other.left - placed.left);
            ax = closer(ax, other.right - placed.right);
        }
    }
    return { ...next, x: next.x + (ax ?? 0), y: next.y + (ay ?? 0) };
}

/**
 * Where a carried piece lands: turned to the nearest wall when it stands
 * against walls, pulled flush to it, then against its neighbours. Alt (⌥)
 * turns every magnet off for a free spot.
 */
export function placeFurniture(
    item: DrawFurniture,
    items: DrawFurniture[],
    walls: DrawWallSegment[],
    thickness: number,
    options: { magnets: boolean; turn: boolean },
): DrawFurniture {
    if (!options.magnets) return item;
    const turned = options.turn ? turnToNearestWall(item, walls, thickness) : item;
    const flush = snapFurnitureToWalls(turned, walls, thickness);
    return snapFurnitureToNeighbours(flush, items, {
        x: flush.x !== turned.x,
        y: flush.y !== turned.y,
    });
}
