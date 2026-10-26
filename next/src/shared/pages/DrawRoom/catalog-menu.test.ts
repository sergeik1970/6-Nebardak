import { FURNITURE_CATALOG } from "@/shared/lib/furniture-planner";
import { describe, expect, it } from "vitest";
import { FURNITURE_MENU, furnitureMenuOrder, searchFurnitureMenu } from "./catalog-menu";

describe("furniture catalogue menu", () => {
    it("lists every catalogue piece exactly once", () => {
        const ids = FURNITURE_MENU.flatMap((section) => section.groups.flatMap((g) => g.ids));
        expect([...ids].sort()).toEqual(FURNITURE_CATALOG.map((d) => d.id).sort());
    });

    it("pictures each section with one of its own pieces", () => {
        for (const section of FURNITURE_MENU)
            expect(section.groups.flatMap((g) => g.ids)).toContain(section.icon);
    });

    it("offers the sections that suit the room kind first", () => {
        const order = (kind?: Parameters<typeof furnitureMenuOrder>[0]) =>
            furnitureMenuOrder(kind).map((section) => section.id);
        expect(order("bedroom")[0]).toBe("living-bedroom");
        expect(order("kitchen").slice(0, 2)).toEqual(["kitchen-dining", "appliances"]);
        expect(order("children")[0]).toBe("children");
        expect(order()).toEqual(FURNITURE_MENU.map((section) => section.id));
        expect(new Set(order("office")).size).toBe(FURNITURE_MENU.length);
    });

    it("searches across every section", () => {
        expect(searchFurnitureMenu("  ")).toEqual([]);
        expect(searchFurnitureMenu("кровать").map((d) => d.id)).toEqual([
            "single-bed",
            "double-bed",
            "sofa-bed",
            "child-bed",
        ]);
    });
});
