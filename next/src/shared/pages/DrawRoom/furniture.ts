import {
    FURNITURE_CATALOG,
    getRotatedGeometry,
    type DrawWallSegment,
    type Rotation,
    type Rect,
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
    kind: "door" | "wall" | "furniture";
    rect: Rect;
    message: string;
}

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
): FurnitureConflict[] {
    const rects = furnitureGeometry(item).bodyRects.map((rect) => ({
        ...rect,
        x: rect.x + item.x,
        y: rect.y + item.y,
    }));
    const candidates: FurnitureConflict[] = [
        ...doorObstacles.map((rect) => ({
            kind: "door" as const,
            rect,
            message:
                "Мебель перекрывает дверной проём или мешает открыванию двери. Оставьте проход свободным.",
        })),
        ...walls.map((wall) => ({
            kind: "wall" as const,
            rect: wallRect(wall, thickness),
            message: "Предмет пересекает стену. Выберите свободное место.",
        })),
        ...items
            .filter((other) => other.id !== item.id)
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
): string | null {
    return furnitureConflicts(item, items, walls, thickness, doorObstacles)[0]?.message ?? null;
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
