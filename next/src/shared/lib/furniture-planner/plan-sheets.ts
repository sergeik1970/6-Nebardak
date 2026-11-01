import {
    CEILING_HEIGHT_MM,
    getDoorHeight,
    getWindowHeight,
    getWindowSillHeight,
} from "./opening-heights";
import {
    getDoorOpeningDepth,
    getPartitionMaterial,
    getRadiatorBody,
    isHingedDoor,
} from "./geometry";
import { getDrawRoomWallFaceContours } from "./draw-room-wall-graph";
import type { PlanSpecification, PlanSpecificationItem } from "./plan-export";
import { getRoomBoundarySegments, getRoomSegment, getRoomVertices } from "./room-geometry";
import { getDrawRoomRegions, type DrawRoomRegion } from "./room-regions";
import type { DoorOpening, Rect, Room, WindowOpening } from "./types";

/**
 * The drawing set a designer hands over: A3 sheets with a frame and a title
 * block, built as vector SVG in paper millimetres. Plans are drawn at a
 * standard scale; tables follow them.
 */

type Point = { x: number; y: number };
type Segment = NonNullable<ReturnType<typeof getRoomSegment>>;

export interface PlanSheet {
    /** What goes into the title block, e.g. «Обмерный план». */
    name: string;
    width: number;
    height: number;
    svg: string;
}

export interface PlanSheetOptions {
    /** SVG of one piece in its own millimetre frame; a plain outline without it. */
    furnitureArt?: (item: PlanSpecificationItem) => string | null;
}

export const A3_LONG_MM = 420;
export const A3_SHORT_MM = 297;
/** Binding margin on the left; the other three sides are narrow. */
export const FRAME_LEFT_MM = 20;
export const FRAME_MARGIN_MM = 5;
export const STAMP_WIDTH_MM = 185;
export const STAMP_HEIGHT_MM = 55;
/** A door leaf is taken this much smaller than its opening. */
export const DOOR_LEAF_CLEARANCE_MM = 100;
/** At this opening or narrower, bulky furniture only gets through taken apart. */
export const NARROW_DOOR_OPENING_MM = 700;
export const NARROW_DOOR_WARNING =
    "Габаритная мебель (диваны, кровати, шкафы) может пройти только в разобранном виде. Обратите внимание при закупке.";
/** With this few doors, doors and windows share one sheet. */
export const MAX_DOORS_ON_SHARED_SHEET = 6;

const PLAN_SCALES = [20, 25, 50, 75, 100, 150, 200];
const INK = "#1a1a1a";
const THIN = 0.13;
const MAIN = 0.35;
const TEXT = 3;
const SMALL = 2.5;
const BEARING_FILL = "#d4d4d4";
const NON_BEARING_FILL = "#6f6f6f";
const RADIATOR = "#d0342c";
const DIMENSION_GAP = 7;
const DIMENSION_TIER = 6;
/** Inside a room: the opening tag first, then the room's own dimension line. */
const OPENING_TAG_INSET = 3.6;
const ROOM_DIMENSION_INSET = 9;
/** Room left around a plan for its two tiers of dimensions. */
const DIMENSION_MARGIN = DIMENSION_GAP + DIMENSION_TIER + 6;

const n = (value: number) => Math.round(value * 100) / 100;

const escapeXml = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const line = (from: Point, to: Point, width = THIN, color = INK, dash?: string) =>
    `<line x1="${n(from.x)}" y1="${n(from.y)}" x2="${n(to.x)}" y2="${n(to.y)}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;

const box = (x: number, y: number, width: number, height: number, attributes: string) =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" ${attributes}/>`;

const text = (
    x: number,
    y: number,
    value: string,
    {
        size = TEXT,
        anchor = "start",
        weight = 400,
        rotate,
        color,
    }: {
        size?: number;
        anchor?: "start" | "middle" | "end";
        weight?: number;
        rotate?: number;
        color?: string;
    } = {},
) =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}"${color ? ` fill="${color}"` : ""}${rotate ? ` transform="rotate(${rotate} ${n(x)} ${n(y)})"` : ""}>${escapeXml(value)}</text>`;

const estimateTextWidth = (value: string, size: number) => value.length * size * 0.56;

const wrapText = (value: string, width: number, size: number) => {
    const lines: string[] = [];
    let current = "";
    for (const word of value.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (current && estimateTextWidth(next, size) > width) {
            lines.push(current);
            current = word;
        } else current = next;
    }
    if (current) lines.push(current);
    return lines;
};

const formatArea = (squareMillimeters: number) =>
    (squareMillimeters / 1_000_000).toLocaleString("ru-RU", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });

/* Title block ------------------------------------------------------------ */

