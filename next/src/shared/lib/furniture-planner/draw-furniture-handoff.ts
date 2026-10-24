import { getFurniture, getMaximumFurnitureCount } from "./catalog";
import { validateLayout } from "./geometry";
import type { Placement, Room, ValidationIssue } from "./types";
import type { DrawFurniture } from "../../pages/DrawRoom/furniture";

export function prepareDrawFurnitureHandoff(
    room: Room,
    origin: { x: number; y: number },
    furniture: DrawFurniture[],
) {
    const selection: Record<string, number> = {};
    // The layout step has a single floor tier: upper units stay on the drawing.
    const floorFurniture = furniture.filter(
        (item) => getFurniture(item.definitionId).mounting !== "upper",
    );
    const placements: Placement[] = floorFurniture.map((item) => {
        const count = (selection[item.definitionId] ?? 0) + 1;
        selection[item.definitionId] = count;
        return {
            instanceId: `${item.definitionId}-${count}`,
            definitionId: item.definitionId,
            x: item.x - origin.x,
            y: item.y - origin.y,
            rotation: item.rotation,
            width: item.width,
            depth: item.depth,
            ...(item.photoId ? { photoId: item.photoId } : {}),
        };
    });
    const excess = Object.entries(selection).find(
        ([id, count]) => count > getMaximumFurnitureCount(id),
    );
    if (excess)
        return {
            error: `В планировщике допустимо не более ${getMaximumFurnitureCount(excess[0])} предметов этого типа. Уменьшите количество перед переносом.`,
            placements,
            selection,
        };
    const validation = validateLayout(room, placements);
    return {
        error: drawingBlockingIssues(validation.issues)[0]?.message ?? null,
        placements,
        selection,
    };
}

/** Manual drawings retain their arrangement; ergonomic advice remains visible in Planner. */
export const drawingBlockingIssues = (issues: ValidationIssue[]) =>
    issues.filter((issue) =>
        [
            "outside-room",
            "body-overlap",
            "partition-blocked",
            "door-blocked",
            "radiator-blocked",
        ].includes(issue.code),
    );
