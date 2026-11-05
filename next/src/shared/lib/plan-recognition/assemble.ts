import type { DrawWallSegment } from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import type { RoomKind } from "@/shared/lib/furniture-planner/types";
import type { ApartmentRoomReading } from "./apartment";
import { planRoomLabel, roomKindFromName, straightenContour } from "./to-room";

type Point = { x: number; y: number };

/** The editor's snap step: every wall lands on it. */
export const ASSEMBLY_CELL_MM = 50;
/** Gaps up to twice this are walls between rooms; wider ones stay outside. */
const CLOSING_CELLS = 6;
/** The editor's construction wall; outer centre lines sit half of it outside. */
export const ASSEMBLY_OUTER_WALL_MM = 100;
/** Where the apartment starts on the editor's board. */
const BOARD_ORIGIN_MM = 1000;
const PAD_CELLS = 4;
const OUTSIDE = -1;
/**
 * Steps in a room's side up to this many cells (450 mm) are lined up: the
 * planner's walls are at least 500 mm, so a shorter step cannot be kept.
 */
const STRAIGHTEN_CELLS = 9;

export interface AssembledRoom {
    /** Index into the model's rooms. */
    source: number;
    name: string;
    label: string;
    kind?: RoomKind;
    /** A point inside the room on the board, to find its region again. */
    inside: Point;
}

export interface AssembledOpening {
    source: number;
    kind: "window" | "door";
    /** Both ends on the board, where the model drew them. */
    from: Point;
    to: Point;
}

export interface AssembledApartment {
    /** Wall centre lines on the board; partitions carry their own thickness. */
    segments: DrawWallSegment[];
    rooms: AssembledRoom[];
    openings: AssembledOpening[];
    /** Rooms the model could not size, left out of the drawing. */
    skipped: string[];
}

const inside = (polygon: Point[], point: Point) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (a.y > point.y !== b.y > point.y) {
            const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
            if (point.x < x) result = !result;
        }
    }
    return result;
};

class Grid {
    readonly cells: Int16Array;
    constructor(
        readonly width: number,
        readonly height: number,
    ) {
        this.cells = new Int16Array(width * height).fill(OUTSIDE);
    }
    get(column: number, row: number) {
        if (column < 0 || row < 0 || column >= this.width || row >= this.height) return OUTSIDE;
        return this.cells[row * this.width + column];
    }
    set(column: number, row: number, value: number) {
        this.cells[row * this.width + column] = value;
    }
}

/** Square max/min filter of a boolean mask (dilation when `grow`, erosion otherwise). */
const filterMask = (
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
    grow: boolean,
) => {
    const pass = (source: Uint8Array, horizontal: boolean) => {
        const result = new Uint8Array(source.length);
        for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
                let value = grow ? 0 : 1;
                for (let step = -radius; step <= radius; step += 1) {
                    const c = horizontal ? column + step : column;
                    const r = horizontal ? row : row + step;
                    const inGrid = c >= 0 && r >= 0 && c < width && r < height;
                    const cell = inGrid ? source[r * width + c] : 0;
                    if (grow ? cell : !cell) {
                        value = grow ? 1 : 0;
                        break;
                    }
                }
                result[row * width + column] = value;
            }
        }
        return result;
    };
    return pass(pass(mask, true), false);
};

/** Gives every cell of `area` the label of the nearest room cell (4-neighbour steps). */
const growLabels = (grid: Grid, area: Uint8Array) => {
    let frontier: number[] = [];
    grid.cells.forEach((label, index) => {
        if (label !== OUTSIDE) frontier.push(index);
    });
    while (frontier.length) {
        const next: number[] = [];
        for (const index of frontier) {
            const column = index % grid.width;
            const row = Math.floor(index / grid.width);
            for (const [dc, dr] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                const c = column + dc;
                const r = row + dr;
                if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
                const target = r * grid.width + c;
                if (!area[target] || grid.cells[target] !== OUTSIDE) continue;
                grid.cells[target] = grid.cells[index];
                next.push(target);
            }
        }
        frontier = next;
    }
};

