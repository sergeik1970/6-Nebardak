import { getRoomPartitionSegments, getRoomVertices, pointInsideRoom } from "./room-geometry";
import type { Room, RoomRegionMetadata, RoomRegionsState } from "./types";

type Point = { x: number; y: number };

interface RegionCell {
    xIndex: number;
    yIndex: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** A computed usable region, suitable for a canvas label but never persisted directly. */
export interface DrawRoomRegion {
    signature: string;
    name: string;
    areaSquareMillimeters: number;
    center: Point;
    bounds: { left: number; top: number; right: number; bottom: number };
    /** Largest uninterrupted clear cell; canvas labels must remain inside it. */
    labelBounds: { left: number; top: number; right: number; bottom: number };
    /**
     * Maximal straight pieces of the region's clear outline. Each is a face
     * of a wall or partition as seen from inside this region, so a room's own
     * dimensions can be taken from it instead of from the whole contour.
     */
    clearEdges: RegionClearEdge[];
}

export interface RegionClearEdge {
    start: Point;
    end: Point;
    /** Unit normal pointing from the face into the region. */
    inward: Point;
}

const REGION_NAME_MAX_LENGTH = 80;
const REGION_SIGNATURE_MAX_LENGTH = 12_000;

const uniqueSorted = (values: number[]) =>
    Array.from(new Set(values.filter(Number.isFinite))).sort((first, second) => first - second);

const isMetadataItem = (value: unknown): value is RoomRegionMetadata =>
    Boolean(
        value &&
            typeof value === "object" &&
            typeof (value as RoomRegionMetadata).signature === "string" &&
            typeof (value as RoomRegionMetadata).name === "string",
    );

/**
 * Metadata must never invalidate a complete room drawing. Readers call this
 * normalizer to retain only safe names and leave physical geometry untouched.
 */
export const normalizeRoomRegionsState = (input: unknown): RoomRegionsState | undefined => {
    if (!input || typeof input !== "object" || (input as RoomRegionsState).version !== 1) {
        return undefined;
    }
    const source = (input as RoomRegionsState).items;
    if (!Array.isArray(source)) return undefined;

    const seen = new Set<string>();
    const items = source.flatMap((candidate) => {
        if (!isMetadataItem(candidate)) return [];
        const signature = candidate.signature.trim();
        const name = candidate.name.trim().replace(/\s+/g, " ");
        if (
            !signature ||
            signature.length > REGION_SIGNATURE_MAX_LENGTH ||
            !name ||
            name.length > REGION_NAME_MAX_LENGTH ||
            seen.has(signature)
        ) {
            return [];
        }
        seen.add(signature);
        return [{ signature, name }];
    });

    return { version: 1, items };
};

const cellKey = (xIndex: number, yIndex: number) => `${xIndex}:${yIndex}`;

/**
 * Collects the cell sides that face something other than the region itself
 * and joins contiguous collinear sides that look the same way. A partition
 * stub inside a room therefore yields its two long faces and its end.
 */
const getRegionClearEdges = (cellsInRegion: RegionCell[]): RegionClearEdge[] => {
    const own = new Set(cellsInRegion.map((cell) => cellKey(cell.xIndex, cell.yIndex)));
    const pieces = new Map<string, { from: number; to: number; line: number; inward: Point }[]>();
    const add = (vertical: boolean, line: number, from: number, to: number, inward: Point) => {
        const key = `${vertical ? "v" : "h"}:${line}:${inward.x}:${inward.y}`;
        const list = pieces.get(key) ?? [];
        list.push({ from, to, line, inward });
        pieces.set(key, list);
    };
    cellsInRegion.forEach((cell) => {
        if (!own.has(cellKey(cell.xIndex, cell.yIndex - 1)))
            add(false, cell.top, cell.left, cell.right, { x: 0, y: 1 });
        if (!own.has(cellKey(cell.xIndex, cell.yIndex + 1)))
            add(false, cell.bottom, cell.left, cell.right, { x: 0, y: -1 });
        if (!own.has(cellKey(cell.xIndex - 1, cell.yIndex)))
            add(true, cell.left, cell.top, cell.bottom, { x: 1, y: 0 });
        if (!own.has(cellKey(cell.xIndex + 1, cell.yIndex)))
            add(true, cell.right, cell.top, cell.bottom, { x: -1, y: 0 });
    });

    const edges: RegionClearEdge[] = [];
    pieces.forEach((list, key) => {
        const vertical = key.startsWith("v");
        list.sort((first, second) => first.from - second.from);
        let current = { ...list[0] };
        const flush = () =>
            edges.push(
                vertical
                    ? {
                          start: { x: current.line, y: current.from },
                          end: { x: current.line, y: current.to },
                          inward: current.inward,
                      }
                    : {
                          start: { x: current.from, y: current.line },
                          end: { x: current.to, y: current.line },
                          inward: current.inward,
                      },
            );
        list.slice(1).forEach((piece) => {
            if (piece.from === current.to) {
                current.to = piece.to;
                return;
            }
            flush();
            current = { ...piece };
        });
        flush();
    });
    return edges.sort(
        (first, second) =>
            first.start.y - second.start.y ||
            first.start.x - second.start.x ||
            first.end.y - second.end.y ||
            first.end.x - second.end.x,
    );
};

/**
 * Region detection works from the same orthogonal room and partition geometry
 * as validation. Coordinate compression keeps the result exact for the 50 mm
 * drafting lattice instead of rasterising an arbitrary canvas into pixels.
 */
export const getDrawRoomRegions = (room: Room): DrawRoomRegion[] => {
    const vertices = getRoomVertices(room);
    if (vertices.length < 3) return [];
    const partitions = room.partitions ?? [];
    const xCoordinates = vertices.map((vertex) => vertex.x);
    const yCoordinates = vertices.map((vertex) => vertex.y);

    partitions.forEach((partition) => {
        const vertical = partition.start.x === partition.end.x;
        const half = partition.thickness / 2;
        xCoordinates.push(partition.start.x, partition.end.x);
        yCoordinates.push(partition.start.y, partition.end.y);
        if (vertical) xCoordinates.push(partition.start.x - half, partition.start.x + half);
        else yCoordinates.push(partition.start.y - half, partition.start.y + half);
    });

    const xs = uniqueSorted(xCoordinates);
    const ys = uniqueSorted(yCoordinates);
    if (xs.length < 2 || ys.length < 2) return [];

    const partitionRects = getRoomPartitionSegments(room).map((segment) => {
        const partition = partitions.find((candidate) => candidate.id === segment.id);
        if (!partition) return null;
        const half = partition.thickness / 2;
        return segment.orientation === "vertical"
            ? {
                  left: segment.start.x - half,
                  right: segment.start.x + half,
                  top: Math.min(segment.start.y, segment.end.y),
                  bottom: Math.max(segment.start.y, segment.end.y),
              }
            : {
                  left: Math.min(segment.start.x, segment.end.x),
                  right: Math.max(segment.start.x, segment.end.x),
                  top: segment.start.y - half,
                  bottom: segment.start.y + half,
              };
    });

    const cells = new Map<string, RegionCell>();
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
        for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
            const left = xs[xIndex];
            const right = xs[xIndex + 1];
            const top = ys[yIndex];
            const bottom = ys[yIndex + 1];
            if (right <= left || bottom <= top) continue;
            const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
            const insidePartition = partitionRects.some(
                (rect) =>
                    rect &&
                    center.x > rect.left &&
                    center.x < rect.right &&
                    center.y > rect.top &&
                    center.y < rect.bottom,
            );
            if (!insidePartition && pointInsideRoom(room, center)) {
                cells.set(cellKey(xIndex, yIndex), { xIndex, yIndex, left, right, top, bottom });
            }
        }
    }

    const metadataBySignature = new Map(
        normalizeRoomRegionsState(room.regions)?.items.map((item) => [item.signature, item.name]),
    );
    const visited = new Set<string>();
    const components: RegionCell[][] = [];
    for (const [key, cell] of Array.from(cells.entries())) {
        if (visited.has(key)) continue;
        const component: RegionCell[] = [];
        const queue = [cell];
        visited.add(key);
        while (queue.length) {
            const current = queue.shift();
            if (!current) continue;
            component.push(current);
            [
                [current.xIndex - 1, current.yIndex],
                [current.xIndex + 1, current.yIndex],
                [current.xIndex, current.yIndex - 1],
                [current.xIndex, current.yIndex + 1],
            ].forEach(([xIndex, yIndex]) => {
                const neighborKey = cellKey(xIndex, yIndex);
                const neighbor = cells.get(neighborKey);
                if (neighbor && !visited.has(neighborKey)) {
                    visited.add(neighborKey);
                    queue.push(neighbor);
                }
            });
        }
        components.push(component);
    }

    const raw = components.map((cellsInRegion) => {
        const signature = `r1:${cellsInRegion
            .map((cell) => `${cell.left},${cell.top},${cell.right},${cell.bottom}`)
            .sort()
            .join(";")}`;
        const areaSquareMillimeters = cellsInRegion.reduce(
            (total, cell) => total + (cell.right - cell.left) * (cell.bottom - cell.top),
            0,
        );
        const bounds = cellsInRegion.reduce(
            (result, cell) => ({
                left: Math.min(result.left, cell.left),
                right: Math.max(result.right, cell.right),
                top: Math.min(result.top, cell.top),
                bottom: Math.max(result.bottom, cell.bottom),
            }),
            {
                left: Number.POSITIVE_INFINITY,
                right: Number.NEGATIVE_INFINITY,
                top: Number.POSITIVE_INFINITY,
                bottom: Number.NEGATIVE_INFINITY,
            },
        );
        const labelCell = [...cellsInRegion].sort(
            (first, second) =>
                (second.right - second.left) * (second.bottom - second.top) -
                (first.right - first.left) * (first.bottom - first.top),
        )[0];
        return {
            signature,
            areaSquareMillimeters,
            center: {
                x: (labelCell.left + labelCell.right) / 2,
                y: (labelCell.top + labelCell.bottom) / 2,
            },
            bounds,
            labelBounds: {
                left: labelCell.left,
                top: labelCell.top,
                right: labelCell.right,
                bottom: labelCell.bottom,
            },
            clearEdges: getRegionClearEdges(cellsInRegion),
        };
    });

    return raw
        .sort(
            (first, second) =>
                first.center.y - second.center.y ||
                first.center.x - second.center.x ||
                first.signature.localeCompare(second.signature),
        )
        .map((region, index) => ({
            ...region,
            name: metadataBySignature.get(region.signature) ?? `Помещение ${index + 1}`,
        }));
};

/** Materializes exactly the derived, current signatures for safe persistence/export. */
export const materializeRoomRegionsState = (room: Room): RoomRegionsState => ({
    version: 1,
    items: getDrawRoomRegions(room).map(({ signature, name }) => ({ signature, name })),
});