/** The designer's GOST form: only the plan's name is filled in, the rest stays blank. */
const drawStamp = (right: number, bottom: number, name: string) => {
    const x = right - STAMP_WIDTH_MM;
    const y = bottom - STAMP_HEIGHT_MM;
    const parts: string[] = [
        box(
            x,
            y,
            STAMP_WIDTH_MM,
            STAMP_HEIGHT_MM,
            `fill="#fff" stroke="${INK}" stroke-width="${MAIN}"`,
        ),
    ];
    const across = (at: number, from: number, to: number, width = THIN) =>
        parts.push(line({ x: x + from, y: y + at }, { x: x + to, y: y + at }, width));
    const down = (at: number, from: number, to: number, width = MAIN) =>
        parts.push(line({ x: x + at, y: y + from }, { x: x + at, y: y + to }, width));

    // Revision columns, eleven 5 mm rows.
    down(7, 0, 25);
    [17, 40, 55, 65].forEach((at) => down(at, 0, STAMP_HEIGHT_MM));
    for (let row = 1; row < 11; row += 1)
        across(row * 5, 0, 65, row === 4 || row === 5 ? MAIN : THIN);
    down(135, 0, STAMP_HEIGHT_MM);
    across(15, 65, 185, MAIN);
    across(40, 65, 185, MAIN);
    across(20, 135, 185);
    across(35, 135, 185);
    down(140, 20, 35, THIN);
    down(145, 20, 35, THIN);
    down(150, 15, 35, MAIN);
    down(167, 15, 35, MAIN);
    down(155, 35, 40, THIN);

    const label = (cx: number, cy: number, value: string) =>
        parts.push(text(x + cx, y + cy, value, { size: 2, anchor: "middle" }));
    label(3.5, 23.7, "Изм.");
    label(12, 23.7, "Лист");
    label(28.5, 23.7, "№ докум.");
    label(47.5, 23.7, "Подп.");
    label(60, 23.7, "Дата");
    ["Разраб.", "Пров.", "Т.контр.", "", "Н.контр.", "Утв."].forEach((value, index) => {
        if (value) parts.push(text(x + 1, y + 28.7 + index * 5, value, { size: 2 }));
    });
    label(142.5, 18.7, "Лит.");
    label(158.5, 18.7, "Масса");
    label(176, 18.7, "Масштаб");
    label(145, 38.7, "Лист");
    label(170, 38.7, "Листов");

    // Where the sample has the project's name, the plan's name goes.
    wrapText(name, 66, 3.5).forEach((value, index) =>
        parts.push(
            text(x + 100, y + 28.5 + index * 4.5, value, {
                size: 3.5,
                anchor: "middle",
                weight: 600,
            }),
        ),
    );
    return parts.join("");
};

const frameFor = (width: number, height: number) => ({
    left: FRAME_LEFT_MM,
    top: FRAME_MARGIN_MM,
    right: width - FRAME_MARGIN_MM,
    bottom: height - FRAME_MARGIN_MM,
});

const wrapSheet = (name: string, width: number, height: number, content: string): PlanSheet => {
    const frame = frameFor(width, height);
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif" fill="${INK}">`,
        `<rect width="${width}" height="${height}" fill="#fff"/>`,
        content,
        box(
            frame.left,
            frame.top,
            frame.right - frame.left,
            frame.bottom - frame.top,
            `fill="none" stroke="${INK}" stroke-width="${THIN}"`,
        ),
        drawStamp(frame.right, frame.bottom, name),
        `</svg>`,
    ].join("");
    return { name, width, height, svg };
};

/* Plan geometry ---------------------------------------------------------- */

interface PlanView {
    /** Paper millimetres for a plan point. */
    at: (point: Point) => Point;
    /** Paper millimetres for a plan length. */
    size: (length: number) => number;
    thickness: number;
}

interface PlanLayout {
    width: number;
    height: number;
    scale: number;
    origin: Point;
}

const roomExtent = (room: Room) => {
    const thickness = room.wallThickness ?? 100;
    return {
        thickness,
        width: room.width + 2 * thickness,
        depth: room.depth + 2 * thickness,
    };
};

/** The orientation and scale that show this plan largest, above the table band. */
const choosePlanLayout = (room: Room): PlanLayout => {
    const { thickness, width, depth } = roomExtent(room);
    const candidates = [
        { width: A3_LONG_MM, height: A3_SHORT_MM },
        { width: A3_SHORT_MM, height: A3_LONG_MM },
    ].map((sheet) => {
        const frame = frameFor(sheet.width, sheet.height);
        const left = frame.left + DIMENSION_MARGIN;
        const right = frame.right - DIMENSION_MARGIN;
        const top = frame.top + DIMENSION_MARGIN;
        const bottom = frame.bottom - STAMP_HEIGHT_MM - DIMENSION_MARGIN;
        const scale =
            PLAN_SCALES.find(
                (candidate) =>
                    width / candidate <= right - left && depth / candidate <= bottom - top,
            ) ?? PLAN_SCALES[PLAN_SCALES.length - 1];
        return {
            ...sheet,
            scale,
            origin: {
                x: (left + right - width / scale) / 2 + thickness / scale,
                y: (top + bottom - depth / scale) / 2 + thickness / scale,
            },
        };
    });
    return candidates.reduce((best, candidate) =>
        candidate.scale < best.scale ? candidate : best,
    );
};

