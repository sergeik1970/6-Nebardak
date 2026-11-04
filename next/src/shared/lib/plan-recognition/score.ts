import type { PlanReading } from "./reading";

type Point = { x: number; y: number };

/** How close a reading came to the truth, in millimetres and counts. */
export interface ReadingScore {
    /** Truth walls matched by a wall of the same direction within 300 mm. */
    wallsMatched: number;
    walls: number;
    /** Length errors of matched walls, mm. */
    wallErrorMedian: number;
    wallErrorMax: number;
    /** |area − true area| / true area. */
    areaError: number;
    /** Truth openings found: same kind, centre within 300 mm. */
    openingsFound: number;
    openings: number;
    /** Openings the reading claims that the truth does not have. */
    openingsExtra: number;
    openingCentreErrorMedian: number;
    openingWidthErrorMedian: number;
}

const OPENING_MATCH_MM = 300;
const WALL_MATCH_MM = 300;

/** Both readings shifted so the contour starts at 0,0: a model picks its own origin. */
const normalized = (reading: PlanReading): PlanReading => {
    const minX = Math.min(...reading.contour.map((point) => point.x));
    const minY = Math.min(...reading.contour.map((point) => point.y));
    const shift = (point: Point) => ({ x: point.x - minX, y: point.y - minY });
    return {
        contour: reading.contour.map(shift),
        openings: reading.openings.map((opening) => ({
            ...opening,
            from: shift(opening.from),
            to: shift(opening.to),
        })),
    };
};

const area = (contour: Point[]) =>
    Math.abs(
        contour.reduce((sum, point, index) => {
            const next = contour[(index + 1) % contour.length];
            return sum + point.x * next.y - next.x * point.y;
        }, 0) / 2,
    );

const edges = (contour: Point[]) =>
    contour.map((start, index) => {
        const end = contour[(index + 1) % contour.length];
        return {
            horizontal: Math.abs(end.y - start.y) < Math.abs(end.x - start.x),
            length: Math.hypot(end.x - start.x, end.y - start.y),
            middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        };
    });

const distance = (first: Point, second: Point) =>
    Math.hypot(first.x - second.x, first.y - second.y);

const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((first, second) => first - second);
    return sorted[Math.floor(sorted.length / 2)];
};

export const scoreReading = (truthInput: PlanReading, readInput: PlanReading): ReadingScore => {
    const truth = normalized(truthInput);
    const read = normalized(readInput);

    const readEdges = edges(read.contour);
    const wallErrors = edges(truth.contour).flatMap((edge) => {
        const candidates = readEdges
            .filter((candidate) => candidate.horizontal === edge.horizontal)
            .map((candidate) => ({ candidate, gap: distance(candidate.middle, edge.middle) }))
            .sort((first, second) => first.gap - second.gap);
        const best = candidates[0];
        return best && best.gap <= WALL_MATCH_MM
            ? [Math.abs(best.candidate.length - edge.length)]
            : [];
    });

    const centre = (opening: PlanReading["openings"][number]) => ({
        x: (opening.from.x + opening.to.x) / 2,
        y: (opening.from.y + opening.to.y) / 2,
    });
    const width = (opening: PlanReading["openings"][number]) => distance(opening.from, opening.to);
    const unused = new Set(read.openings.map((_, index) => index));
    const centreErrors: number[] = [];
    const widthErrors: number[] = [];
    for (const opening of truth.openings) {
        let best = -1;
        let bestGap = Number.POSITIVE_INFINITY;
        unused.forEach((index) => {
            const candidate = read.openings[index];
            if (candidate.kind !== opening.kind) return;
            const gap = distance(centre(candidate), centre(opening));
            if (gap < bestGap) {
                best = index;
                bestGap = gap;
            }
        });
        if (best === -1 || bestGap > OPENING_MATCH_MM) continue;
        unused.delete(best);
        centreErrors.push(bestGap);
        widthErrors.push(Math.abs(width(read.openings[best]) - width(opening)));
    }

    const trueArea = area(truth.contour);
    return {
        wallsMatched: wallErrors.length,
        walls: truth.contour.length,
        wallErrorMedian: Math.round(median(wallErrors)),
        wallErrorMax: Math.round(wallErrors.length ? Math.max(...wallErrors) : 0),
        areaError: trueArea ? Math.abs(area(read.contour) - trueArea) / trueArea : 1,
        openingsFound: centreErrors.length,
        openings: truth.openings.length,
        openingsExtra: unused.size,
        openingCentreErrorMedian: Math.round(median(centreErrors)),
        openingWidthErrorMedian: Math.round(median(widthErrors)),
    };
};
