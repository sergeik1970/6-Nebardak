import { NotFoundException } from "@nestjs/common";
import { RegistrationEnabledGuard } from "./registration-enabled.guard";

describe("RegistrationEnabledGuard", () => {
    const originalValue = process.env.AUTH_REGISTRATION_ENABLED;
    const guard = new RegistrationEnabledGuard();

    afterEach(() => {
        if (originalValue === undefined) {
            delete process.env.AUTH_REGISTRATION_ENABLED;
        } else {
            process.env.AUTH_REGISTRATION_ENABLED = originalValue;
        }
    });

    it("hides the registration route by default", () => {
        delete process.env.AUTH_REGISTRATION_ENABLED;

        expect(() => guard.canActivate()).toThrow(NotFoundException);
    });

    it("allows registration only when explicitly enabled", () => {
        process.env.AUTH_REGISTRATION_ENABLED = "true";

        expect(guard.canActivate()).toBe(true);
    });
});