/**
 * Splits each wall gap straight down its middle: a gap cell goes to the room
 * it reaches first looking left, right, up or down. Growing by distance
 * instead cuts gap corners on a diagonal, a staircase the editor cannot
 * keep. Cells no straight look reaches stay for the distance growth.
 */
const assignByRays = (grid: Grid, area: Uint8Array, reach: number) => {
    const { width, height } = grid;
    const source = Int16Array.from(grid.cells);
    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            const index = row * width + column;
            if (!area[index] || source[index] !== OUTSIDE) continue;
            let best = OUTSIDE;
            let bestDistance = reach + 1;
            for (const [dc, dr] of [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
            ]) {
                for (let step = 1; step < bestDistance; step += 1) {
                    const c = column + dc * step;
                    const r = row + dr * step;
                    if (c < 0 || r < 0 || c >= width || r >= height || !area[r * width + c]) break;
                    const label = source[r * width + c];
                    if (label === OUTSIDE) continue;
                    best = label;
                    bestDistance = step;
                    break;
                }
            }
            if (best !== OUTSIDE) grid.cells[index] = best;
        }
    }
};

/**
 * Lines up each side of every room: where the model drew one wall of a room
 * up to 450 mm off along different neighbours, the side takes its most
 * common line and the neighbours give or take the difference. Real steps
 * in a room are larger and stay; the outer face is left as simplified.
 */
const straightenBoundaries = (grid: Grid) => {
    const { width, height } = grid;
    const labels = new Set<number>();
    grid.cells.forEach((label) => {
        if (label !== OUTSIDE) labels.add(label);
    });
    // [dc, dr]: where the neighbour across this side lies.
    const sides: [number, number][] = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
    ];
    labels.forEach((label) => {
        for (const [dc, dr] of sides) {
            const vertical = dc !== 0;
            // Each line across the side (a column for top/bottom, a row for left/right)
            // and where along it the room's face is.
            const faces: { line: number; at: number }[] = [];
            const lines = vertical ? height : width;
            const span = vertical ? width : height;
            for (let line = 0; line < lines; line += 1) {
                for (let at = 0; at < span; at += 1) {
                    const column = vertical ? at : line;
                    const row = vertical ? line : at;
                    if (grid.get(column, row) !== label) continue;
                    const across = grid.get(column + dc, row + dr);
                    if (across === label || across === OUTSIDE) continue;
                    faces.push({ line, at });
                }
            }
            if (!faces.length) continue;
            const counts = new Map<number, number>();
            faces.forEach((face) => counts.set(face.at, (counts.get(face.at) ?? 0) + 1));
            const main = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
            const direction = vertical ? dc : dr;
            for (const face of faces) {
                const offset = (face.at - main) * direction;
                if (offset === 0 || Math.abs(offset) > STRAIGHTEN_CELLS) continue;
                const cell = (at: number) =>
                    vertical ? ([at, face.line] as const) : ([face.line, at] as const);
                if (offset < 0) {
                    // The face stops short of the line: take the neighbour's cells up to it.
                    for (let step = 1; step <= -offset; step += 1) {
                        const [c, r] = cell(face.at + direction * step);
                        if (grid.get(c, r) !== OUTSIDE) grid.set(c, r, label);
                    }
                } else {
                    // The face sticks out past the line: give those cells to the neighbour.
                    const [nc, nr] = cell(face.at + direction);
                    const neighbour = grid.get(nc, nr);
                    for (let step = 0; step < offset; step += 1) {
                        const [c, r] = cell(face.at - direction * step);
                        if (grid.get(c, r) === label) grid.set(c, r, neighbour);
                    }
                }
            }
        }
    });
};

/** No room is narrower than this: anything thinner is grid noise from a wide wall gap. */
const SLIVER_CELLS = 3;

/**
 * Hands each room's strips narrower than 350 mm to the neighbour they touch
 * most. Where three rooms meet across a wide gap the nearest-room split
 * leaves such strips, and a room with a tail is not a rectangle the planner
 * can furnish.
 */
