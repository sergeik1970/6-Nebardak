import { describe, expect, it } from "vitest";

import { Placement } from "./types";
import {
    canRedoPlacementHistory,
    canUndoPlacementHistory,
    createPlacementHistory,
    pushPlacementHistory,
    redoPlacementHistory,
    resetPlacementHistory,
    undoPlacementHistory,
} from "./placement-history";

const placement = (x: number): Placement => ({
    instanceId: "desk-1",
    definitionId: "desk",
    x,
    y: 100,
    rotation: 0,
});

describe("placement history", () => {
    it("undoes and redoes manual placement snapshots", () => {
        const initial = createPlacementHistory([placement(100)]);
        const edited = pushPlacementHistory(initial, [placement(150)]);
        const undone = undoPlacementHistory(edited);

        expect(undone.present).toEqual([placement(100)]);
        expect(canUndoPlacementHistory(undone)).toBe(false);
        expect(canRedoPlacementHistory(undone)).toBe(true);
        expect(redoPlacementHistory(undone).present).toEqual([placement(150)]);
    });

    it("clears redo snapshots after a new edit", () => {
        const edited = pushPlacementHistory(createPlacementHistory([placement(100)]), [
            placement(150),
        ]);
        const undone = undoPlacementHistory(edited);
        const branched = pushPlacementHistory(undone, [placement(200)]);

        expect(branched.future).toEqual([]);
        expect(canRedoPlacementHistory(branched)).toBe(false);
    });

    it("does not add a duplicate snapshot", () => {
        const history = createPlacementHistory([placement(100)]);

        expect(pushPlacementHistory(history, [placement(100)])).toBe(history);
    });

    it("clears both stacks at a generated-variant boundary", () => {
        const edited = pushPlacementHistory(createPlacementHistory([placement(100)]), [
            placement(150),
        ]);
        const boundary = resetPlacementHistory([placement(400)]);

        expect(edited.past).toHaveLength(1);
        expect(boundary).toEqual({ past: [], present: [placement(400)], future: [] });
    });

    it("keeps only the configured number of undo snapshots", () => {
        let history = createPlacementHistory([placement(0)]);

        history = pushPlacementHistory(history, [placement(50)], 2);
        history = pushPlacementHistory(history, [placement(100)], 2);
        history = pushPlacementHistory(history, [placement(150)], 2);

        expect(history.past).toHaveLength(2);
        expect(undoPlacementHistory(undoPlacementHistory(history)).present).toEqual([
            placement(50),
        ]);
    });
});
