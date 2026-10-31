import { describe, expect, it } from "vitest";

import {
    buildDrawingPlanSpecification,
    buildPlanSpecification,
    getPlanExportFilename,
    renderPlanSpecificationPng,
} from "./plan-export";
import { Placement, Room } from "./types";
import { applyRoomGeometry, createLRoomGeometry } from "./room-geometry";

const room: Room = {
    width: 4000,
    depth: 3000,
    doors: [
        {
            id: "door-1",
            wall: "bottom",
            offset: 300,
            width: 900,
            clearanceDepth: 900,
        },
    ],
    windows: [{ id: "window-1", wall: "top", offset: 1000, width: 1400 }],
    radiators: [],
};

const placements: Placement[] = [
    {
        instanceId: "desk-1",
        definitionId: "desk",
        x: 0,
        y: 0,
        rotation: 90,
    },
];

describe("plan export", () => {
    it("builds a versioned, self-contained result specification", () => {
        const result = buildPlanSpecification({
            room,
            placements,
            priorities: { desk: "required", "coffee-table": "optional" },
            validation: { valid: true, issues: [] },
            caveats: ["Проверить розетку", "Проверить розетку", "  "],
            generatedAt: "2026-07-17T07:00:00.000Z",
        });

        expect(result.schemaVersion).toBe("stylefinder-plan-spec-v3");
        expect(result.algorithmVersion).toBe("deterministic-layout-v4");
        expect(result.catalogRevision).toBe(
            "sha256-content-addressed:a51f5e4b64b615c0:e5c4545cbc94266f",
        );
        expect(result.generatedAt).toBe("2026-07-17T07:00:00.000Z");
        expect(result.room).not.toBe(room);
        expect(result.items[0]).toMatchObject({
            name: "Письменный стол",
            width: 1100,
            depth: 1200,
            priority: "required",
            x: 0,
            y: 0,
            rotation: 90,
        });
        expect(result.items[0].bodyRects.length).toBeGreaterThan(0);
        expect(result.removedItems).toEqual([]);
        expect(result.checks.every((check) => check.status === "passed")).toBe(true);
        expect(result.caveats).toEqual(["Проверить розетку"]);
    });

    it("exports validated removal records with a catalog name", () => {
        const result = buildPlanSpecification({
            room,
            placements,
            priorities: { desk: "required" },
            validation: { valid: true, issues: [] },
            removedItems: [
                {
                    instanceId: "coffee-table-1",
                    definitionId: "coffee-table",
                    priority: "optional",
                    method: "automatic",
                    reason: "Полный набор не помещается; без столика найден допустимый вариант.",
                    removedAt: "2026-07-17T06:55:00.000Z",
                },
            ],
            generatedAt: "2026-07-17T07:00:00.000Z",
        });

        expect(result.removedItems).toEqual([
            expect.objectContaining({
                instanceId: "coffee-table-1",
                name: "Кофейный столик",
                priority: "optional",
                method: "automatic",
                removedAt: "2026-07-17T06:55:00.000Z",
            }),
        ]);
    });

    it("keeps an immutable orthogonal contour in the v3 specification", () => {
        const orthogonal = applyRoomGeometry(
            { ...room, width: 6000, depth: 4600, doors: [], windows: [] },
            createLRoomGeometry(6000, 4600, "right"),
        );
        const result = buildPlanSpecification({
            room: orthogonal,
            placements: [],
            priorities: {},
            validation: { valid: true, issues: [] },
            generatedAt: "2026-08-19T07:00:00.000Z",
        });

        expect(result.room.geometry?.kind).toBe("orthogonal");
        if (orthogonal.geometry?.kind !== "orthogonal") return;
        orthogonal.geometry.vertices[0].x = 500;
        expect(
            result.room.geometry?.kind === "orthogonal" ? result.room.geometry.vertices[0].x : null,
        ).toBe(0);
    });

    it("keeps a schematic item visibly separate from designer-source revisions", () => {
        const result = buildPlanSpecification({
            room,
            placements: [
                {
                    instanceId: "dining-chair-1",
                    definitionId: "dining-chair",
                    x: 500,
                    y: 1200,
                    rotation: 0,
                },
            ],
            priorities: { "dining-chair": "required" },
            validation: { valid: true, issues: [] },
            generatedAt: "2026-08-10T12:00:00.000Z",
        });

        expect(result.catalogRevision).toBe("schematic-default:2026-08-10-v1");
        expect(result.items[0]).toMatchObject({
            name: "Стул",
            width: 450,
            depth: 500,
            priority: "required",
        });
    });

    it("rejects invalid or simultaneously placed removal records", () => {
        expect(() =>
            buildPlanSpecification({
                room,
                placements,
                priorities: {},
                validation: { valid: true, issues: [] },
                removedItems: [
                    {
                        instanceId: "desk-1",
                        definitionId: "desk",
                        method: "manual",
                        reason: "Удалено пользователем.",
                        removedAt: "2026-07-17T07:00:00.000Z",
                    },
                ],
                generatedAt: "2026-07-17T07:00:00.000Z",
            }),
        ).toThrow("всё ещё присутствует");

        expect(() =>
            buildPlanSpecification({
                room,
                placements,
                priorities: {},
                validation: { valid: true, issues: [] },
                removedItems: [
                    {
                        instanceId: "coffee-table-1",
                        definitionId: "coffee-table",
                        method: "manual",
                        reason: " ",
                        removedAt: "bad-date",
                    },
                ],
                generatedAt: "2026-07-17T07:00:00.000Z",
            }),
        ).toThrow("не прошла проверку");
    });

    it("rejects an invalid layout instead of presenting it as checked", () => {
        expect(() =>
            buildPlanSpecification({
                room,
                placements,
                priorities: {},
                validation: {
                    valid: false,
                    issues: [
                        { code: "outside-room", message: "За границей", instanceIds: ["desk-1"] },
                    ],
                },
                generatedAt: "2026-07-17T07:00:00.000Z",
            }),
        ).toThrow("невалидной расстановки");
    });

    it("creates a stable UTC filename and falls back safely for a bad date", () => {
        expect(getPlanExportFilename("2026-07-17T22:30:00-03:00")).toBe(
            "stylefinder-plan-2026-07-18.png",
        );
        expect(getPlanExportFilename("bad-date")).toBe("stylefinder-plan-1970-01-01.png");
    });

    it("fails visibly when PNG export is called outside a browser", async () => {
        const result = buildPlanSpecification({
            room,
            placements,
            priorities: {},
            validation: { valid: true, issues: [] },
            generatedAt: "2026-07-17T07:00:00.000Z",
        });

        await expect(renderPlanSpecificationPng(result)).rejects.toThrow(
            "доступен только в браузере",
        );
    });
});

describe("drawing export", () => {
    const generatedAt = "2026-10-24T12:00:00.000Z";
    it("names each piece's room and claims only the editor's checks", () => {
        const specification = buildDrawingPlanSpecification({
            room,
            placements: [{ ...placements[0], roomName: "Кабинет" }],
            conflictCount: 0,
            generatedAt,
        });
        expect(specification.source).toBe("drawing");
        expect(specification.items).toEqual([
            expect.objectContaining({ definitionId: "desk", roomName: "Кабинет" }),
        ]);
        expect(specification.checks.map((check) => check.id)).toEqual([
            "inside-room",
            "body-overlap",
            "openings",
        ]);
        // A hand-made plan never claims the solver's wall-contact or relation rules.
        expect(specification.checks.some((check) => check.id === "relations")).toBe(false);
        expect(specification.catalogRevision).not.toBe("unversioned");
    });
    it("drops every check and says why while a piece conflicts", () => {
        const specification = buildDrawingPlanSpecification({
            room,
            placements,
            conflictCount: 2,
            generatedAt,
        });
        expect(specification.checks).toEqual([]);
        expect(specification.caveats[0]).toContain("2 предмета конфликтуют");
    });
});
