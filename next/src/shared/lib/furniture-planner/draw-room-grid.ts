/**
 * The drawing grid is a world-space datum, not an SVG implementation detail.
 * Keep every tool, graph operation and SVG pattern anchored to this same point.
 */
/**
 * The displayed lattice is deliberately offset by half a construction cell.
 * Graph coordinates are wall centre lines on 0, 50, 100…; a 50 mm wall then
 * occupies the visual cell immediately around that line and its two material
 * faces land on the visible 25, 75, 125… grid lines.  Do not use this as the
 * snapping origin: moving the cursor must still visit every 50 mm point.
 */
export const DRAW_ROOM_GRID_ORIGIN_MM = 25;
/** A drawn contour can be a whole flat, far wider than any single room. */
export const MAX_DRAWN_CONTOUR_MM = 30_000;

export const DRAW_ROOM_GRID_SNAP_MM = 50;
/** New 10 cm-wall drawings retain 10 mm architectural coordinates. */
export const DRAW_ROOM_CONSTRUCTION_SNAP_MM = 10;

/**
 * A wall is drawn inside one grid lane. Graph nodes stay on the construction
 * centre lattice while the material occupies the visible cell around it.
 * Keeping this datum here prevents the SVG renderer and pointer/graph code
 * from inventing slightly different half-cell offsets.
 */
// The default wall is one 50 mm construction lane. Its edges are 25 mm either
// side of the graph centre and therefore coincide with the displayed lattice.
/** Legacy drafts did not persist a construction thickness and used this lane. */
export const DRAW_ROOM_WALL_LANE_MM = 50;

/** New DrawRoom contours render and persist a 10 cm construction wall. */
export const DRAW_ROOM_CONSTRUCTION_WALL_THICKNESS_MM = 100;

export const snapDrawRoomCoordinate = (value: number, snapMm = DRAW_ROOM_GRID_SNAP_MM) =>
    Math.round(value / snapMm) * snapMm;

/**
 * The wall centre is a construction point, not a second grid. A 5 cm wall
 * occupies one visual 50 mm cell. Keeping this alias avoids reviving the old
 * every-other-cell cursor regression in graph callers.
 */
export const snapDrawRoomWallLaneCentre = (value: number, snapMm = DRAW_ROOM_GRID_SNAP_MM) =>
    snapDrawRoomCoordinate(value, snapMm);

export const getDrawRoomWallLane = (centre: number) => ({
    centre: snapDrawRoomCoordinate(centre),
    start: snapDrawRoomCoordinate(centre) - DRAW_ROOM_WALL_LANE_MM / 2,
    end: snapDrawRoomCoordinate(centre) + DRAW_ROOM_WALL_LANE_MM / 2,
});

export interface DrawRoomGridPresentation {
    level: DrawRoomGridPresentationLevel;
    /** Smallest visible vector cell. This changes only how the grid is drawn. */
    minorStepMm: number;
    /** Calm intermediate rhythm between the minor and major lines. */
    mediumStepMm: number;
    /** Strongest reference line. */
    majorStepMm: number;
    label: string;
}

export type DrawRoomGridPresentationLevel = "distant" | "far" | "base" | "near" | "close";

const presentationForLevel = (level: DrawRoomGridPresentationLevel): DrawRoomGridPresentation => {
    if (level === "close") {
        return {
            level,
            minorStepMm: 12.5,
            mediumStepMm: 50,
            majorStepMm: 250,
            label: "12,5 мм",
        };
    }
    if (level === "near") {
        return { level, minorStepMm: 25, mediumStepMm: 50, majorStepMm: 250, label: "25 мм" };
    }
    if (level === "base") {
        return { level, minorStepMm: 50, mediumStepMm: 250, majorStepMm: 500, label: "50 мм" };
    }
    if (level === "far") {
        return { level, minorStepMm: 100, mediumStepMm: 500, majorStepMm: 1000, label: "10 см" };
    }
    return { level, minorStepMm: 250, mediumStepMm: 1000, majorStepMm: 2000, label: "25 см" };
};

const levelForPixels = (baseCellPixels: number): DrawRoomGridPresentationLevel => {
    if (baseCellPixels >= 14) return "close";
    if (baseCellPixels >= 7) return "near";
    if (baseCellPixels >= 2.5) return "base";
    if (baseCellPixels >= 1.25) return "far";
    return "distant";
};

/**
 * Keeps a presentation level while a wheel gesture hovers close to a density
 * boundary.  Enter/exit thresholds are intentionally asymmetric; snapping is
 * unaffected and remains 50 mm.
 */
export const resolveDrawRoomGridPresentationLevel = (
    baseCellPixels: number,
    previousLevel?: DrawRoomGridPresentationLevel | null,
): DrawRoomGridPresentationLevel => {
    if (!previousLevel) return levelForPixels(baseCellPixels);
    if (previousLevel === "close" && baseCellPixels >= 13) return "close";
    if (previousLevel === "near" && baseCellPixels >= 6.2 && baseCellPixels < 16) return "near";
    if (previousLevel === "base" && baseCellPixels >= 2.2 && baseCellPixels < 8) return "base";
    if (previousLevel === "far" && baseCellPixels >= 1.05 && baseCellPixels < 3) return "far";
    if (previousLevel === "distant" && baseCellPixels < 1.5) return "distant";
    return levelForPixels(baseCellPixels);
};

/**
 * Chooses display density from real pixels rather than from an arbitrary zoom
 * percentage. The construction snap remains 50 mm at every level.
 */
export const getDrawRoomGridPresentation = (
    millimetersPerPixel: number,
    previousLevel?: DrawRoomGridPresentationLevel | null,
): DrawRoomGridPresentation => {
    const baseCellPixels = DRAW_ROOM_GRID_SNAP_MM / Math.max(millimetersPerPixel, 0.001);
    return presentationForLevel(
        resolveDrawRoomGridPresentationLevel(baseCellPixels, previousLevel),
    );
};
