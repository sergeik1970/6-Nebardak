import { Placement } from "./types";

export interface PlacementHistory {
    past: Placement[][];
    present: Placement[];
    future: Placement[][];
}

const clonePlacements = (placements: Placement[]): Placement[] =>
    placements.map((placement) => ({ ...placement }));

const placementsEqual = (first: Placement[], second: Placement[]): boolean =>
    first.length === second.length &&
    first.every((placement, index) => {
        const candidate = second[index];

        return (
            candidate !== undefined &&
            placement.instanceId === candidate.instanceId &&
            placement.definitionId === candidate.definitionId &&
            placement.x === candidate.x &&
            placement.y === candidate.y &&
            placement.rotation === candidate.rotation &&
            placement.width === candidate.width &&
            placement.depth === candidate.depth &&
            placement.photoId === candidate.photoId
        );
    });

export const createPlacementHistory = (placements: Placement[] = []): PlacementHistory => ({
    past: [],
    present: clonePlacements(placements),
    future: [],
});

export const pushPlacementHistory = (
    history: PlacementHistory,
    placements: Placement[],
    limit = 50,
): PlacementHistory => {
    if (placementsEqual(history.present, placements)) {
        return history;
    }

    const past = [...history.past, clonePlacements(history.present)];

    return {
        past: past.slice(Math.max(0, past.length - Math.max(1, limit))),
        present: clonePlacements(placements),
        future: [],
    };
};

export const resetPlacementHistory = (placements: Placement[]): PlacementHistory =>
    createPlacementHistory(placements);

export const undoPlacementHistory = (history: PlacementHistory): PlacementHistory => {
    const previous = history.past.at(-1);

    if (!previous) {
        return history;
    }

    return {
        past: history.past.slice(0, -1),
        present: clonePlacements(previous),
        future: [clonePlacements(history.present), ...history.future],
    };
};

export const redoPlacementHistory = (history: PlacementHistory): PlacementHistory => {
    const [next, ...future] = history.future;

    if (!next) {
        return history;
    }

    return {
        past: [...history.past, clonePlacements(history.present)],
        present: clonePlacements(next),
        future,
    };
};

export const canUndoPlacementHistory = (history: PlacementHistory): boolean =>
    history.past.length > 0;

export const canRedoPlacementHistory = (history: PlacementHistory): boolean =>
    history.future.length > 0;