const removeSlivers = (grid: Grid) => {
    const { width, height } = grid;
    const labels = new Set<number>();
    grid.cells.forEach((label) => {
        if (label !== OUTSIDE) labels.add(label);
    });
    for (let pass = 0; pass < 3; pass += 1) {
        let changed = false;
        labels.forEach((label) => {
            const mask = Uint8Array.from(grid.cells, (value) => (value === label ? 1 : 0));
            const opened = filterMask(
                filterMask(mask, width, height, SLIVER_CELLS, false),
                width,
                height,
                SLIVER_CELLS,
                true,
            );
            // A room smaller than the opening's square is kept whole.
            if (!opened.some(Boolean)) return;
            for (let index = 0; index < mask.length; index += 1) {
                if (!mask[index] || opened[index]) continue;
                const column = index % width;
                const row = Math.floor(index / width);
                const counts = new Map<number, number>();
                for (let dr = -SLIVER_CELLS; dr <= SLIVER_CELLS; dr += 1)
                    for (let dc = -SLIVER_CELLS; dc <= SLIVER_CELLS; dc += 1) {
                        const other = grid.get(column + dc, row + dr);
                        if (other !== label && other !== OUTSIDE)
                            counts.set(other, (counts.get(other) ?? 0) + 1);
                    }
                const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
                if (best) {
                    grid.cells[index] = best[0];
                    changed = true;
                }
            }
        });
        if (!changed) break;
    }
};

/** A cell unlike all four neighbours takes the most common of them. */
const removeSpecks = (grid: Grid) => {
    for (let row = 0; row < grid.height; row += 1) {
        for (let column = 0; column < grid.width; column += 1) {
            const own = grid.get(column, row);
            const around = [
                grid.get(column + 1, row),
                grid.get(column - 1, row),
                grid.get(column, row + 1),
                grid.get(column, row - 1),
            ];
            if (around.includes(own)) continue;
            const counts = new Map<number, number>();
            around.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
            const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
            grid.set(column, row, best);
        }
    }
};

/** Corners of the largest filled region of a mask, in cell units, clockwise on screen. */
const traceLargestOutline = (mask: Uint8Array, width: number, height: number): Point[] | null => {
    const at = (column: number, row: number) =>
        column >= 0 && row >= 0 && column < width && row < height ? mask[row * width + column] : 0;
    // Directed boundary edges with the filled cell on the right (screen y down).
    const next = new Map<string, Point[]>();
    const add = (from: Point, to: Point) => {
        const key = `${from.x},${from.y}`;
        next.set(key, [...(next.get(key) ?? []), to]);
    };
    for (let row = 0; row <= height; row += 1) {
        for (let column = 0; column <= width; column += 1) {
            const here = at(column, row);
            if (here !== at(column, row - 1)) {
                if (here) add({ x: column, y: row }, { x: column + 1, y: row });
                else add({ x: column + 1, y: row }, { x: column, y: row });
            }
            if (here !== at(column - 1, row)) {
                if (here) add({ x: column, y: row + 1 }, { x: column, y: row });
                else add({ x: column, y: row }, { x: column, y: row + 1 });
            }
        }
    }
    const loops: Point[][] = [];
    const used = new Set<string>();
    next.forEach((targets, key) => {
        targets.forEach((first) => {
            const edgeKey = `${key}>${first.x},${first.y}`;
            if (used.has(edgeKey)) return;
            const [sx, sy] = key.split(",").map(Number);
            const loop: Point[] = [{ x: sx, y: sy }];
            let from = { x: sx, y: sy };
            let to = first;
            for (let guard = 0; guard < 200_000; guard += 1) {
                used.add(`${from.x},${from.y}>${to.x},${to.y}`);
                if (to.x === sx && to.y === sy) break;
                loop.push(to);
                const options = (next.get(`${to.x},${to.y}`) ?? []).filter(
                    (candidate) => !used.has(`${to.x},${to.y}>${candidate.x},${candidate.y}`),
                );
                if (!options.length) break;
                // At a pinch point keep turning the same way, so loops stay simple.
                const direction = { x: to.x - from.x, y: to.y - from.y };
                const right = { x: -direction.y, y: direction.x };
                const chosen =
                    options.find(
                        (option) => option.x - to.x === right.x && option.y - to.y === right.y,
                    ) ?? options[0];
                from = to;
                to = chosen;
            }
            loops.push(loop);
        });
    });
    const outlines = loops
        .map((loop) => cleanedLoop(loop))
        .filter((loop) => loop.length >= 4 && signedArea(loop) > 0)
        .sort((first, second) => signedArea(second) - signedArea(first));
    return outlines[0] ?? null;
};

