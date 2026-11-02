import { describe, expect, it } from "vitest";
import { buildImagePdf } from "./plan-pdf";
import { buildDrawingPlanSpecification } from "./plan-export";
import {
    A3_LONG_MM,
    A3_SHORT_MM,
    STAMP_WIDTH_MM,
    buildPlanSheets,
    getDoorHandedness,
} from "./plan-sheets";
import type { DoorOpening, Room } from "./types";

const door = (overrides: Partial<DoorOpening> = {}): DoorOpening => ({
    id: "door",
    wall: "bottom",
    offset: 1000,
    width: 800,
    clearanceDepth: 800,
    hinge: "start",
    ...overrides,
});

const room: Room = {
    width: 6100,
    depth: 4200,
    wallThickness: 100,
    partitions: [
        { id: "wall", start: { x: 3000, y: 0 }, end: { x: 3000, y: 4200 }, thickness: 100 },
    ],
    doors: [
        door({ id: "entrance" }),
        door({ id: "inner", partitionId: "wall", wall: "left", offset: 2000 }),
    ],
    windows: [
        { id: "window", wall: "top", offset: 1000, width: 1500, sillHeight: 900, height: 1500 },
    ],
    radiators: [],
};

const specification = (items = 2) =>
    buildDrawingPlanSpecification({
        room,
        placements: Array.from({ length: items }, (_, index) => ({
            instanceId: `bed-${index}`,
            definitionId: "double-bed",
            x: 400,
            y: 400,
            rotation: 0 as const,
            roomName: "Спальня",
        })),
        conflictCount: 0,
        generatedAt: "2026-11-01T12:00:00.000Z",
    });

describe("drawing sheets", () => {
    it("follows the designer's order, sharing a sheet when doors are few", () => {
        expect(buildPlanSheets(specification()).map((sheet) => sheet.name)).toEqual([
            "Обмерный план",
            "План мебели",
            "Спецификация дверей и окон",
            "Спецификация мебели",
        ]);
    });

    it("gives doors and windows their own sheets when doors are many", () => {
        const many = Array.from({ length: 7 }, (_, index) =>
            door({ id: `door-${index}`, offset: 100 + index * 50 }),
        );
        const sheets = buildPlanSheets({ ...specification(), room: { ...room, doors: many } });
        expect(sheets.map((sheet) => sheet.name)).toEqual(
            expect.arrayContaining(["Спецификация дверей", "Спецификация окон"]),
        );
        expect(sheets).toHaveLength(5);
    });

    it("draws every sheet on A3 with the frame and title block", () => {
        for (const sheet of buildPlanSheets(specification())) {
            expect([sheet.width, sheet.height].sort((a, b) => a - b)).toEqual([
                A3_SHORT_MM,
                A3_LONG_MM,
            ]);
            // Binding margin 20 mm on the left, 5 mm elsewhere.
            expect(sheet.svg).toContain(
                `x="20" y="5" width="${sheet.width - 25}" height="${sheet.height - 10}"`,
            );
            expect(sheet.svg).toContain(`width="${STAMP_WIDTH_MM}" height="55"`);
            expect(sheet.svg).toContain(`>${sheet.name}<`);
        }
    });

    it("draws the walls of a plain rectangle as a closed right-angled ring", () => {
        const plan = buildPlanSheets(specification())[0].svg;
        const wall = /<path d="([^"]+)" fill="#d4d4d4"/.exec(plan)?.[1] ?? "";
        const rings = wall.split("Z").filter(Boolean);
        expect(rings).toHaveLength(2);
        for (const ring of rings) {
            const points = ring
                .slice(1)
                .split("L")
                .map((point) => point.split(" ").map(Number));
            expect(points).toHaveLength(4);
            points.forEach(([x, y], index) => {
                const [nextX, nextY] = points[(index + 1) % points.length];
                expect(x === nextX || y === nextY).toBe(true);
            });
        }
    });

    it("dimensions the walls in millimetres and lists the rooms", () => {
        const plan = buildPlanSheets(specification())[0].svg;
        expect(plan).toContain(">6100<");
        expect(plan).toContain(">4200<");
        expect(plan).toContain("Экспликация");
    });

    it("schedules doors and windows without the sample's last two window columns", () => {
        const schedule = buildPlanSheets(specification())[2].svg;
        expect(schedule).toContain(">800×2100<");
        expect(schedule).toContain(">700×2000<");
        expect(schedule).toContain(">1500×1500<");
        expect(schedule).toContain(">—<");
        expect(schedule).not.toContain("Створки");
        expect(schedule).not.toContain("Тип открывания");
    });

    it("warns in red under the door table only when an opening is narrow", () => {
        const schedule = (doors: DoorOpening[]) =>
            buildPlanSheets({ ...specification(), room: { ...room, doors } })[2].svg;
        expect(schedule(room.doors)).not.toContain("разобранном виде");
        const narrow = schedule([door({ id: "narrow", width: 650 }), ...room.doors]);
        expect(narrow).toContain(">650×2100<");
        expect(narrow).toContain(">550×2000<");
        expect(narrow).toContain("разобранном виде");
        expect(narrow).toContain('fill="#d0342c"');
        expect(narrow).toContain(">Д1: проём 700 мм или меньше.");
        // Exactly 700 still warns; the next step up does not.
        expect(schedule([door({ width: 700 })])).toContain("разобранном виде");
        expect(schedule([door({ width: 710 })])).not.toContain("разобранном виде");
    });

    it("fills walls by whether they bear load", () => {
        const plan = (changes: Partial<Room>) =>
            buildPlanSheets({ ...specification(), room: { ...room, ...changes } })[0].svg;
        const dark = /<rect [^>]*fill="#6f6f6f"/;
        const light = /<rect [^>]*fill="#d4d4d4"/;
        // A partition is non-load-bearing until marked otherwise.
        expect(plan({})).toMatch(dark);
        const bearing = plan({
            partitions: room.partitions?.map((partition) => ({ ...partition, loadBearing: true })),
        });
        expect(bearing).toMatch(light);
        // The legend's dark swatch is the only dark rectangle left.
        expect(bearing.match(/<rect [^>]*fill="#6f6f6f"/g)).toHaveLength(1);
        expect(plan({ nonBearingWalls: ["rect-top"], partitions: [] })).toMatch(
            /<path d="[^"]+" fill="#6f6f6f"/,
        );
    });

    it("prints the reveal the person entered", () => {
        const windows = room.windows.map((window) => ({ ...window, revealDepth: 180 }));
        const schedule = buildPlanSheets({ ...specification(), room: { ...room, windows } })[2].svg;
        expect(schedule).toContain(">180<");
        expect(schedule).toContain("от плоскости стены до окна");
    });

    it("groups identical pieces and keeps the notes at the very end", () => {
        const sheets = buildPlanSheets(specification(2));
        const last = sheets[sheets.length - 1].svg;
        expect(last).toContain("Ограничения и допущения");
        expect(last).toContain("Проверено");
        expect(last).toContain(">2<");
    });

    it("carries long schedules onto further sheets", () => {
        const sheets = buildPlanSheets({
            ...specification(),
            items: Array.from({ length: 60 }, (_, index) => ({
                ...specification(1).items[0],
                instanceId: `piece-${index}`,
                width: 1000 + index,
            })),
        });
        expect(
            sheets.filter((sheet) => sheet.name === "Спецификация мебели").length,
        ).toBeGreaterThan(1);
    });

    it("escapes room and piece names", () => {
        const sheets = buildPlanSheets({
            ...specification(),
            items: [{ ...specification(1).items[0], roomName: "<Кабинет & Co>" }],
        });
        expect(sheets[sheets.length - 1].svg).toContain("&lt;Кабинет &amp; Co&gt;");
    });

    it("draws a plan at a standard scale that fits a whole flat", () => {
        const flat = {
            ...room,
            width: 16_000,
            depth: 9_000,
            partitions: [],
            doors: [],
            windows: [],
        };
        const [sheet] = buildPlanSheets({ ...specification(), room: flat, items: [] });
        expect(sheet.width).toBe(A3_LONG_MM);
    });
});

