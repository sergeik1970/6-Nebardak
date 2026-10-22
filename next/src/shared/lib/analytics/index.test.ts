import { describe, expect, it } from "vitest";
import { trackGoal } from ".";

describe("trackGoal", () => {
    it("does nothing before Metrika is loaded", () => {
        expect(() => trackGoal("test_start")).not.toThrow();
    });
});
