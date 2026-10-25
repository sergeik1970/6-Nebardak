import { ForbiddenException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common";
import { AdminGuard } from "./admin.guard";

const contextFor = (
    role: "designer" | "admin",
    secondFactorAt: Date | null = new Date(),
) =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ user: { role }, session: { secondFactorAt } }),
        }),
    }) as unknown as ExecutionContext;

describe("AdminGuard", () => {
    const guard = new AdminGuard();

    it("allows an explicitly elevated account that passed the emailed code", () => {
        expect(guard.canActivate(contextFor("admin"))).toBe(true);
    });

    it("denies a regular designer account", () => {
        expect(() => guard.canActivate(contextFor("designer"))).toThrow(
            ForbiddenException,
        );
    });

    it("denies an administrator session opened without the code", () => {
        expect(() => guard.canActivate(contextFor("admin", null))).toThrow(
            "администратору нужен код из письма",
        );
    });
});
