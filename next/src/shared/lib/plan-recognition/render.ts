import { pointInsideRoom } from "@/shared/lib/furniture-planner/room-geometry";
import type { Room } from "@/shared/lib/furniture-planner/types";
import { readingFromRoom, type PlanReading } from "./reading";

type Point = { x: number; y: number };

/** Pixels per millimetre and the room's offset in the picture. */
const SCALE = 0.12;
const MARGIN = 230;
const WALL_MM = 150;
const CHAIN_MM = 500;
const TOTAL_MM = 900;

const add = (first: Point, second: Point, by = 1) => ({
    x: first.x + second.x * by,
    y: first.y + second.y * by,
});

/** The contour edges with their outward normal and the openings on each. */
const edgesWithOpenings = (room: Room, reading: PlanReading) =>
    reading.contour.map((start, index) => {
        const end = reading.contour[(index + 1) % reading.contour.length];
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
        let outward = { x: tangent.y, y: -tangent.x };
        const probe = add({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, outward, 20);
        if (pointInsideRoom(room, probe)) outward = { x: -outward.x, y: -outward.y };
        const along = (point: Point) =>
            (point.x - start.x) * tangent.x + (point.y - start.y) * tangent.y;
        const across = (point: Point) =>
            Math.abs((point.x - start.x) * tangent.y - (point.y - start.y) * tangent.x);
        const openings = reading.openings
            .filter((opening) => across(opening.from) < 1 && across(opening.to) < 1)
            .map((opening) => {
                const a = along(opening.from);
                const b = along(opening.to);
                return { kind: opening.kind, from: Math.min(a, b), to: Math.max(a, b) };
            })
            .filter((opening) => opening.from >= -1 && opening.to <= length + 1)
            .sort((first, second) => first.from - second.from);
        return { start, end, length, tangent, outward, openings };
    });

/**
 * A measured-plan drawing of one room, the way a surveyor draws it: thick
 * walls, openings cut into them, a dimension chain along every wall and the
 * wall's full length beyond it. The truth for it is `readingFromRoom(room)`.
 */
export const renderMeasuredPlan = (room: Room): string => {
    const reading = readingFromRoom(room);
    const edges = edgesWithOpenings(room, reading);
    const px = (point: Point) => ({ x: MARGIN + point.x * SCALE, y: MARGIN + point.y * SCALE });
    const width = room.width * SCALE + 2 * MARGIN;
    const height = room.depth * SCALE + 2 * MARGIN;
    const parts: string[] = [];

    // Walls: the band between the contour and its outward offset.
    const outer = reading.contour.map((corner, index) => {
        const before = edges[(index - 1 + edges.length) % edges.length].outward;
        const after = edges[index].outward;
        return add(corner, { x: before.x + after.x, y: before.y + after.y }, WALL_MM);
    });
    const path = (points: Point[]) =>
        points
            .map((point, index) => `${index ? "L" : "M"}${px(point).x},${px(point).y}`)
            .join(" ") + " Z";
    parts.push(
        `<path d="${path(outer)} ${path(reading.contour)}" fill="#3a3a3a" fill-rule="evenodd"/>`,
    );

    const line = (from: Point, to: Point, stroke = "#000", strokeWidth = 1) => {
        const a = px(from);
        const b = px(to);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    };
    const label = (at: Point, text: string, vertical: boolean) => {
        const p = px(at);
        return `<text x="${p.x}" y="${p.y}" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle"${vertical ? ` transform="rotate(-90 ${p.x} ${p.y})"` : ""}>${text}</text>`;
    };

    for (const edge of edges) {
        const point = (distance: number, out = 0) =>
            add(add(edge.start, edge.tangent, distance), edge.outward, out);
        const vertical = Math.abs(edge.tangent.y) > Math.abs(edge.tangent.x);
        const inward = { x: -edge.outward.x, y: -edge.outward.y };

        for (const opening of edge.openings) {
            // Cut the wall open, then draw the window or the door in the gap.
            const corners = [
                point(opening.from, -2),
                point(opening.to, -2),
                point(opening.to, WALL_MM + 2),
                point(opening.from, WALL_MM + 2),
            ];
            parts.push(`<path d="${path(corners)}" fill="#fff"/>`);
            parts.push(line(point(opening.from, 0), point(opening.from, WALL_MM)));
            parts.push(line(point(opening.to, 0), point(opening.to, WALL_MM)));
            if (opening.kind === "window") {
                for (const depth of [40, 75, 110])
                    parts.push(
                        line(
                            point(opening.from, depth),
                            point(opening.to, depth),
                            "#000",
                            depth === 75 ? 1 : 1.5,
                        ),
                    );
            } else {
                const leaf = opening.to - opening.from;
                const hinge = point(opening.from, 0);
                const open = add(hinge, inward, leaf);
                const closed = point(opening.to, 0);
                parts.push(line(hinge, open, "#000", 2));
                const r = leaf * SCALE;
                const a = px(open);
                const b = px(closed);
                const sweep =
                    edge.outward.x * edge.tangent.y - edge.outward.y * edge.tangent.x > 0 ? 1 : 0;
                parts.push(
                    `<path d="M${a.x},${a.y} A${r},${r} 0 0 ${sweep} ${b.x},${b.y}" fill="none" stroke="#000" stroke-width="0.8" stroke-dasharray="4 3"/>`,
                );
            }
        }

        // The dimension chain: corner, each opening's ends, corner.
        const marks = Array.from(
            new Set([
                0,
                ...edge.openings.flatMap((opening) => [opening.from, opening.to]),
                edge.length,
            ]),
        ).sort((first, second) => first - second);
        parts.push(line(point(0, CHAIN_MM), point(edge.length, CHAIN_MM), "#000", 0.8));
        for (const mark of marks) {
            parts.push(line(point(mark, CHAIN_MM - 60), point(mark, CHAIN_MM + 60), "#000", 0.8));
        }
        for (let index = 0; index + 1 < marks.length; index += 1) {
            const span = marks[index + 1] - marks[index];
            if (span < 1) continue;
            parts.push(
                label(
                    point((marks[index] + marks[index + 1]) / 2, CHAIN_MM + 110),
                    String(Math.round(span)),
                    vertical,
                ),
            );
        }
        // The wall's full length further out.
        parts.push(line(point(0, TOTAL_MM), point(edge.length, TOTAL_MM), "#000", 0.8));
        parts.push(line(point(0, TOTAL_MM - 60), point(0, TOTAL_MM + 60), "#000", 0.8));
        parts.push(
            line(point(edge.length, TOTAL_MM - 60), point(edge.length, TOTAL_MM + 60), "#000", 0.8),
        );
        parts.push(
            label(
                point(edge.length / 2, TOTAL_MM + 110),
                String(Math.round(edge.length)),
                vertical,
            ),
        );
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}"><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`;
};
