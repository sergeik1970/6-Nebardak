import { FurniturePriority, FurnitureSelection } from "./types";

/** Converts the editor's count/priority maps without collapsing optional items
 * into the legacy preferred fallback. */
export const buildPrioritizedFurnitureSelection = (
    counts: Record<string, number>,
    priorities: Record<string, FurniturePriority>,
): FurnitureSelection =>
    Object.fromEntries(
        Object.entries(counts).map(([definitionId, count]) => {
            const priority = priorities[definitionId] ?? "preferred";

            return [
                definitionId,
                {
                    count,
                    priority,
                    required: priority === "required",
                },
            ];
        }),
    );