const toView = (room: Room, layout: PlanLayout): PlanView => ({
    at: (point) => ({
        x: layout.origin.x + point.x / layout.scale,
        y: layout.origin.y + point.y / layout.scale,
    }),
    size: (length) => length / layout.scale,
    thickness: room.wallThickness ?? 100,
});

/** The outside of the wall: the clear contour pushed out by one wall thickness. */
const outerContour = (room: Room, thickness: number): Point[] =>
    getDrawRoomWallFaceContours(getRoomVertices(room), 2 * thickness)?.outerFaceContour ?? [];

const pathOf = (points: Point[]) =>
    `M${points.map((point) => `${n(point.x)} ${n(point.y)}`).join("L")}Z`;

const along = (segment: Segment, offset: number): Point => {
    const unitX = (segment.end.x - segment.start.x) / segment.length;
    const unitY = (segment.end.y - segment.start.y) / segment.length;
    return { x: segment.start.x + unitX * offset, y: segment.start.y + unitY * offset };
};

const shift = (point: Point, normal: Point, distance: number): Point => ({
    x: point.x + normal.x * distance,
    y: point.y + normal.y * distance,
});

/** How far an opening's aperture reaches to each side of its segment line. */
const apertureDepth = (room: Room, opening: DoorOpening | WindowOpening) => {
    const partitionId = "partitionId" in opening ? opening.partitionId : undefined;
    if (partitionId) {
        const thickness =
            room.partitions?.find((partition) => partition.id === partitionId)?.thickness ?? 100;
        return { inside: thickness / 2, outside: thickness / 2 };
    }
    return { inside: 0, outside: room.wallThickness ?? 100 };
};

const drawWalls = (room: Room, view: PlanView) => {
    const inner = getRoomVertices(room).map(view.at);
    const outer = outerContour(room, view.thickness).map(view.at);
    const parts = [
        `<path d="${pathOf(outer)}${pathOf(inner)}" fill="${BEARING_FILL}" fill-rule="evenodd" stroke="${INK}" stroke-width="${MAIN}"/>`,
    ];
    getRoomBoundarySegments(room)
        .filter((segment) => room.nonBearingWalls?.includes(segment.id))
        .forEach((segment) => {
            const outward = { x: -segment.inwardNormal.x, y: -segment.inwardNormal.y };
            const corners = [
                segment.start,
                segment.end,
                shift(segment.end, outward, view.thickness),
                shift(segment.start, outward, view.thickness),
            ].map(view.at);
            parts.push(
                `<path d="${pathOf(corners)}" fill="${NON_BEARING_FILL}" stroke="${INK}" stroke-width="${THIN}"/>`,
            );
        });
    getPartitionMaterial(room).forEach(({ rect, loadBearing }) => {
        const corner = view.at(rect);
        parts.push(
            box(
                corner.x,
                corner.y,
                view.size(rect.width),
                view.size(rect.depth),
                `fill="${loadBearing ? BEARING_FILL : NON_BEARING_FILL}" stroke="${INK}" stroke-width="${THIN}"`,
            ),
        );
    });
    return parts.join("");
};

const drawAperture = (room: Room, view: PlanView, opening: DoorOpening | WindowOpening) => {
    const segment = getRoomSegment(room, opening);
    if (!segment) return { segment: null, svg: "" };
    const { inside, outside } = apertureDepth(room, opening);
    const from = along(segment, opening.offset);
    const to = along(segment, opening.offset + opening.width);
    const corners = [
        shift(from, segment.inwardNormal, inside),
        shift(to, segment.inwardNormal, inside),
        shift(to, segment.inwardNormal, -outside),
        shift(from, segment.inwardNormal, -outside),
    ].map(view.at);
    return {
        segment,
        svg: `<path d="${pathOf(corners)}" fill="#fff" stroke="none"/>${line(corners[0], corners[3], MAIN)}${line(corners[1], corners[2], MAIN)}`,
    };
};

const drawWindow = (room: Room, view: PlanView, window: WindowOpening) => {
    const { segment, svg } = drawAperture(room, view, window);
    if (!segment) return "";
    const outside = apertureDepth(room, window).outside;
    const from = along(segment, window.offset);
    const to = along(segment, window.offset + window.width);
    const glazing = [0, 0.5, 1].map((part) =>
        line(
            view.at(shift(from, segment.inwardNormal, -outside * part)),
            view.at(shift(to, segment.inwardNormal, -outside * part)),
            part === 0.5 ? MAIN : THIN,
        ),
    );
    return svg + glazing.join("");
};

const drawLeaf = (view: PlanView, hinge: Point, free: Point, normal: Point, depth: number) => {
    const open = shift(hinge, normal, depth);
    const [start, end, tip] = [hinge, open, free].map(view.at);
    const radius = n(view.size(depth));
    const sweep = (end.x - start.x) * (tip.y - start.y) - (end.y - start.y) * (tip.x - start.x) > 0;
    return (
        line(start, end, MAIN) +
        `<path d="M${n(end.x)} ${n(end.y)}A${radius} ${radius} 0 0 ${sweep ? 1 : 0} ${n(tip.x)} ${n(tip.y)}" fill="none" stroke="${INK}" stroke-width="${THIN}"/>`
    );
};

