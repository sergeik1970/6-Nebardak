import { describe, expect, it } from "vitest";

import { buildFurnitureInstances } from "./catalog";
import { buildPrioritizedFurnitureSelection } from "./selection";

describe("planner selection adapter", () => {
    it("preserves required, preferred and optional priorities from the editor", () => {
        const selection = buildPrioritizedFurnitureSelection(
            { "double-bed": 1, dresser: 1, desk: 1 },
            { "double-bed": "required", dresser: "optional", desk: "preferred" },
        );
        const instances = buildFurnitureInstances(selection);

        expect(
            instances.map(({ definitionId, priority, required }) => ({
                definitionId,
                priority,
                required,
            })),
        ).toEqual([
            { definitionId: "double-bed", priority: "required", required: true },
            { definitionId: "desk", priority: "preferred", required: false },
            { definitionId: "dresser", priority: "optional", required: false },
        ]);
    });

    it("uses preferred only when an older editor state has no explicit priority", () => {
        const selection = buildPrioritizedFurnitureSelection({ bookcase: 1 }, {});

        expect(selection.bookcase).toEqual({
            count: 1,
            priority: "preferred",
            required: false,
        });
    });
});
