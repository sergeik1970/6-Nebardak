import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "../services/AuthService/auth.service";
import { User } from "../entities/User/user.entity";

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
    const user = {
        id: 1,
        name: "Мария",
        email: "maria@example.com",
    } as User;
    const authService = {
        validateToken: jest.fn(),
    } as unknown as AuthService;
    const guard = new AuthGuard(authService);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("rejects a missing Authorization header", async () => {
        await expect(
            guard.canActivate(makeContext({ headers: {} })),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(authService.validateToken).not.toHaveBeenCalled();
    });

    it.each(["token-only", "Basic abc", "Bearer", "Bearer abc extra"])(
        "rejects malformed credentials: %s",
        async (authorization) => {
            await expect(
                guard.canActivate(makeContext({ headers: { authorization } })),
            ).rejects.toBeInstanceOf(UnauthorizedException);
            expect(authService.validateToken).not.toHaveBeenCalled();
        },
    );

    it("rejects a token that the auth service cannot validate", async () => {
        (authService.validateToken as jest.Mock).mockResolvedValue(null);

        await expect(
            guard.canActivate(
                makeContext({ headers: { authorization: "Bearer invalid" } }),
            ),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(authService.validateToken).toHaveBeenCalledWith("invalid");
    });

    it("accepts a Bearer token and attaches the validated user", async () => {
        (authService.validateToken as jest.Mock).mockResolvedValue(user);
        const request = {
            headers: { authorization: "bearer valid-token" },
        } as Partial<AuthenticatedRequest>;

        await expect(guard.canActivate(makeContext(request))).resolves.toBe(
            true,
        );
        expect(request.user).toBe(user);
    });
});