const swingNormal = (door: DoorOpening, segment: Segment): Point =>
    door.swingDirection === "outward"
        ? { x: -segment.inwardNormal.x, y: -segment.inwardNormal.y }
        : segment.inwardNormal;

const drawDoor = (room: Room, view: PlanView, door: DoorOpening) => {
    const { segment, svg } = drawAperture(room, view, door);
    if (!segment) return "";
    const depth = apertureDepth(room, door);
    const reach = door.swingDirection === "outward" ? depth.outside : depth.inside;
    const normal = swingNormal(door, segment);
    const base = (offset: number) => shift(along(segment, offset), normal, reach);
    const start = base(door.offset);
    const end = base(door.offset + door.width);
    if (!isHingedDoor(door)) {
        const mid = apertureDepth(room, door);
        const centre = (mid.inside - mid.outside) / 2;
        return (
            svg +
            line(
                view.at(shift(along(segment, door.offset), segment.inwardNormal, centre)),
                view.at(
                    shift(along(segment, door.offset + door.width), segment.inwardNormal, centre),
                ),
                MAIN,
            )
        );
    }
    const leaf = getDoorOpeningDepth(door);
    if (door.doorKind === "swing-double") {
        const middle = base(door.offset + door.width / 2);
        return (
            svg +
            drawLeaf(view, start, middle, normal, leaf) +
            drawLeaf(view, end, middle, normal, leaf)
        );
    }
    const [hinge, free] = door.hinge === "end" ? [end, start] : [start, end];
    return svg + drawLeaf(view, hinge, free, normal, leaf);
};

/* Dimensions ------------------------------------------------------------- */

const drawDimension = (
    from: Point,
    to: Point,
    normal: Point,
    distance: number,
    value: string,
    { extensionFrom = 0, raised = false }: { extensionFrom?: number; raised?: boolean } = {},
) => {
    const a = shift(from, normal, distance);
    const b = shift(to, normal, distance);
    const horizontal = from.y === to.y;
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    const tick = (point: Point) =>
        line({ x: point.x - 0.8, y: point.y + 0.8 }, { x: point.x + 0.8, y: point.y - 0.8 }, MAIN);
    const parts = [
        line(a, b),
        tick(a),
        tick(b),
        line(shift(from, normal, extensionFrom), shift(a, normal, 1)),
        line(shift(to, normal, extensionFrom), shift(b, normal, 1)),
    ];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // A value wider than its span sits just beyond the line, clear of the next one.
    const narrow = estimateTextWidth(value, SMALL) > length;
    const lift = (narrow && raised ? 3.2 : 0) + 0.7;
    parts.push(
        horizontal
            ? text(middle.x, middle.y - lift, value, { size: SMALL, anchor: "middle" })
            : text(middle.x - lift, middle.y, value, {
                  size: SMALL,
                  anchor: "middle",
                  rotate: -90,
              }),
    );
    return parts.join("");
};

/** Two tiers along each outer side: wall pieces and openings, then the side's clear length. */
const drawExteriorDimensions = (room: Room, view: PlanView) =>
    getRoomBoundarySegments(room)
        .map((segment) => {
            const openings = [...room.doors, ...room.windows]
                .filter((opening) => {
                    if ("partitionId" in opening && opening.partitionId) return false;
                    return getRoomSegment(room, opening)?.id === segment.id;
                })
                .sort((first, second) => first.offset - second.offset);
            const outward = { x: -segment.inwardNormal.x, y: -segment.inwardNormal.y };
            const stops = [
                0,
                ...openings.flatMap((opening) => [opening.offset, opening.offset + opening.width]),
                segment.length,
            ].filter((value, index, all) => index === 0 || value > all[index - 1]);
            const paperPoint = (offset: number) =>
                shift(view.at(along(segment, offset)), outward, view.size(view.thickness));
            const parts: string[] = [];
            const firstTier = DIMENSION_GAP;
            if (openings.length) {
                stops.slice(0, -1).forEach((stop, index) => {
                    parts.push(
                        drawDimension(
                            paperPoint(stop),
                            paperPoint(stops[index + 1]),
                            outward,
                            firstTier,
                            String(Math.round(stops[index + 1] - stop)),
                            { extensionFrom: 1, raised: index % 2 === 1 },
                        ),
                    );
                });
            }
            parts.push(
                drawDimension(
                    paperPoint(0),
                    paperPoint(segment.length),
                    outward,
                    openings.length ? firstTier + DIMENSION_TIER : firstTier,
                    String(Math.round(segment.length)),
                    { extensionFrom: 1 },
                ),
            );
            return parts.join("");
        })
        .join("");