describe("door handedness", () => {
    // A door in the bottom wall, seen on a plan with y growing downwards.
    const wall: Room = { ...room, partitions: [], doors: [] };

    it("flips with the hinge side", () => {
        expect(getDoorHandedness(door({ hinge: "start" }), wall)).not.toBe(
            getDoorHandedness(door({ hinge: "end" }), wall),
        );
    });

    it("flips with the swing direction", () => {
        expect(getDoorHandedness(door({ swingDirection: "inward" }), wall)).not.toBe(
            getDoorHandedness(door({ swingDirection: "outward" }), wall),
        );
    });

    it("names a door without one hand plainly", () => {
        expect(getDoorHandedness(door({ doorKind: "sliding-single" }), wall)).toBe("раздвижная");
        expect(getDoorHandedness(door({ doorKind: "swing-double" }), wall)).toBe("двустворчатая");
    });
});

describe("image PDF", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildImagePdf([
        { width: 420, height: 297, pixelWidth: 10, pixelHeight: 7, jpeg },
        { width: 297, height: 420, pixelWidth: 7, pixelHeight: 10, jpeg },
    ]);
    const body = new TextDecoder("latin1").decode(pdf);

    it("has one A3 page per sheet in its own orientation", () => {
        expect(body.startsWith("%PDF-1.4")).toBe(true);
        expect(body).toContain("/Count 2");
        expect(body).toContain("/MediaBox [0 0 1190.55 841.89]");
        expect(body).toContain("/MediaBox [0 0 841.89 1190.55]");
    });

    it("points its cross-reference table at the real objects", () => {
        const start = Number(/startxref\n(\d+)/.exec(body)?.[1]);
        expect(body.slice(start, start + 4)).toBe("xref");
        const offsets = Array.from(body.matchAll(/^(\d{10}) 00000 n $/gm), (match) =>
            Number(match[1]),
        );
        expect(offsets).toHaveLength(8);
        offsets.forEach((offset, index) =>
            expect(body.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true),
        );
    });
});
