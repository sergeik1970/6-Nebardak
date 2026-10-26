// Shapes are built as plain lists and keyed by position when rendered.
/* eslint-disable react/jsx-key */
import React from "react";
import {
    getRotatedGeometry,
    type FurnitureDefinition,
    type Rect,
} from "@/shared/lib/furniture-planner";
import styles from "./furniture.module.scss";

/**
 * Plan symbols drawn in lines from above, after the designer's AutoCAD
 * sheets and Remplanner's catalogue: a bed shows its headboard, pillows and
 * turned-down blanket, a wardrobe its rail and hangers. Everything is drawn
 * in the piece's own frame in millimetres with the back (the wall side) at
 * the top, so a resized piece keeps arms, rails and handles at their real
 * size instead of stretching them.
 */

type Side = "top" | "right" | "bottom" | "left";
type Shapes = React.ReactElement[];

const rect = (x: number, y: number, width: number, height: number, rx = 0): Shapes => [
    <rect x={x} y={y} width={width} height={height} rx={rx} />,
];
const box = (r: Rect, rx = 0) => rect(r.x, r.y, r.width, r.depth, rx);
const line = (d: string): Shapes => [<path d={d} />];
const circle = (cx: number, cy: number, r: number): Shapes => [<circle cx={cx} cy={cy} r={r} />];
const inset = (r: Rect, by: number): Rect => ({
    x: r.x + by,
    y: r.y + by,
    width: Math.max(0, r.width - 2 * by),
    depth: Math.max(0, r.depth - 2 * by),
});

const bed = (b: Rect, pillows: number): Shapes => {
    const head = Math.min(60, b.depth * 0.04);
    const margin = Math.min(100, b.width * 0.08);
    const gap = 60;
    const pillowWidth = (b.width - 2 * margin - (pillows - 1) * gap) / pillows;
    const pillowDepth = Math.min(420, b.depth * 0.2);
    const fold = b.y + head + pillowDepth + Math.min(180, b.depth * 0.09);
    return [
        ...box(b, 40),
        ...rect(b.x, b.y, b.width, head),
        ...Array.from({ length: pillows }, (_, i) =>
            rect(
                b.x + margin + i * (pillowWidth + gap),
                b.y + head + 50,
                pillowWidth,
                pillowDepth,
                50,
            ),
        ).flat(),
        // The blanket's top edge and its turned-down corner.
        ...line(`M ${b.x} ${fold} H ${b.x + b.width}`),
        ...line(
            `M ${b.x + b.width * 0.42} ${fold} Q ${b.x + b.width * 0.58} ${fold + b.depth * 0.22} ${b.x + b.width} ${fold + b.depth * 0.3}`,
        ),
    ];
};

/** Back cushions along the wall side, an arm at each end, one seat cushion per place. */
const sofa = (b: Rect, seats: number, arms: { left: boolean; right: boolean }): Shapes => {
    const arm = Math.min(200, b.width * 0.14);
    const back = Math.min(260, b.depth * 0.26);
    const left = arms.left ? arm : 0;
    const seatWidth = (b.width - left - (arms.right ? arm : 0)) / seats;
    return [
        ...box(b, 60),
        ...(arms.left ? rect(b.x, b.y, arm, b.depth, 60) : []),
        ...(arms.right ? rect(b.x + b.width - arm, b.y, arm, b.depth, 60) : []),
        ...Array.from({ length: seats }, (_, i) => [
            ...rect(b.x + left + i * seatWidth, b.y, seatWidth, back, 50),
            ...rect(b.x + left + i * seatWidth, b.y + back, seatWidth, b.depth - back - 40, 40),
        ]).flat(),
    ];
};

/** A chair seen from above: a seat with its back band on one side. */
const chair = (b: Rect, back: Side): Shapes => {
    const across = back === "top" || back === "bottom" ? b.depth : b.width;
    const band = across * 0.24;
    const backRect =
        back === "top"
            ? { ...b, depth: band }
            : back === "bottom"
              ? { ...b, y: b.y + b.depth - band, depth: band }
              : back === "left"
                ? { ...b, width: band }
                : { ...b, x: b.x + b.width - band, width: band };
    return [...box(b, Math.min(b.width, b.depth) * 0.25), ...box(backRect, band / 2)];
};

