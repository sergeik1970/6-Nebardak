import { FURNITURE_CATALOG } from "@/shared/lib/furniture-planner";
import { describe, expect, it } from "vitest";
import {
    FURNITURE_MENU,
    OFFERED_FURNITURE_MENU,
    furnitureMenuOrder,
    searchFurnitureMenu,
} from "./catalog-menu";
import { isRoomDesignAvailable } from "./room-availability";

describe("kitchen and bathroom switched off", () => {
    const offered = OFFERED_FURNITURE_MENU.flatMap((section) =>
        section.groups.flatMap((group) => group.ids),
    );

    it("keeps every kitchen piece in the catalogue but out of the menu", () => {
        expect(FURNITURE_CATALOG.some((d) => d.id === "kitchen-sink")).toBe(true);
        expect(offered.filter((id) => id.startsWith("kitchen-"))).toEqual([]);
        expect(searchFurnitureMenu("мойка")).toEqual([]);
    });

    it("keeps dining furniture and the TV on offer", () => {
        expect(offered).toEqual(expect.arrayContaining(["dining-table", "dining-chair", "tv"]));
    });

    it("pictures each remaining section with one of its own pieces", () => {
        for (const section of OFFERED_FURNITURE_MENU)
            expect(section.groups.flatMap((g) => g.ids)).toContain(section.icon);
    });

    it("blocks only kitchen and bathroom design", () => {
        expect(isRoomDesignAvailable("kitchen")).toBe(false);
        expect(isRoomDesignAvailable("bathroom")).toBe(false);
        expect(isRoomDesignAvailable("living")).toBe(true);
        expect(isRoomDesignAvailable()).toBe(true);
    });
});

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
