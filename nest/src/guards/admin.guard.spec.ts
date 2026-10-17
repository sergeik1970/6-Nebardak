import { ForbiddenException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common";
import { AdminGuard } from "./admin.guard";

const contextFor = (role: "designer" | "admin") =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ user: { role } }),
        }),
    }) as unknown as ExecutionContext;

describe("AdminGuard", () => {
    const guard = new AdminGuard();

    it("allows an explicitly elevated account", () => {
        expect(guard.canActivate(contextFor("admin"))).toBe(true);
    });

    it("denies a regular designer account", () => {
        expect(() => guard.canActivate(contextFor("designer"))).toThrow(
            ForbiddenException,
        );
    });
});
