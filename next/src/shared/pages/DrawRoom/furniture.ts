import {
    FURNITURE_CATALOG,
    getRotatedGeometry,
    type DrawWallSegment,
    type FurnitureCategory,
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
}
export const furnitureDefinition = (id: string) => FURNITURE_CATALOG.find((item) => item.id === id);
export function furnitureGeometry(item: DrawFurniture) {
    const definition = furnitureDefinition(item.definitionId)!;
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

const KIND_CATEGORIES: Record<RoomKind, FurnitureCategory[]> = {
    bedroom: ["sleep", "storage", "work", "media"],
    living: ["living", "media", "storage"],
    kitchen: ["kitchen", "living", "storage"],
    children: ["children", "sleep", "storage", "work"],
    office: ["work", "storage", "living"],
    hallway: ["storage", "living"],
    bathroom: ["storage"],
    other: [],
};

/** Catalogue sections for a room: what suits its kind first, the rest after. */
export function furnitureCategoryOrder(
    all: readonly FurnitureCategory[],
    kind?: RoomKind,
): FurnitureCategory[] {
    const preferred = kind
        ? KIND_CATEGORIES[kind].filter((category) => all.includes(category))
        : [];
    return [...preferred, ...all.filter((category) => !preferred.includes(category))];
}