/** Each room's own width and depth, taken along its longest clear faces. */
const drawRoomDimensions = (regions: DrawRoomRegion[], view: PlanView) =>
    regions.length < 2
        ? ""
        : regions
              .flatMap((region) => {
                  const longest = (horizontal: boolean) =>
                      region.clearEdges
                          .filter((edge) => (edge.start.y === edge.end.y) === horizontal)
                          .sort(
                              (first, second) =>
                                  Math.abs(second.end.x - second.start.x) +
                                  Math.abs(second.end.y - second.start.y) -
                                  Math.abs(first.end.x - first.start.x) -
                                  Math.abs(first.end.y - first.start.y),
                          )[0];
                  return [longest(true), longest(false)].flatMap((edge) =>
                      edge
                          ? [
                                drawDimension(
                                    view.at(edge.start),
                                    view.at(edge.end),
                                    edge.inward,
                                    ROOM_DIMENSION_INSET,
                                    String(
                                        Math.round(
                                            Math.abs(edge.end.x - edge.start.x) +
                                                Math.abs(edge.end.y - edge.start.y),
                                        ),
                                    ),
                                ),
                            ]
                          : [],
                  );
              })
              .join("");

/* Room tags and tables --------------------------------------------------- */

const regionCentre = (region: DrawRoomRegion): Point => ({
    x: (region.labelBounds.left + region.labelBounds.right) / 2,
    y: (region.labelBounds.top + region.labelBounds.bottom) / 2,
});

const drawRoomTags = (regions: DrawRoomRegion[], view: PlanView, withArea: boolean) =>
    regions
        .map((region, index) => {
            const centre = view.at(regionCentre(region));
            const tag = [
                `<circle cx="${n(centre.x)}" cy="${n(centre.y)}" r="3" fill="#fff" stroke="${INK}" stroke-width="${THIN}"/>`,
                text(centre.x, centre.y + 1.05, String(index + 1), {
                    size: TEXT,
                    anchor: "middle",
                }),
            ];
            if (withArea) {
                const area = `S: ${formatArea(region.areaSquareMillimeters)} м²`;
                tag.push(
                    text(centre.x, centre.y + 6.5, area, { size: SMALL, anchor: "middle" }),
                    text(
                        centre.x,
                        centre.y + 9.8,
                        `H: ${(CEILING_HEIGHT_MM / 1000).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} м`,
                        { size: SMALL, anchor: "middle" },
                    ),
                );
            }
            return tag.join("");
        })
        .join("");

interface TableColumn {
    title: string;
    width: number;
}

const drawTable = (
    x: number,
    y: number,
    columns: TableColumn[],
    rows: string[][],
    rowHeight = 7,
) => {
    const width = columns.reduce((sum, column) => sum + column.width, 0);
    const height = rowHeight * (rows.length + 1);
    const parts = [box(x, y, width, height, `fill="none" stroke="${INK}" stroke-width="${MAIN}"`)];
    for (let row = 1; row <= rows.length; row += 1) {
        parts.push(
            line(
                { x, y: y + row * rowHeight },
                { x: x + width, y: y + row * rowHeight },
                row === 1 ? MAIN : THIN,
            ),
        );
    }
    let left = x;
    columns.forEach((column, index) => {
        if (index) parts.push(line({ x: left, y }, { x: left, y: y + height }));
        const cellY = (row: number) => y + rowHeight * row + rowHeight / 2 + 1.05;
        parts.push(text(left + 1.5, cellY(0), column.title, { weight: 600 }));
        rows.forEach((row, rowIndex) =>
            parts.push(text(left + 1.5, cellY(rowIndex + 1), row[index] ?? "")),
        );
        left += column.width;
    });
    return { svg: parts.join(""), height };
};

/** Room list and legend, in the free band to the left of the title block. */
const drawPlanNotes = (
    width: number,
    height: number,
    regions: DrawRoomRegion[],
    legend: { fill: string; stroke?: string; label: string }[],
) => {
    const frame = frameFor(width, height);
    const available = frame.right - STAMP_WIDTH_MM - frame.left;
    const top = frame.bottom - STAMP_HEIGHT_MM;
    const parts = [
        line({ x: frame.left, y: top }, { x: frame.right - STAMP_WIDTH_MM, y: top }),
        text(frame.left + 3, top + 5, "Экспликация", { size: 3.5, weight: 600 }),
    ];
    const total = regions.reduce((sum, region) => sum + region.areaSquareMillimeters, 0);
    const rowHeight = Math.min(4.6, (STAMP_HEIGHT_MM - 13) / Math.max(1, regions.length + 1));
    const size = Math.min(TEXT, rowHeight * 0.68);
    regions.forEach((region, index) => {
        const y = top + 9.5 + index * rowHeight;
        parts.push(
            text(frame.left + 3, y, String(index + 1), { size }),
            text(frame.left + 9, y, region.name, { size }),
            text(frame.left + 64, y, formatArea(region.areaSquareMillimeters), {
                size,
                anchor: "end",
            }),
        );
    });
    parts.push(
        text(frame.left + 9, top + 9.5 + regions.length * rowHeight, "Итого, м²", {
            size,
            weight: 600,
        }),
        text(frame.left + 64, top + 9.5 + regions.length * rowHeight, formatArea(total), {
            size,
            anchor: "end",
            weight: 600,
        }),
    );
    if (available > 110 && legend.length) {
        const x = frame.left + 72;
        parts.push(text(x, top + 5, "Условные обозначения", { size: 3.5, weight: 600 }));
        legend.forEach((item, index) => {
            const y = top + 8 + index * 6;
            parts.push(
                box(
                    x,
                    y,
                    12,
                    4,
                    `fill="${item.fill}" stroke="${item.stroke ?? INK}" stroke-width="${THIN}"`,
                ),
                text(x + 15, y + 3.2, item.label),
            );
        });
    }
    return parts.join("");
};

