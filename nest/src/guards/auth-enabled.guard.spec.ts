import { NotFoundException } from "@nestjs/common";
import { AuthEnabledGuard } from "./auth-enabled.guard";

describe("AuthEnabledGuard", () => {
    const originalValue = process.env.AUTH_ENABLED;
    const guard = new AuthEnabledGuard();

    afterEach(() => {
        if (originalValue === undefined) {
            delete process.env.AUTH_ENABLED;
        } else {
            process.env.AUTH_ENABLED = originalValue;
        }
    });

    it("hides every auth route by default", () => {
        delete process.env.AUTH_ENABLED;

        expect(() => guard.canActivate()).toThrow(NotFoundException);
    });

    it("allows auth routes only when explicitly enabled", () => {
        process.env.AUTH_ENABLED = "true";

        expect(guard.canActivate()).toBe(true);
    });
});
