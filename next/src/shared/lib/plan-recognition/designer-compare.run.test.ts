import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, it } from "vitest";
import { getDrawRoomRegions } from "@/shared/lib/furniture-planner/room-regions";
import { drawingRoomOf } from "@/shared/pages/DrawRoom/apartment-from-plan";
import { furnitureGeometry, type DrawFurniture } from "@/shared/pages/DrawRoom/furniture";
import { parseDrawingProject } from "@/shared/pages/DrawRoom/project-file";

/**
 * The report for DESIGNER_COMPARE=<plan>: our furniture (from the drawing the
 * e2e comparison saved) next to the designer's, room by room and kind by kind.
 */
const PLAN = process.env.DESIGNER_COMPARE;
const OUTPUT = path.join(process.cwd(), "test-results", "designer", PLAN ?? "none");

/** Our catalogue → the kinds a designer's sheet names. */
const CATEGORY: [RegExp, string][] = [
    [/^double-bed$/, "bed-double"],
    [/^(single-bed|child-bed|cradle)$/, "bed-single"],
    [/^sofa-bed$/, "sofa"],
    [/^sofa-/, "sofa"],
    [/^wardrobe-/, "wardrobe"],
    [/^desk$/, "desk"],
    [/^bookcase$/, "bookcase"],
    [/^dresser$/, "dresser"],
    [/^dressing-table$/, "dressing-table"],
    [/^bedside-table$/, "bedside-table"],
    [/^tv-console$/, "tv-stand"],
    [/^tv$/, "tv"],
    [/^dining-chair$/, "dining-chair"],
    [/^dining-/, "dining-table"],
    [/^armchair$/, "armchair"],
    [/^pouf$/, "bench"],
    [/^coffee-table/, "coffee-table"],
    [/^kitchen-/, "kitchen"],
];
const categoryOf = (id: string) => CATEGORY.find(([pattern]) => pattern.test(id))?.[1] ?? id;

const LABEL: Record<string, string> = {
    "bed-double": "двуспальная кровать",
    "bed-single": "односпальная кровать",
    sofa: "диван",
    wardrobe: "шкаф",
    desk: "стол",
    bookcase: "стеллаж",
    dresser: "комод",
    "dressing-table": "туалетный столик",
    "bedside-table": "тумба",
    "tv-stand": "ТВ‑тумба",
    tv: "телевизор",
    "dining-table": "обеденный стол",
    "dining-chair": "стул",
    armchair: "кресло",
    bench: "банкетка/пуф",
    "coffee-table": "журнальный столик",
    kitchen: "кухня",
    "shoe-cabinet": "обувница",
};

interface DesignerPlan {
    sheet: string;
    note?: string;
    rooms: {
        ours: string;
        kind: string;
        designer: string;
        pieces: { category: string; size: string; where: string }[];
    }[];
}