/* Sheets ----------------------------------------------------------------- */

const openingLabel = (prefix: string, index: number) => `${prefix}${index + 1}`;

const drawOpeningTags = (room: Room, view: PlanView) => {
    const tag = (opening: DoorOpening | WindowOpening, label: string) => {
        const segment = getRoomSegment(room, opening);
        if (!segment) return "";
        const middle = along(segment, opening.offset + opening.width / 2);
        const point = shift(view.at(middle), segment.inwardNormal, OPENING_TAG_INSET);
        return text(point.x, point.y + 0.9, label, { size: SMALL, anchor: "middle", weight: 600 });
    };
    return [
        ...room.doors.map((door, index) => tag(door, openingLabel("Д", index))),
        ...room.windows.map((window, index) => tag(window, openingLabel("О", index))),
    ].join("");
};

const drawRadiators = (room: Room, view: PlanView) =>
    (room.radiators ?? [])
        .map((radiator) => {
            const body = getRadiatorBody(radiator, room);
            const corner = view.at(body);
            return box(
                corner.x,
                corner.y,
                view.size(body.width),
                view.size(body.depth),
                `fill="none" stroke="${RADIATOR}" stroke-width="${MAIN}"`,
            );
        })
        .join("");

const WALL_LEGEND = [
    { fill: BEARING_FILL, label: "Несущие стены" },
    { fill: NON_BEARING_FILL, label: "Ненесущие стены" },
    { fill: "#fff", stroke: RADIATOR, label: "Радиатор" },
];

const measurementSheet = (specification: PlanSpecification, regions: DrawRoomRegion[]) => {
    const { room } = specification;
    const layout = choosePlanLayout(room);
    const view = toView(room, layout);
    return wrapSheet(
        "Обмерный план",
        layout.width,
        layout.height,
        [
            drawWalls(room, view),
            ...room.windows.map((window) => drawWindow(room, view, window)),
            ...room.doors.map((door) => drawDoor(room, view, door)),
            drawRadiators(room, view),
            drawExteriorDimensions(room, view),
            drawRoomDimensions(regions, view),
            drawOpeningTags(room, view),
            drawRoomTags(regions, view, true),
            drawPlanNotes(layout.width, layout.height, regions, WALL_LEGEND),
        ].join(""),
    );
};

const furnitureGroupKey = (item: PlanSpecificationItem) =>
    [
        item.definitionId,
        Math.min(item.width, item.depth),
        Math.max(item.width, item.depth),
        item.roomName,
    ].join("|");

/** Same piece, size and room: one line of the schedule and one number on the plan. */
const groupFurniture = (items: PlanSpecificationItem[]) => {
    const groups = new Map<
        string,
        { item: PlanSpecificationItem; count: number; number: number }
    >();
    items.forEach((item) => {
        const key = furnitureGroupKey(item);
        const group = groups.get(key);
        if (group) group.count += 1;
        else groups.set(key, { item, count: 1, number: groups.size + 1 });
    });
    return groups;
};

const drawFurnitureItem = (
    item: PlanSpecificationItem,
    number: number,
    view: PlanView,
    layout: PlanLayout,
    art: string | null,
) => {
    const corner = view.at(item);
    const centre = {
        x: corner.x + view.size(item.width) / 2,
        y: corner.y + view.size(item.depth) / 2,
    };
    const scale = 1 / layout.scale;
    const turned = item.rotation === 90 || item.rotation === 270;
    const ownWidth = turned ? item.depth : item.width;
    const ownDepth = turned ? item.width : item.depth;
    const piece = art
        ? `<g transform="translate(${n(centre.x)} ${n(centre.y)}) rotate(${item.rotation}) scale(${scale}) translate(${-ownWidth / 2} ${-ownDepth / 2})${item.mirrored ? ` translate(${ownWidth} 0) scale(-1 1)` : ""}" fill="none" stroke="${INK}" stroke-width="${n(THIN * layout.scale)}">${art}</g>`
        : item.bodyRects
              .map((rect) => {
                  const start = view.at(rect);
                  return box(
                      start.x,
                      start.y,
                      view.size(rect.width),
                      view.size(rect.depth),
                      `fill="#fff" stroke="${INK}" stroke-width="${THIN}"`,
                  );
              })
              .join("");
    // Square, so a piece's number is not read as a room's round one.
    const tag =
        box(
            centre.x - 2.2,
            centre.y - 2.2,
            4.4,
            4.4,
            `fill="#fff" stroke="${INK}" stroke-width="${THIN}"`,
        ) + text(centre.x, centre.y + 0.85, String(number), { size: SMALL, anchor: "middle" });
    return piece + tag;
};

