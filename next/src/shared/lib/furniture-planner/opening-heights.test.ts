import { describe, expect, it } from "vitest";

import {
    getDoorHeight,
    getDoorHeightError,
    getWindowHeight,
    getWindowHeightError,
    getWindowSillHeight,
} from "./opening-heights";

describe("opening heights", () => {
    it("falls back to the standard heights for older drafts", () => {
        expect(getDoorHeight({})).toBe(2100);
        expect(getWindowHeight({})).toBe(1500);
        expect(getWindowSillHeight({})).toBe(850);
        expect(getWindowHeight({ windowKind: "floor-to-ceiling" })).toBe(2400);
    });

    it("keeps a panoramic window on the floor", () => {
        expect(getWindowSillHeight({ windowKind: "floor-to-ceiling", sillHeight: 600 })).toBe(0);
        expect(getWindowSillHeight({ windowKind: "standard", sillHeight: 600 })).toBe(600);
    });

    it("rejects heights outside the room", () => {
        expect(getDoorHeightError(2100)).toBeNull();
        expect(getDoorHeightError(1000)).toMatch("Высота двери");
        expect(getDoorHeightError(2800)).toMatch("Высота двери");
        expect(getWindowHeightError(1500, 850)).toBeNull();
        expect(getWindowHeightError(1500, 1300)).toMatch("не выше потолка");
        expect(getWindowHeightError(100, 850)).toMatch("Высота окна");
        expect(getWindowHeightError(1500, -10)).toMatch("подоконника");
    });
});
