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
/** Steps in a wall up to this many cells (200 mm) are the model's noise, not the building. */
const STRAIGHTEN_CELLS = 4;

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
 * Pulls each boundary between two labels onto one line where the model drew
 * neighbouring faces up to 200 mm apart: such a step in a wall is noise.
 */
const straightenBoundaries = (grid: Grid) => {
    for (const vertical of [true, false]) {
        const lines = vertical ? grid.height : grid.width;
        const across = vertical ? grid.width : grid.height;
        const at = (line: number, position: number) =>
            vertical ? grid.get(position, line) : grid.get(line, position);
        const put = (line: number, position: number, value: number) =>
            vertical ? grid.set(position, line, value) : grid.set(line, position, value);
        // Boundaries by (before, after) label pair: where along each line they fall.
        const pairs = new Map<string, { line: number; position: number }[]>();
        for (let line = 0; line < lines; line += 1) {
            for (let position = 1; position < across; position += 1) {
                const before = at(line, position - 1);
                const after = at(line, position);
                if (before === after) continue;
                const key = `${before}|${after}`;
                pairs.set(key, [...(pairs.get(key) ?? []), { line, position }]);
            }
        }
        pairs.forEach((points, key) => {
            const [before, after] = key.split("|").map(Number);
            const positions = points.map((point) => point.position).sort((a, b) => a - b);
            const median = positions[Math.floor(positions.length / 2)];
            for (const { line, position } of points) {
                if (position === median || Math.abs(position - median) > STRAIGHTEN_CELLS) continue;
                if (position < median) {
                    for (let p = position; p < median; p += 1)
                        if (at(line, p) === after) put(line, p, before);
                } else {
                    for (let p = median; p < position; p += 1)
                        if (at(line, p) === before) put(line, p, after);
                }
            }
        });
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
    growLabels(grid, outline);
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
        let gap = 0;
        for (let step = -CLOSING_CELLS * 2; step <= CLOSING_CELLS * 2; step += 1) {
            const c = vertical ? column + step : column;
            const r = vertical ? row : row + step;
            if (c < 0 || r < 0 || c >= width || r >= height) continue;
            if (drawn[r * width + c] === OUTSIDE) gap += 1;
        }
        const value = Math.min(400, Math.max(50, gap * ASSEMBLY_CELL_MM));
        gapOf.set(key, value);
        return value;
    };
    const segments: DrawWallSegment[] = pieces.map((piece, index) => ({
        id: `wall-${index + 1}`,
        start: piece.start,
        end: piece.end,
        ...(piece.pair[0] === OUTSIDE ? {} : { thickness: thickness(piece.pair, piece) }),
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