const signedArea = (points: Point[]) =>
    points.reduce((sum, point, index) => {
        const following = points[(index + 1) % points.length];
        return sum + point.x * following.y - following.x * point.y;
    }, 0) / 2;

const cleanedLoop = (points: Point[]) => {
    let result = points.filter((point, index) => {
        const following = points[(index + 1) % points.length];
        return point.x !== following.x || point.y !== following.y;
    });
    for (let changed = true; changed && result.length > 2; ) {
        changed = false;
        for (let index = 0; index < result.length; index += 1) {
            const previous = result[(index - 1 + result.length) % result.length];
            const point = result[index];
            const following = result[(index + 1) % result.length];
            if (
                (previous.x === point.x && point.x === following.x) ||
                (previous.y === point.y && point.y === following.y)
            ) {
                result = result.filter((_, other) => other !== index);
                changed = true;
                break;
            }
        }
    }
    return result;
};

const MIN_OUTER_CELLS = Math.ceil(500 / ASSEMBLY_CELL_MM);
const MAX_OUTER_CORNERS = 16;

/**
 * Removes the outline's steps shorter than the editor's 500 mm wall and keeps
 * it within 16 corners: each time the shortest edge goes, by sliding the
 * shorter of its two neighbours across it, which changes the area least.
 */
const simplifyOutline = (outline: Point[]): Point[] | null => {
    let points = cleanedLoop(outline);
    for (let guard = 0; guard < 400; guard += 1) {
        const lengths = points.map((point, index) => {
            const following = points[(index + 1) % points.length];
            return Math.abs(following.x - point.x) + Math.abs(following.y - point.y);
        });
        const shortest = lengths.indexOf(Math.min(...lengths));
        if (lengths[shortest] >= MIN_OUTER_CELLS && points.length <= MAX_OUTER_CORNERS) break;
        const n = points.length;
        const i = shortest;
        const start = points[i];
        const end = points[(i + 1) % n];
        const shift = { x: end.x - start.x, y: end.y - start.y };
        const before = lengths[(i - 1 + n) % n];
        const after = lengths[(i + 1) % n];
        const candidate = points.map((point) => ({ ...point }));
        if (before <= after) {
            // Slide the previous edge onto the line of the next one.
            candidate[(i - 1 + n) % n] = {
                x: candidate[(i - 1 + n) % n].x + shift.x,
                y: candidate[(i - 1 + n) % n].y + shift.y,
            };
            candidate[i] = { ...end };
        } else {
            candidate[(i + 2) % n] = {
                x: candidate[(i + 2) % n].x - shift.x,
                y: candidate[(i + 2) % n].y - shift.y,
            };
            candidate[(i + 1) % n] = { ...start };
        }
        const cleaned = cleanedLoop(candidate);
        if (cleaned.length < 4 || signedArea(cleaned) <= 0) return null;
        points = cleaned;
    }
    const valid = points.every((point, index) => {
        const following = points[(index + 1) % points.length];
        return Math.abs(following.x - point.x) + Math.abs(following.y - point.y) >= MIN_OUTER_CELLS;
    });
    return valid && points.length <= MAX_OUTER_CORNERS ? points : null;
};

