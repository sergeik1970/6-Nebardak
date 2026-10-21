import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "./auth.guard";
import { SessionService } from "../services/SessionService/session.service";
import { User } from "../entities/User/user.entity";
import { UserSession } from "../entities/UserSession/user-session.entity";

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;
}

const token = "a".repeat(43);

describe("AuthGuard", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const user = {
        id: 1,
        name: "Мария",
        email: "maria@example.com",
    } as User;
    const session = { id: "session-1" } as UserSession;
    const sessionService = {
        authenticate: jest.fn(),
    } as unknown as SessionService;
    const guard = new AuthGuard(sessionService);

    beforeEach(() => {
        process.env.NODE_ENV = "test";
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it("rejects a request without the session cookie", async () => {
        (sessionService.authenticate as jest.Mock).mockResolvedValue(null);

        await expect(
            guard.canActivate(makeContext({ headers: {} })),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(sessionService.authenticate).toHaveBeenCalledWith(undefined);
    });

    it("ignores a bearer header: cookies are the only credential", async () => {
        (sessionService.authenticate as jest.Mock).mockResolvedValue(null);

        await expect(
            guard.canActivate(
                makeContext({
                    headers: { authorization: `Bearer ${token}` },
                }),
            ),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(sessionService.authenticate).toHaveBeenCalledWith(undefined);
    });

    it("rejects a duplicated session cookie instead of guessing", async () => {
        (sessionService.authenticate as jest.Mock).mockResolvedValue(null);

        await expect(
            guard.canActivate(
                makeContext({
                    headers: {
                        cookie: `sf_session=${token}; sf_session=${"b".repeat(43)}`,
                    },
                }),
            ),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(sessionService.authenticate).toHaveBeenCalledWith(undefined);
    });

    it("attaches the user and session of a valid cookie", async () => {
        (sessionService.authenticate as jest.Mock).mockResolvedValue({
            user,
            session,
        });
        const request = {
            headers: { cookie: `theme=dark; sf_session=${token}` },
        } as Partial<AuthenticatedRequest>;

        await expect(guard.canActivate(makeContext(request))).resolves.toBe(
            true,
        );
        expect(sessionService.authenticate).toHaveBeenCalledWith(token);
        expect(request.user).toBe(user);
        expect(request.session).toBe(session);
    });
});
