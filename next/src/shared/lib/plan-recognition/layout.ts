import type { ApartmentRoomReading } from "./apartment";

type Point = { x: number; y: number };

const CELL_MM = 50;

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

/** How the model placed the rooms relative to each other. */
export interface LayoutCheck {
    /** Area covered by two or more rooms, as a share of the area rooms cover. */
    overlap: number;
    /** Rooms that overlap another by more than 5 % of their own area. */
    overlappingRooms: string[];
    /** The rooms' bounding box, m², and the rooms' total area: their ratio hints at gaps. */
    boundsArea: number;
    roomsArea: number;
}

/**
 * Lays the measured rooms on a 50 mm grid in the shared frame the model was
 * asked for. Rooms that sit on top of each other mean the model put them in
 * the wrong place; walls between neighbours leave thin uncovered strips.
 */
export const checkLayout = (rooms: ApartmentRoomReading[]): LayoutCheck => {
    const measured = rooms.filter((room) => room.measured && room.reading.contour.length >= 3);
    const points = measured.flatMap((room) => room.reading.contour);
    if (!points.length) return { overlap: 0, overlappingRooms: [], boundsArea: 0, roomsArea: 0 };
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const columns = Math.ceil((maxX - minX) / CELL_MM);
    const rows = Math.ceil((maxY - minY) / CELL_MM);
    // Guard against a model answer in the wrong units blowing up the grid.
    if (columns * rows > 4_000_000) {
        return { overlap: 1, overlappingRooms: [], boundsArea: 0, roomsArea: 0 };
    }
    const owners = new Uint8Array(columns * rows);
    const cellsOf = measured.map((room) => {
        const contour = room.reading.contour;
        const left = Math.floor((Math.min(...contour.map((p) => p.x)) - minX) / CELL_MM);
        const right = Math.ceil((Math.max(...contour.map((p) => p.x)) - minX) / CELL_MM);
        const top = Math.floor((Math.min(...contour.map((p) => p.y)) - minY) / CELL_MM);
        const bottom = Math.ceil((Math.max(...contour.map((p) => p.y)) - minY) / CELL_MM);
        const cells: number[] = [];
        for (let row = top; row < bottom; row += 1) {
            for (let column = left; column < right; column += 1) {
                const centre = {
                    x: minX + (column + 0.5) * CELL_MM,
                    y: minY + (row + 0.5) * CELL_MM,
                };
                if (inside(contour, centre)) cells.push(row * columns + column);
            }
        }
        cells.forEach((cell) => (owners[cell] = Math.min(255, owners[cell] + 1)));
        return cells;
    });
    let covered = 0;
    let doubled = 0;
    owners.forEach((count) => {
        if (count) covered += 1;
        if (count > 1) doubled += 1;
    });
    const overlappingRooms = measured
        .filter((room, index) => {
            const cells = cellsOf[index];
            return (
                cells.length > 0 &&
                cells.filter((cell) => owners[cell] > 1).length / cells.length > 0.05
            );
        })
        .map((room) => room.name);
    const cellArea = (CELL_MM * CELL_MM) / 1_000_000;
    return {
        overlap: covered ? doubled / covered : 0,
        overlappingRooms,
        boundsArea: Math.round(((maxX - minX) * (maxY - minY)) / 10_000) / 100,
        roomsArea: Math.round(covered * cellArea * 100) / 100,
    };
};

const COLOURS = ["#e8d5b7", "#c9dfe8", "#d9e8c9", "#e8c9d5", "#d5c9e8", "#e8e2c9", "#c9e8df"];

/** The rooms as the model placed them, for comparing with the sheet by eye. */
export const renderLayout = (rooms: ApartmentRoomReading[], widthPx = 1200): string => {
    const measured = rooms.filter((room) => room.measured && room.reading.contour.length >= 3);
    const points = measured.flatMap((room) => room.reading.contour);
    if (!points.length) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="50" font-family="Arial" font-size="16">Нет комнат с размерами</text></svg>`;
    }
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const margin = 30;
    const scale = (widthPx - 2 * margin) / Math.max(1, maxX - minX);
    const heightPx = Math.round((maxY - minY) * scale + 2 * margin);
    const px = (point: Point) =>
        `${(margin + (point.x - minX) * scale).toFixed(1)},${(margin + (point.y - minY) * scale).toFixed(1)}`;
    const shapes = measured.map((room, index) => {
        const contour = room.reading.contour;
        const centre = {
            x: contour.reduce((sum, point) => sum + point.x, 0) / contour.length,
            y: contour.reduce((sum, point) => sum + point.y, 0) / contour.length,
        };
        const [cx, cy] = px(centre).split(",");
        const label = room.name.replace(/[<&>]/g, "");
        return `<polygon points="${contour.map(px).join(" ")}" fill="${COLOURS[index % COLOURS.length]}" fill-opacity="0.75" stroke="#333" stroke-width="1.5"/><text x="${cx}" y="${cy}" font-family="Arial" font-size="14" text-anchor="middle">${label}</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"><rect width="100%" height="100%" fill="#fff"/>${shapes.join("")}</svg>`;
};