const wardrobe = (b: Rect): Shapes => {
    const rail = b.y + b.depth / 2;
    const hangers = Math.max(1, Math.floor((b.width - 120) / 110));
    const step = (b.width - 120) / hangers;
    return [
        ...box(b),
        ...line(`M ${b.x + 60} ${rail} H ${b.x + b.width - 60}`),
        ...Array.from({ length: hangers }, (_, i) => {
            const x = b.x + 60 + step * (i + 0.5);
            return line(`M ${x - 30} ${b.y + b.depth * 0.18} L ${x + 30} ${b.y + b.depth * 0.82}`);
        }).flat(),
        // The door line along the front.
        ...line(`M ${b.x} ${b.y + b.depth - 25} H ${b.x + b.width}`),
    ];
};

/** A cabinet with a handle on its front edge. */
const cabinet = (b: Rect): Shapes => {
    const handle = Math.min(140, b.width * 0.25);
    return [
        ...box(b, 15),
        ...rect(b.x + (b.width - handle) / 2, b.y + b.depth - 45, handle, 18, 9),
    ];
};

/** Dining groups are drawn on their designer sheet and scaled to the envelope. */
interface DiningLayout {
    width: number;
    depth: number;
    table: "round" | "square" | "oval" | "rect";
    tableWidth: number;
    tableDepth: number;
    /** Chair centres along the long sides, relative to the table centre. */
    sideChairs: number[];
}
const DINING: Record<string, DiningLayout> = {
    "dining-round-four": {
        width: 2260,
        depth: 2260,
        table: "round",
        tableWidth: 1000,
        tableDepth: 1000,
        sideChairs: [0],
    },
    "dining-square-four": {
        width: 2340,
        depth: 2340,
        table: "square",
        tableWidth: 1000,
        tableDepth: 1000,
        sideChairs: [0],
    },
    "dining-oval-six": {
        width: 2960,
        depth: 2090,
        table: "oval",
        tableWidth: 1700,
        tableDepth: 900,
        sideChairs: [-330, 330],
    },
    "dining-rect-six": {
        width: 3000,
        depth: 2200,
        table: "rect",
        tableWidth: 1700,
        tableDepth: 900,
        sideChairs: [-400, 400],
    },
};
const diningGroup = (layout: DiningLayout): Shapes => {
    const cx = layout.width / 2;
    const cy = layout.depth / 2;
    const tw = layout.tableWidth;
    const td = layout.tableDepth;
    const seat = 450;
    const reach = 500;
    // Chairs tuck a fifth of their depth under the table edge.
    const tuck = reach * 0.2;
    return [
        ...(layout.table === "round" || layout.table === "oval"
            ? [<ellipse cx={cx} cy={cy} rx={tw / 2} ry={td / 2} />]
            : rect(cx - tw / 2, cy - td / 2, tw, td, layout.table === "rect" ? 100 : 60)),
        ...layout.sideChairs.flatMap((offset) => [
            ...chair(
                {
                    x: cx + offset - seat / 2,
                    y: cy - td / 2 - reach + tuck,
                    width: seat,
                    depth: reach,
                },
                "top",
            ),
            ...chair(
                { x: cx + offset - seat / 2, y: cy + td / 2 - tuck, width: seat, depth: reach },
                "bottom",
            ),
        ]),
        ...chair(
            { x: cx - tw / 2 - reach + tuck, y: cy - seat / 2, width: reach, depth: seat },
            "left",
        ),
        ...chair({ x: cx + tw / 2 - tuck, y: cy - seat / 2, width: reach, depth: seat }, "right"),
    ];
};

