/**
 * Typed wall lengths, AutoCAD style: a number means the clear length of the
 * wall inside the room, as a tape measure reads it, while the wall graph runs
 * along wall centres. Which face is the inner one is only known from how the
 * chain turns, so the first turn decides the room's side and the corner a
 * wall ends in is settled when the next wall leaves it.
 */

export interface WallEntryPoint {
    x: number;
    y: number;
}

export type WallSide = 1 | -1;

/** What the chain remembers about the wall it continues from. */
export interface WallChainStep {
    direction: WallEntryPoint;
    /** The room's side of the chain, once a turn has shown it. */
    side: WallSide | null;
    /** Only a typed wall assumed its end corner; a clicked one was placed as drawn. */
    typed: boolean;
}

export const MAX_TYPED_WALL_DIGITS = 5;

export const wallDirection = (from: WallEntryPoint, to: WallEntryPoint): WallEntryPoint | null => {
    const x = Math.sign(to.x - from.x);
    const y = Math.sign(to.y - from.y);
    return (x === 0) === (y === 0) ? null : { x, y };
};

const cornerTurn = (previous: WallEntryPoint, next: WallEntryPoint) =>
    Math.sign(previous.x * next.y - previous.y * next.x);

const roomSide = (previous: WallChainStep, direction: WallEntryPoint): WallSide | null =>
    previous.side ?? ((cornerTurn(previous.direction, direction) || null) as WallSide | null);

export const nextWallChainStep = (
    previous: WallChainStep | null,
    direction: WallEntryPoint,
    typed: boolean,
): WallChainStep => ({
    direction,
    side: previous ? roomSide(previous, direction) : null,
    typed,
});

const along = (point: WallEntryPoint, direction: WallEntryPoint, distance: number) => ({
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
});

export interface TypedWallRequest {
    start: WallEntryPoint;
    direction: WallEntryPoint;
    innerLength: number;
    thickness: number;
    /** A closed room is being divided, so this is a partition, not the contour. */
    partition: boolean;
    /** The wall starts on an existing wall. */
    attached: boolean;
    previous: WallChainStep | null;
}

export interface TypedWall {
    /** Differs from the requested start when the previous wall had to be trimmed. */
    start: WallEntryPoint;
    end: WallEntryPoint;
}

/** Centre-line points of a wall whose clear length was typed. */
export const resolveTypedWall = ({
    start,
    direction,
    innerLength,
    thickness,
    partition,
    attached,
    previous,
}: TypedWallRequest): TypedWall => {
    const half = thickness / 2;
    if (partition) {
        return { start, end: along(start, direction, innerLength + (attached ? half : 0)) };
    }
    if (!previous) {
        return { start, end: along(start, direction, innerLength + thickness) };
    }
    // A corner that turns towards the room takes half a wall off the clear
    // length at each side of it; one that turns away adds it instead.
    const turn = cornerTurn(previous.direction, direction);
    const side = roomSide(previous, direction);
    const offset = turn === 0 ? 0 : turn === side ? half : -half;
    const corner = previous.typed ? along(start, previous.direction, offset - half) : start;
    return { start: corner, end: along(corner, direction, innerLength + half + offset) };
};

/** Moves the end of the wall the chain continues from; null if it is no longer there. */
export const moveWallEnd = <Segment extends { start: WallEntryPoint; end: WallEntryPoint }>(
    segments: Segment[],
    end: WallEntryPoint,
    direction: WallEntryPoint,
    nextEnd: WallEntryPoint,
): Segment[] | null => {
    const same = (first: WallEntryPoint, second: WallEntryPoint) =>
        first.x === second.x && first.y === second.y;
    const arrives = (from: WallEntryPoint, to: WallEntryPoint) => {
        const heading = wallDirection(from, to);
        return Boolean(heading) && same(to, end) && same(heading!, direction);
    };
    let moved = false;
    const next = segments.map((segment) => {
        if (arrives(segment.start, segment.end)) {
            moved = true;
            return { ...segment, end: nextEnd };
        }
        if (arrives(segment.end, segment.start)) {
            moved = true;
            return { ...segment, start: nextEnd };
        }
        return segment;
    });
    return moved ? next : null;
};