describe.runIf(Boolean(PLAN))("comparison with a designer's furniture plan", () => {
    it("writes the report", async () => {
        const designer = JSON.parse(
            fs.readFileSync(
                path.join(os.homedir(), "stylefinder-plans", "designer", `${PLAN}.json`),
                "utf8",
            ),
        ) as DesignerPlan;
        const scene = parseDrawingProject(
            fs.readFileSync(path.join(OUTPUT, "drawing.json"), "utf8"),
        );
        const flat = drawingRoomOf(scene.segments, scene.wallThickness);
        if (!flat) throw new Error("The saved drawing has no closed flat");
        // Regions come out in the same order the editor saved their names in;
        // signatures can differ by a millimetre of rounding, the order does not.
        const named = scene.regions?.items ?? [];
        const regions = getDrawRoomRegions({ ...flat.room, regions: scene.regions }).map(
            (region, index) =>
                /^Помещение \d+$/.test(region.name) && named[index]
                    ? { ...region, name: named[index].name }
                    : region,
        );
        const outcomes = fs.existsSync(path.join(OUTPUT, "outcomes.txt"))
            ? fs.readFileSync(path.join(OUTPUT, "outcomes.txt"), "utf8").split("\n")
            : [];

        // Each piece belongs to the region its centre stands in.
        const byRegion = new Map<string, DrawFurniture[]>();
        for (const piece of scene.furniture ?? []) {
            const shape = furnitureGeometry(piece);
            const centre = {
                x: piece.x + shape.width / 2 - flat.origin.x,
                y: piece.y + shape.depth / 2 - flat.origin.y,
            };
            const region = regions.find((candidate) =>
                candidate.clearRects.some(
                    (rect) =>
                        centre.x >= rect.left &&
                        centre.x <= rect.right &&
                        centre.y >= rect.top &&
                        centre.y <= rect.bottom,
                ),
            );
            const key = region?.name ?? "вне комнат";
            byRegion.set(key, [...(byRegion.get(key) ?? []), piece]);
        }

        const lines = [
            `# Сравнение с дизайнером: ${PLAN}`,
            "",
            ...(designer.note ? [designer.note, ""] : []),
            "![Дизайнер](designer.png)",
            "",
            "![Мы](ours-plan.png)",
            "",
        ];
        let matched = 0;
        let wanted = 0;
        for (const room of designer.rooms.filter((candidate) => candidate.pieces.length)) {
            const ours = byRegion.get(room.ours) ?? [];
            const ourKinds = ours.map((piece) => categoryOf(piece.definitionId));
            const outcome = outcomes.find((line) => line.includes(room.ours)) ?? "";
            lines.push(`## ${room.designer} — у нас «${room.ours}» (${room.kind})`, "");
            if (outcome) lines.push(`Подбор: ${outcome.replace(/^\[[a-z]+\]\s*/, "")}`, "");
            lines.push("| У дизайнера | Где | У нас |", "| --- | --- | --- |");
            const left = [...ourKinds];
            for (const piece of room.pieces) {
                if (piece.category === "kitchen") {
                    lines.push(
                        `| ${LABEL.kitchen}: ${piece.size} | ${piece.where} | не сравнивается |`,
                    );
                    continue;
                }
                wanted += 1;
                const index = left.indexOf(piece.category);
                if (index >= 0) {
                    left.splice(index, 1);
                    matched += 1;
                }
                const ourPiece = ours.find(
                    (item) => categoryOf(item.definitionId) === piece.category,
                );
                lines.push(
                    `| ${LABEL[piece.category] ?? piece.category}, ${piece.size} | ${piece.where} | ${
                        index >= 0 && ourPiece
                            ? `есть: ${ourPiece.width}×${ourPiece.depth}`
                            : "**нет**"
                    } |`,
                );
            }
            const extras = left.filter((kind) => kind !== "kitchen");
            if (extras.length)
                lines.push(
                    `| — | — | сверх того: ${extras.map((kind) => LABEL[kind] ?? kind).join(", ")} |`,
                );
            lines.push("");
        }
        lines.splice(
            4 + (designer.note ? 2 : 0),
            0,
            `**Совпало по видам мебели: ${matched} из ${wanted}** предметов дизайнера (кухонный гарнитур не считается).`,
            "",
        );
        fs.writeFileSync(path.join(OUTPUT, "report.md"), `${lines.join("\n")}\n`);
        await sharp(path.join(os.homedir(), "stylefinder-plans", designer.sheet))
            .resize(1600, 1200, { fit: "inside" })
            .png()
            .toFile(path.join(OUTPUT, "designer.png"));
        // Our plan drawn plainly: walls, partitions and every piece with its name.
        const points = scene.segments.flatMap((segment) => [segment.start, segment.end]);
        const minX = Math.min(...points.map((point) => point.x)) - 400;
        const minY = Math.min(...points.map((point) => point.y)) - 400;
        const maxX = Math.max(...points.map((point) => point.x)) + 400;
        const maxY = Math.max(...points.map((point) => point.y)) + 400;
        const k = 1600 / (maxX - minX);
        const at = (value: number, low: number) => ((value - low) * k).toFixed(1);
        const walls = scene.segments.map(
            (segment) =>
                `<line x1="${at(segment.start.x, minX)}" y1="${at(segment.start.y, minY)}" x2="${at(segment.end.x, minX)}" y2="${at(segment.end.y, minY)}" stroke="#555" stroke-width="${((segment.thickness ?? scene.wallThickness ?? 100) * k).toFixed(1)}" stroke-linecap="square"/>`,
        );
        const pieces = (scene.furniture ?? []).flatMap((piece) => {
            const shape = furnitureGeometry(piece);
            const rects = shape.bodyRects.map(
                (rect) =>
                    `<rect x="${at(piece.x + rect.x, minX)}" y="${at(piece.y + rect.y, minY)}" width="${(rect.width * k).toFixed(1)}" height="${(rect.depth * k).toFixed(1)}" fill="#f3d9b1" stroke="#8a5a2b" stroke-width="1"/>`,
            );
            const label = (LABEL[categoryOf(piece.definitionId)] ?? piece.definitionId).replace(
                /[<&>]/g,
                "",
            );
            return [
                ...rects,
                `<text x="${at(piece.x + shape.width / 2, minX)}" y="${at(piece.y + shape.depth / 2, minY)}" font-family="Arial" font-size="11" text-anchor="middle" dominant-baseline="middle">${label}</text>`,
            ];
        });
        const names = regions.map((region) => {
            const x = region.center.x + flat.origin.x;
            const y = region.center.y + flat.origin.y;
            return `<text x="${at(x, minX)}" y="${at(y, minY)}" font-family="Arial" font-size="13" font-weight="bold" fill="#1f5f99" text-anchor="middle">${region.name.replace(/[<&>]/g, "")}</text>`;
        });
        const height = Math.round((maxY - minY) * k);
        await sharp(
            Buffer.from(
                `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${walls.join("")}${pieces.join("")}${names.join("")}</svg>`,
            ),
        )
            .png()
            .toFile(path.join(OUTPUT, "ours-plan.png"));
        console.log(`matched ${matched}/${wanted}`);
    });
});