const symbolShapes = (
    definitionId: string,
    rects: Rect[],
    width: number,
    depth: number,
): Shapes => {
    const b = rects[0];
    const whole: Rect = { x: 0, y: 0, width, depth };
    switch (definitionId) {
        case "single-bed":
        case "child-bed":
            return bed(b, 1);
        case "double-bed":
            return bed(b, 2);
        case "cradle":
            return [...box(b, b.width * 0.2), ...box(inset(b, 50), b.width * 0.15)];
        case "sofa-two":
        case "sofa-bed":
            return sofa(b, 2, { left: true, right: true });
        case "sofa-three":
            return sofa(b, 3, { left: true, right: true });
        case "armchair":
            return sofa(b, 1, { left: true, right: true });
        case "sofa-four-left": {
            const [main, chaise] = rects;
            const arm = Math.min(200, main.width * 0.1);
            const back = Math.min(260, main.depth * 0.26);
            const right = main.x + main.width;
            const seatsFrom = chaise.x + chaise.width;
            const seatWidth = (right - arm - seatsFrom) / 2;
            return [
                <polygon
                    points={[
                        [main.x, main.y],
                        [right, main.y],
                        [right, main.y + main.depth],
                        [seatsFrom, main.y + main.depth],
                        [seatsFrom, chaise.y + chaise.depth],
                        [chaise.x, chaise.y + chaise.depth],
                    ]
                        .map((point) => point.join(","))
                        .join(" ")}
                />,
                ...rect(main.x, main.y, right - arm - main.x, back, 50),
                ...rect(right - arm, main.y, arm, main.depth, 60),
                ...rect(
                    chaise.x,
                    main.y + back,
                    chaise.width,
                    chaise.y + chaise.depth - main.y - back - 40,
                    40,
                ),
                ...rect(seatsFrom, main.y + back, seatWidth, main.depth - back - 40, 40),
                ...rect(
                    seatsFrom + seatWidth,
                    main.y + back,
                    seatWidth,
                    main.depth - back - 40,
                    40,
                ),
            ];
        }
        case "pouf":
            return [
                ...circle(width / 2, depth / 2, Math.min(width, depth) / 2),
                ...circle(width / 2, depth / 2, Math.min(width, depth) * 0.36),
            ];
        case "coffee-table":
            return [
                ...circle(width / 2, depth / 2, Math.min(width, depth) / 2),
                ...circle(width / 2, depth / 2, Math.min(width, depth) * 0.42),
            ];
        case "coffee-table-rect":
            return [...box(b, 40), ...box(inset(b, 50), 20)];
        case "wardrobe-small":
        case "wardrobe-medium":
        case "wardrobe-large":
            return wardrobe(b);
        case "bookcase": {
            const books = Math.max(1, Math.floor((b.width - 60) / 45));
            return [
                ...box(b),
                ...Array.from({ length: books }, (_, i) =>
                    line(
                        `M ${b.x + 30 + i * 45 + 22} ${b.y + 25} V ${b.y + b.depth * (i % 3 === 1 ? 0.62 : 0.75)}`,
                    ),
                ).flat(),
            ];
        }
        case "dresser":
        case "bedside-table":
            return cabinet(b);
        case "tv-console": {
            const screen = Math.min(60, b.depth * 0.14);
            return [
                ...cabinet(b),
                ...rect(
                    b.x + b.width * 0.08,
                    b.y + b.depth * 0.2,
                    b.width * 0.84,
                    screen,
                    screen / 2,
                ),
                ...rect(
                    b.x + b.width * 0.42,
                    b.y + b.depth * 0.2 + screen,
                    b.width * 0.16,
                    b.depth * 0.18,
                    10,
                ),
            ];
        }
        case "tv":
            return [
                ...box(b, Math.min(30, b.depth / 2)),
                ...line(`M ${b.x + 40} ${b.y + b.depth * 0.7} H ${b.x + b.width - 40}`),
            ];
        case "desk":
            return [...box(rects[0], 10), ...(rects[1] ? chair(rects[1], "bottom") : [])];
        case "dressing-table":
            // The mirror stands along the wall.
            return [...box(b, 10), ...rect(b.x + b.width * 0.15, b.y + 30, b.width * 0.7, 40, 20)];
        case "dining-table":
            return box(b, 40);
        case "dining-chair":
            return chair(b, "top");
        case "dining-round-four":
        case "dining-square-four":
        case "dining-oval-six":
        case "dining-rect-six": {
            const layout = DINING[definitionId];
            return [
                // An invisible envelope keeps the whole group grabbable.
                <rect x={0} y={0} width={width} height={depth} data-symbol-hit="" />,
                <g transform={`scale(${width / layout.width} ${depth / layout.depth})`}>
                    {diningGroup(layout).map((shape, key) => React.cloneElement(shape, { key }))}
                </g>,
            ];
        }
        case "kitchen-sink":
            return [
                ...box(b),
                ...rect(
                    b.x + b.width * 0.15,
                    b.y + b.depth * 0.2,
                    b.width * 0.7,
                    b.depth * 0.55,
                    60,
                ),
                ...circle(
                    b.x + b.width / 2,
                    b.y + b.depth * 0.47,
                    Math.min(b.width, b.depth) * 0.04,
                ),
            ];
        case "kitchen-cooker":
            return [
                ...box(b),
                ...[0.3, 0.7].flatMap((fx) =>
                    [0.3, 0.7].flatMap((fy) =>
                        circle(
                            b.x + b.width * fx,
                            b.y + b.depth * fy,
                            Math.min(b.width, b.depth) * 0.13,
                        ),
                    ),
                ),
            ];
        case "kitchen-base-600":
        case "kitchen-base-400":
            // The worktop edge along the front and the split between doors.
            return [
                ...box(b),
                ...line(`M ${b.x} ${b.y + b.depth - 40} H ${b.x + b.width}`),
                ...line(`M ${b.x + b.width / 2} ${b.y + b.depth - 40} V ${b.y + b.depth * 0.45}`),
            ];
        case "kitchen-dishwasher":
            return [...box(b), ...box(inset(b, 60), 10)];
        case "kitchen-washer":
            return [
                ...box(b),
                ...circle(
                    b.x + b.width / 2,
                    b.y + b.depth * 0.55,
                    Math.min(b.width, b.depth) * 0.3,
                ),
            ];
        case "kitchen-fridge":
        case "kitchen-fridge-wide":
        case "kitchen-tall":
        case "kitchen-upper-600":
        case "kitchen-upper-400":
            // Tall and upper units are crossed, as on a kitchen plan.
            return [
                ...box(b),
                ...line(
                    `M ${b.x} ${b.y} L ${b.x + b.width} ${b.y + b.depth} M ${b.x + b.width} ${b.y} L ${b.x} ${b.y + b.depth}`,
                ),
            ];
        case "kitchen-hood":
            return [
                ...box(b),
                ...circle(b.x + b.width / 2, b.y + b.depth / 2, Math.min(b.width, b.depth) * 0.3),
            ];
        case "kitchen-island":
            return [...box(b, 20), ...box(inset(b, 40), 10)];
        case "aquarium":
            return [
                ...box(b),
                ...box(inset(b, 40)),
                ...line(
                    `M ${b.x + 60} ${b.y + b.depth * 0.55} q ${b.width * 0.1} -60 ${b.width * 0.2} 0 t ${b.width * 0.2} 0 t ${b.width * 0.2} 0 t ${b.width * 0.2} 0`,
                ),
            ];
        case "pet-bed":
            return [
                ...box(b, Math.min(b.width, b.depth) * 0.3),
                <ellipse
                    cx={b.x + b.width / 2}
                    cy={b.y + b.depth / 2}
                    rx={b.width * 0.32}
                    ry={b.depth * 0.3}
                />,
            ];
        case "litter-box":
            return [...box(b, 30), ...box(inset(b, 50), 60)];
        default:
            return rects.length ? rects.flatMap((r) => box(r, 20)) : box(whole, 20);
    }
};

export default function FurnitureSymbol({
    definitionId,
    rects,
    width,
    depth,
}: {
    definitionId: string;
    rects: Rect[];
    width: number;
    depth: number;
}) {
    return (
        <g data-furniture-symbol={definitionId}>
            {symbolShapes(definitionId, rects, width, depth).map((shape, key) =>
                React.cloneElement(shape, { key }),
            )}
        </g>
    );
}

/** A catalogue's small picture of a piece: its plan symbol at the default size. */
export function FurnitureThumbnail({ definition }: { definition: FurnitureDefinition }) {
    const geometry = getRotatedGeometry(definition, 0);
    const pad = Math.max(geometry.width, geometry.depth) * 0.06;
    return (
        <svg
            className={styles.thumbnail}
            viewBox={`${-pad} ${-pad} ${geometry.width + 2 * pad} ${geometry.depth + 2 * pad}`}
            aria-hidden="true"
            focusable="false"
        >
            <FurnitureSymbol
                definitionId={definition.id}
                rects={geometry.bodyRects}
                width={geometry.width}
                depth={geometry.depth}
            />
        </svg>
    );
}
