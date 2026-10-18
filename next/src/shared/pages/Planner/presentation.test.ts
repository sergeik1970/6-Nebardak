import { describe, expect, it } from "vitest";
import {
    PLANNER_CIRCULAR_FURNITURE_CAVEAT,
    PLANNER_DOOR_ENVELOPE_CAVEAT,
    PLANNER_MEASUREMENT_DISCLAIMER,
    buildPlannerCaveats,
} from "./presentation";

describe("planner presentation caveats", () => {
    it("keeps the measurement disclaimer when the beta badge is disabled", () => {
        const caveats = buildPlannerCaveats([], false);

        expect(caveats).toContain(PLANNER_MEASUREMENT_DISCLAIMER);
        expect(caveats.join(" ")).not.toMatch(/бета|тестов/i);
        expect(caveats).not.toContain(PLANNER_DOOR_ENVELOPE_CAVEAT);
        expect(caveats).not.toContain(PLANNER_CIRCULAR_FURNITURE_CAVEAT);
    });

    it("adds only an honest beta marker when the badge is enabled", () => {
        const caveats = buildPlannerCaveats(["Исходная заметка"], true);

        expect(caveats).toContain("Исходная заметка");
        expect(caveats).toContain("Планировщик работает в бета-режиме.");
        expect(caveats).toContain(PLANNER_MEASUREMENT_DISCLAIMER);
    });

    it("adds the conservative door-envelope caveat only when a door applies", () => {
        const withoutDoor = buildPlannerCaveats([], false, { hasDoorOpening: false });
        const withDoor = buildPlannerCaveats([], false, { hasDoorOpening: true });

        expect(withoutDoor).not.toContain(PLANNER_DOOR_ENVELOPE_CAVEAT);
        expect(withDoor).toContain(PLANNER_DOOR_ENVELOPE_CAVEAT);
        expect(withDoor).not.toContain(PLANNER_CIRCULAR_FURNITURE_CAVEAT);
    });

    it("adds the bounding-square caveat only when circular furniture applies", () => {
        const withoutCircle = buildPlannerCaveats([], false, {
            hasCircularFurniture: false,
        });
        const withCircle = buildPlannerCaveats([], false, { hasCircularFurniture: true });

        expect(withoutCircle).not.toContain(PLANNER_CIRCULAR_FURNITURE_CAVEAT);
        expect(withCircle).toContain(PLANNER_CIRCULAR_FURNITURE_CAVEAT);
        expect(withCircle).not.toContain(PLANNER_DOOR_ENVELOPE_CAVEAT);
    });

    it("preserves result notes, applicability caveats, beta status and measurement warning", () => {
        const caveats = buildPlannerCaveats(["Первая заметка", "Вторая заметка"], true, {
            hasDoorOpening: true,
            hasCircularFurniture: true,
        });

        expect(caveats.slice(0, 2)).toEqual(["Первая заметка", "Вторая заметка"]);
        expect(caveats).toContain(PLANNER_DOOR_ENVELOPE_CAVEAT);
        expect(caveats).toContain(PLANNER_CIRCULAR_FURNITURE_CAVEAT);
        expect(caveats).toContain("Планировщик работает в бета-режиме.");
        expect(caveats.at(-1)).toBe(PLANNER_MEASUREMENT_DISCLAIMER);
    });

    it("names the room shape the plan was computed for", () => {
        const rectangle = buildPlannerCaveats([], false).join(" ");
        const contour = buildPlannerCaveats([], false, { hasOrthogonalContour: true }).join(" ");

        expect(rectangle).toMatch(/прямоугольной комнаты/);
        expect(contour).toMatch(/заданного контура/);
        expect(contour).not.toMatch(/прямоугольной/);
    });
});
