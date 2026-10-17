import { describe, expect, it } from "vitest";
import { readPublicFlag, resolveAuthUiMode } from "./runtime";

describe("public runtime flags", () => {
    it("parses explicit public boolean values and uses the fallback only when absent", () => {
        expect(readPublicFlag(undefined, true)).toBe(true);
        expect(readPublicFlag("", false)).toBe(false);
        expect(readPublicFlag("YES", false)).toBe(true);
        expect(readPublicFlag("0", true)).toBe(false);
    });

    it("keeps registration subordinate to the auth feature", () => {
        expect(resolveAuthUiMode(false, false)).toBe("off");
        expect(resolveAuthUiMode(false, true)).toBe("off");
        expect(resolveAuthUiMode(true, false)).toBe("login");
        expect(resolveAuthUiMode(true, true)).toBe("login-registration");
    });
});