const furnitureSheet = (
    specification: PlanSpecification,
    regions: DrawRoomRegion[],
    options: PlanSheetOptions,
) => {
    const { room, items } = specification;
    const layout = choosePlanLayout(room);
    const view = toView(room, layout);
    const groups = groupFurniture(items);
    return wrapSheet(
        "План мебели",
        layout.width,
        layout.height,
        [
            drawWalls(room, view),
            ...room.windows.map((window) => drawWindow(room, view, window)),
            ...room.doors.map((door) => drawDoor(room, view, door)),
            ...items.map((item) =>
                drawFurnitureItem(
                    item,
                    groups.get(furnitureGroupKey(item))?.number ?? 0,
                    view,
                    layout,
                    options.furnitureArt?.(item) ?? null,
                ),
            ),
            drawRoomTags(regions, view, false),
            drawPlanNotes(layout.width, layout.height, regions, []),
        ].join(""),
    );
};

/* Schedules -------------------------------------------------------------- */

/**
 * Right or left as the designer defines it: standing facing the door on the
 * side it opens towards, the door opened by that hand has its hinges on the
 * opposite side.
 */
export const getDoorHandedness = (door: DoorOpening, room: Room): string => {
    if (!isHingedDoor(door)) return "раздвижная";
    if (door.doorKind === "swing-double") return "двустворчатая";
    const segment = getRoomSegment(room, door);
    if (!segment) return "—";
    const normal = swingNormal(door, segment);
    const facing = { x: -normal.x, y: -normal.y };
    const viewerRight = { x: -facing.y, y: facing.x };
    const towardsHinge =
        door.hinge === "end"
            ? { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
            : { x: segment.start.x - segment.end.x, y: segment.start.y - segment.end.y };
    return towardsHinge.x * viewerRight.x + towardsHinge.y * viewerRight.y > 0 ? "левое" : "правое";
};

const doorRows = (room: Room) =>
    room.doors.map((door, index) => {
        const height = getDoorHeight(door);
        return [
            openingLabel("Д", index),
            `${door.width}×${height}`,
            `${door.width - DOOR_LEAF_CLEARANCE_MM}×${height - DOOR_LEAF_CLEARANCE_MM}`,
            getDoorHandedness(door, room),
        ];
    });

const roomOfWindow = (window: WindowOpening, room: Room, regions: DrawRoomRegion[]) => {
    const segment = getRoomSegment(room, window);
    if (!segment) return "—";
    const point = shift(
        along(segment, window.offset + window.width / 2),
        segment.inwardNormal,
        200,
    );
    return (
        regions.find((region) =>
            region.clearRects.some(
                (rect) =>
                    point.x >= rect.left &&
                    point.x <= rect.right &&
                    point.y >= rect.top &&
                    point.y <= rect.bottom,
            ),
        )?.name ?? "—"
    );
};

const windowRows = (room: Room, regions: DrawRoomRegion[]) =>
    room.windows.map((window, index) => [
        openingLabel("О", index),
        roomOfWindow(window, room, regions),
        `${window.width}×${getWindowHeight(window)}`,
        String(window.windowKind === "floor-to-ceiling" ? 0 : getWindowSillHeight(window)),
        window.revealDepth === undefined ? "—" : String(window.revealDepth),
    ]);

const DOOR_COLUMNS: TableColumn[] = [
    { title: "№", width: 16 },
    { title: "Проём, мм", width: 40 },
    { title: "Полотно, мм", width: 40 },
    { title: "Открывание", width: 40 },
];

const WINDOW_COLUMNS: TableColumn[] = [
    { title: "№", width: 16 },
    { title: "Помещение", width: 70 },
    { title: "Проём, мм", width: 40 },
    { title: "Низ от пола, мм", width: 42 },
    { title: "Глубина откоса, мм", width: 48 },
];

const FURNITURE_COLUMNS: TableColumn[] = [
    { title: "№", width: 16 },
    { title: "Наименование", width: 150 },
    { title: "Размер, мм", width: 50 },
    { title: "Помещение", width: 90 },
    { title: "Кол-во", width: 24 },
];

const NOTE_LINE = 4.6;

const drawNotes = (x: number, y: number, width: number, title: string, notes: string[]) => {
    const parts = [text(x, y, title, { size: 4, weight: 600 })];
    let cursor = y + 6;
    notes.forEach((note) => {
        wrapText(`• ${note}`, width, TEXT).forEach((value) => {
            parts.push(text(x, cursor, value));
            cursor += NOTE_LINE;
        });
        cursor += 1;
    });
    return { svg: parts.join(""), bottom: cursor };
};

const heading = (x: number, y: number, value: string) =>
    text(x, y, value, { size: 5, weight: 600 });

const scheduleSheets = (specification: PlanSpecification, regions: DrawRoomRegion[]) => {
    const { room } = specification;
    const width = A3_LONG_MM;
    const height = A3_SHORT_MM;
    const frame = frameFor(width, height);
    const left = frame.left + 12;
    const top = frame.top + 14;
    const doors = doorRows(room);
    const windows = windowRows(room, regions);
    const narrow = doors.filter((_, index) => room.doors[index].width <= NARROW_DOOR_OPENING_MM);
    const narrowNote = `${narrow.map(([label]) => label).join(", ")}: проём ${NARROW_DOOR_OPENING_MM} мм или меньше. ${NARROW_DOOR_WARNING}`;
    const windowNote = "Глубина откоса — расстояние от плоскости стены до окна.";
    const doorBlock = (y: number) => {
        const table = drawTable(left, y + 5, DOOR_COLUMNS, doors);
        return {
            svg:
                heading(left, y, "Спецификация дверей") +
                table.svg +
                (narrow.length
                    ? text(left, y + 11 + table.height, narrowNote, {
                          weight: 600,
                          color: RADIATOR,
                      })
                    : ""),
            bottom: y + 11 + table.height,
        };
    };
    const windowBlock = (y: number) => {
        const table = drawTable(left, y + 5, WINDOW_COLUMNS, windows);
        return {
            svg:
                heading(left, y, "Спецификация окон") +
                table.svg +
                text(left, y + 11 + table.height, windowNote, { size: SMALL }),
            bottom: y + 11 + table.height,
        };
    };
    if (doors.length <= MAX_DOORS_ON_SHARED_SHEET) {
        const first = doorBlock(top);
        const second = windowBlock(first.bottom + 14);
        return [wrapSheet("Спецификация дверей и окон", width, height, first.svg + second.svg)];
    }
    return [
        wrapSheet("Спецификация дверей", width, height, doorBlock(top).svg),
        wrapSheet("Спецификация окон", width, height, windowBlock(top).svg),
    ];
};

const furnitureRowText = ({
    item,
    count,
    number,
}: {
    item: PlanSpecificationItem;
    count: number;
    number: number;
}) => [
    String(number),
    item.name,
    `${item.width}×${item.depth}`,
    item.roomName ?? "—",
    String(count),
];

const furnitureScheduleSheets = (specification: PlanSpecification) => {
    const width = A3_LONG_MM;
    const height = A3_SHORT_MM;
    const frame = frameFor(width, height);
    const left = frame.left + 12;
    const top = frame.top + 14;
    const rows = Array.from(groupFurniture(specification.items).values()).map(furnitureRowText);
    const rowHeight = 7;
    const tableBottom = frame.bottom - STAMP_HEIGHT_MM - 6;
    const perSheet = Math.max(1, Math.floor((tableBottom - top - 5) / rowHeight) - 1);
    const pages: string[][][] = [];
    for (let index = 0; index < rows.length; index += perSheet) {
        pages.push(rows.slice(index, index + perSheet));
    }
    if (!pages.length) pages.push([]);

    const notes = specification.checks.map((check) => check.label);
    const noteWidth = frame.right - left - 12;
    const sheets: { content: string; bottom: number }[] = pages.map((page, index) => {
        const y = top;
        const table = drawTable(left, y + 5, FURNITURE_COLUMNS, page, rowHeight);
        return {
            content:
                (index === 0 ? heading(left, y, "Спецификация мебели") : "") +
                (page.length ? table.svg : text(left, y + 10, "Мебели на плане нет.")),
            bottom: y + 5 + (page.length ? table.height : 10),
        };
    });

    const blocks = [
        ...(notes.length ? [{ title: "Проверено", notes }] : []),
        {
            title: "Ограничения и допущения",
            notes: [
                ...(specification.caveats.length
                    ? specification.caveats
                    : ["Дополнительных оговорок для этого варианта нет."]),
            ],
        },
    ];
    blocks.forEach((block) => {
        const lines = block.notes.reduce(
            (sum, note) => sum + wrapText(`• ${note}`, noteWidth, TEXT).length,
            0,
        );
        const needed = 6 + lines * NOTE_LINE + block.notes.length;
        const last = sheets[sheets.length - 1];
        // Notes run down the free left part, beside the title block when they must.
        if (last.bottom + 10 + needed > frame.bottom - STAMP_HEIGHT_MM - 3) {
            sheets.push({ content: "", bottom: top - 10 });
        }
        const target = sheets[sheets.length - 1];
        const drawn = drawNotes(left, target.bottom + 10, noteWidth, block.title, block.notes);
        target.content += drawn.svg;
        target.bottom = drawn.bottom;
    });

    return sheets.map((sheet) => wrapSheet("Спецификация мебели", width, height, sheet.content));
};

/** All sheets in the designer's order. */
export const buildPlanSheets = (
    specification: PlanSpecification,
    options: PlanSheetOptions = {},
): PlanSheet[] => {
    const regions = getDrawRoomRegions(specification.room);
    return [
        measurementSheet(specification, regions),
        furnitureSheet(specification, regions, options),
        ...scheduleSheets(specification, regions),
        ...furnitureScheduleSheets(specification),
    ];
};