/**
 * Rebuilds a whole apartment from the rooms the model placed in one frame:
 * the rooms are laid on the editor's 50 mm grid, gaps up to 600 mm between
 * them are taken as walls and split down the middle, and every boundary
 * becomes a wall centre line: between two rooms a partition as thick as the
 * gap was, around the flat an outer wall whose inner face is the rooms' face.
 */
export const assembleApartment = (rooms: ApartmentRoomReading[]): AssembledApartment | null => {
    const shapes = rooms.map((room) => straightenContour(room));
    const placed = shapes.flatMap((shape, source) =>
        shape ? [{ source, points: shape.points }] : [],
    );
    const skipped = rooms.filter((_, index) => !shapes[index]).map((room) => room.name);
    if (!placed.length) return null;

    const all = placed.flatMap((room) => room.points);
    const minX = Math.min(...all.map((point) => point.x));
    const minY = Math.min(...all.map((point) => point.y));
    const maxX = Math.max(...all.map((point) => point.x));
    const maxY = Math.max(...all.map((point) => point.y));
    const pad = PAD_CELLS + CLOSING_CELLS;
    const width = Math.ceil((maxX - minX) / ASSEMBLY_CELL_MM) + 2 * pad;
    const height = Math.ceil((maxY - minY) / ASSEMBLY_CELL_MM) + 2 * pad;
    if (width * height > 2_000_000) return null;
    const grid = new Grid(width, height);
    const toBoard = (column: number, row: number): Point => ({
        x: BOARD_ORIGIN_MM + (column - pad) * ASSEMBLY_CELL_MM,
        y: BOARD_ORIGIN_MM + (row - pad) * ASSEMBLY_CELL_MM,
    });
    const fromModel = (point: Point): Point => ({
        x: BOARD_ORIGIN_MM + point.x - minX,
        y: BOARD_ORIGIN_MM + point.y - minY,
    });

    // 1. The rooms as the model drew them.
    placed.forEach((room, label) => {
        const polygon = room.points.map(fromModel);
        for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
                if (grid.get(column, row) !== OUTSIDE) continue;
                const corner = toBoard(column, row);
                const centre = {
                    x: corner.x + ASSEMBLY_CELL_MM / 2,
                    y: corner.y + ASSEMBLY_CELL_MM / 2,
                };
                if (inside(polygon, centre)) grid.set(column, row, label);
            }
        }
    });
    const drawn = Int16Array.from(grid.cells);

    // 2. The flat's outline: the rooms with the walls between them, holes filled.
    const mask = Uint8Array.from(grid.cells, (label) => (label === OUTSIDE ? 0 : 1));
    const closed = filterMask(
        filterMask(mask, width, height, CLOSING_CELLS, true),
        width,
        height,
        CLOSING_CELLS,
        false,
    );
    const outside = new Uint8Array(width * height);
    const queue = [0];
    outside[0] = 1;
    while (queue.length) {
        const index = queue.pop()!;
        const column = index % width;
        const row = Math.floor(index / width);
        for (const [dc, dr] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ]) {
            const c = column + dc;
            const r = row + dr;
            if (c < 0 || r < 0 || c >= width || r >= height) continue;
            const target = r * width + c;
            if (outside[target] || closed[target]) continue;
            outside[target] = 1;
            queue.push(target);
        }
    }
    const rough = Uint8Array.from(outside, (value) => (value ? 0 : 1));
    const traced = traceLargestOutline(rough, width, height);
    if (!traced) return null;
    const simple = simplifyOutline(traced);
    if (!simple) return null;
    // The editor's outer contour: every wall at least 500 mm, at most 16 corners.
    const outline = new Uint8Array(width * height);
    for (let row = 0; row < height; row += 1)
        for (let column = 0; column < width; column += 1)
            if (inside(simple, { x: column + 0.5, y: row + 0.5 }))
                outline[row * width + column] = 1;
    grid.cells.forEach((label, index) => {
        if (!outline[index]) grid.cells[index] = OUTSIDE;
    });

    // 3. Walls between rooms split down the middle, then straightened.
    assignByRays(grid, outline, CLOSING_CELLS * 2);
    growLabels(grid, outline);
    straightenBoundaries(grid);
    removeSlivers(grid);
    straightenBoundaries(grid);
    straightenBoundaries(grid);
    removeSpecks(grid);

    // 4. The outer wall's centre line half a wall outside the rooms' faces.
    growLabels(grid, filterMask(outline, width, height, 1, true));

    // 5. Every boundary between two labels is a wall: merge unit edges into runs.
    type Run = { a: Point; b: Point; pair: [number, number] };
    const runs: Run[] = [];
    const collect = (vertical: boolean) => {
        const lines = vertical ? width + 1 : height + 1;
        const along = vertical ? height : width;
        for (let line = 0; line < lines; line += 1) {
            let start = -1;
            let current = "";
            const flush = (end: number) => {
                if (start < 0) return;
                const [first, second] = current.split("|").map(Number);
                const a = vertical ? toBoard(line, start) : toBoard(start, line);
                const b = vertical ? toBoard(line, end) : toBoard(end, line);
                runs.push({ a, b, pair: [first, second] });
                start = -1;
            };
            for (let step = 0; step <= along; step += 1) {
                let key = "";
                if (step < along) {
                    const before = vertical ? grid.get(line - 1, step) : grid.get(step, line - 1);
                    const after = vertical ? grid.get(line, step) : grid.get(step, line);
                    if (before !== after)
                        key = `${Math.min(before, after)}|${Math.max(before, after)}`;
                }
                if (key !== current) {
                    flush(step);
                    if (key) start = step;
                    current = key;
                }
            }
        }
    };
    collect(true);
    collect(false);

    // 6. Split runs where another run ends on them, so the graph has its T joints.
    const nodes = runs.flatMap((run) => [run.a, run.b]);
    const pieces = runs.flatMap((run) => {
        const vertical = run.a.x === run.b.x;
        const low = vertical ? Math.min(run.a.y, run.b.y) : Math.min(run.a.x, run.b.x);
        const high = vertical ? Math.max(run.a.y, run.b.y) : Math.max(run.a.x, run.b.x);
        const cuts = Array.from(
            new Set(
                nodes
                    .filter((node) =>
                        vertical
                            ? node.x === run.a.x && node.y > low && node.y < high
                            : node.y === run.a.y && node.x > low && node.x < high,
                    )
                    .map((node) => (vertical ? node.y : node.x)),
            ),
        ).sort((first, second) => first - second);
        const stops = [low, ...cuts, high];
        return stops.slice(0, -1).map((from, index) => ({
            start: vertical ? { x: run.a.x, y: from } : { x: from, y: run.a.y },
            end: vertical
                ? { x: run.a.x, y: stops[index + 1] }
                : { x: stops[index + 1], y: run.a.y },
            pair: run.pair,
        }));
    });

    // 7. A partition is as thick as the gap the model left between the two rooms.
    const gapOf = new Map<string, number>();
    const thickness = (pair: [number, number], piece: { start: Point; end: Point }) => {
        const key = pair.join("|");
        const known = gapOf.get(key);
        if (known !== undefined) return known;
        const vertical = piece.start.x === piece.end.x;
        const middle = {
            x: (piece.start.x + piece.end.x) / 2,
            y: (piece.start.y + piece.end.y) / 2,
        };
        const column = Math.round((middle.x - BOARD_ORIGIN_MM) / ASSEMBLY_CELL_MM) + pad;
        const row = Math.round((middle.y - BOARD_ORIGIN_MM) / ASSEMBLY_CELL_MM) + pad;
        // The gap straight across the wall: from one room's face to the other's.
        const drawnAt = (c: number, r: number) =>
            c < 0 || r < 0 || c >= width || r >= height ? OUTSIDE : drawn[r * width + c];
        const reachOut = (direction: number) => {
            for (let step = 0; step <= CLOSING_CELLS * 2; step += 1) {
                const c = vertical ? column + direction * step - (direction < 0 ? 1 : 0) : column;
                const r = vertical ? row : row + direction * step - (direction < 0 ? 1 : 0);
                if (drawnAt(c, r) !== OUTSIDE) return step;
            }
            return null;
        };
        const before = reachOut(-1);
        const after = reachOut(1);
        const gap = before === null || after === null ? 2 : before + after;
        const value = Math.min(300, Math.max(50, gap * ASSEMBLY_CELL_MM));
        gapOf.set(key, value);
        return value;
    };
    // One straight wall line has one thickness, or the rooms along it get steps
    // the planner cannot furnish: the median of its pieces' gaps.
    const gaps = pieces.map((piece) =>
        piece.pair[0] === OUTSIDE ? 0 : thickness(piece.pair, piece),
    );
    const lineOf = pieces.map((_, index) => index);
    const root = (index: number): number =>
        lineOf[index] === index ? index : (lineOf[index] = root(lineOf[index]));
    pieces.forEach((piece, index) => {
        if (!gaps[index]) return;
        pieces.forEach((other, otherIndex) => {
            if (otherIndex <= index || !gaps[otherIndex]) return;
            const vertical = piece.start.x === piece.end.x;
            const sameLine = vertical
                ? other.start.x === other.end.x && other.start.x === piece.start.x
                : other.start.y === other.end.y && other.start.y === piece.start.y;
            const touching = [piece.start, piece.end].some((point) =>
                [other.start, other.end].some((end) => end.x === point.x && end.y === point.y),
            );
            if (sameLine && touching) lineOf[root(otherIndex)] = root(index);
        });
    });
    const lineThickness = new Map<number, number>();
    pieces.forEach((_, index) => {
        if (!gaps[index]) return;
        const line = root(index);
        if (lineThickness.has(line)) return;
        const members = pieces
            .map((__, other) => other)
            .filter((other) => gaps[other] && root(other) === line)
            .map((other) => gaps[other])
            .sort((first, second) => first - second);
        lineThickness.set(line, Math.round(members[Math.floor(members.length / 2)] / 50) * 50);
    });
    const thicknessOf = (index: number) =>
        gaps[index] ? Math.max(50, lineThickness.get(root(index)) ?? 100) : 0;
    // Partitions keep their centre-line ends so the wall graph stays connected;
    // the corner squares they leave bare are cut off when a room is furnished.
    const segments: DrawWallSegment[] = pieces.map((piece, index) => ({
        id: `wall-${index + 1}`,
        start: piece.start,
        end: piece.end,
        ...(gaps[index] ? { thickness: thicknessOf(index) } : {}),
    }));

    // 8. Each room keeps its name, kind and a point inside it to find its region again.
    const assembled: AssembledRoom[] = placed.flatMap((room, label) => {
        let best: Point | null = null;
        let bestDepth = -1;
        for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
                if (grid.get(column, row) !== label) continue;
                // The cell deepest inside the room, away from every wall.
                let depth = 0;
                while (
                    depth < 40 &&
                    grid.get(column + depth + 1, row) === label &&
                    grid.get(column - depth - 1, row) === label &&
                    grid.get(column, row + depth + 1) === label &&
                    grid.get(column, row - depth - 1) === label
                )
                    depth += 1;
                if (depth > bestDepth) {
                    bestDepth = depth;
                    const corner = toBoard(column, row);
                    best = {
                        x: corner.x + ASSEMBLY_CELL_MM / 2,
                        y: corner.y + ASSEMBLY_CELL_MM / 2,
                    };
                }
            }
        }
        if (!best) return [];
        const source = rooms[room.source];
        const kind = roomKindFromName(source.name);
        return [
            {
                source: room.source,
                name: source.name,
                label: planRoomLabel(source.name),
                ...(kind ? { kind } : {}),
                inside: best,
            },
        ];
    });

    const openings: AssembledOpening[] = placed.flatMap((room) => {
        const source = rooms[room.source];
        return source.reading.openings.map((opening) => ({
            source: room.source,
            kind: opening.kind,
            from: fromModel(opening.from),
            to: fromModel(opening.to),
        }));
    });

    return { segments, rooms: assembled, openings, skipped };
};
