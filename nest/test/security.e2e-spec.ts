import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request = require("supertest");
import { DataSource } from "typeorm";
import { configureTrustedProxy } from "../src/config/http-runtime";
import { createGlobalValidationPipe } from "../src/config/validation";
import { AuthController } from "../src/controllers/AuthController/auth.controller";
import { HealthController } from "../src/controllers/HealthController/health.controller";
import { AuthEnabledGuard } from "../src/guards/auth-enabled.guard";
import { AuthGuard } from "../src/guards/auth.guard";
import { RegistrationEnabledGuard } from "../src/guards/registration-enabled.guard";
import { CsrfGuard } from "../src/guards/csrf.guard";
import { AuthService } from "../src/services/AuthService/auth.service";
import { SessionService } from "../src/services/SessionService/session.service";
import { AccountRecoveryService } from "../src/services/AccountRecoveryService/account-recovery.service";
import { OperationalLogger } from "../src/services/OperationalLogger/operational-logger.service";

interface HarnessOptions {
    authEnabled?: boolean;
    registrationEnabled?: boolean;
    databaseQuery?: jest.Mock;
    trustProxyHops?: number;
}

interface Harness {
    app: INestApplication;
    baseUrl: string;
    authService: {
        register: jest.Mock;
        login: jest.Mock;
    };
    sessionService: {
        create: jest.Mock;
        authenticate: jest.Mock;
        revoke: jest.Mock;
        revokeAll: jest.Mock;
    };
    recovery: {
        sendVerification: jest.Mock;
        verifyEmail: jest.Mock;
        requestPasswordReset: jest.Mock;
        resetPassword: jest.Mock;
    };
    databaseQuery: jest.Mock;
}

const activeApps: INestApplication[] = [];
const SESSION_TOKEN = "s".repeat(43);
const VALID_LINK_TOKEN = "v".repeat(43);
const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_ENABLED: process.env.AUTH_ENABLED,
    AUTH_REGISTRATION_ENABLED: process.env.AUTH_REGISTRATION_ENABLED,
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
};

describe("Nest 11 / Express 5 security HTTP behavior", () => {
    afterEach(async () => {
        await Promise.all(activeApps.splice(0).map((app) => app.close()));
    });

    afterAll(() => {
        restoreEnvironment("NODE_ENV", originalEnvironment.NODE_ENV);
        restoreEnvironment("AUTH_ENABLED", originalEnvironment.AUTH_ENABLED);
        restoreEnvironment(
            "AUTH_REGISTRATION_ENABLED",
            originalEnvironment.AUTH_REGISTRATION_ENABLED,
        );
        restoreEnvironment("PUBLIC_ORIGIN", originalEnvironment.PUBLIC_ORIGIN);
    });

    it("does not expose a legacy API root endpoint", async () => {
        const harness = await createHarness();

        await request(harness.baseUrl).get("/api").expect(404);
    });

    it("returns 404 for login, registration and profile while auth is disabled", async () => {
        const harness = await createHarness({ authEnabled: false });

        await request(harness.baseUrl)
            .post("/api/auth/login")
            .set("X-Requested-With", "stylefinder")
            .send({ email: "maria@example.com", password: "safe-password" })
            .expect(404);
        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .send({
                name: "Мария",
                email: "maria@example.com",
                password: "safe-password",
            })
            .expect(404);
        await request(harness.baseUrl).get("/api/auth/me").expect(404);

        expect(harness.authService.login).not.toHaveBeenCalled();
        expect(harness.authService.register).not.toHaveBeenCalled();
        expect(harness.sessionService.authenticate).not.toHaveBeenCalled();
    });

    it("applies global DTO validation without echoing rejected passwords", async () => {
        const harness = await createHarness({
            authEnabled: true,
            registrationEnabled: true,
        });

        const unknownProperty = await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .send({
                name: "Мария",
                email: "maria@example.com",
                password: "private-password",
                role: "admin",
            })
            .expect(400);
        const oversizedPassword = "я".repeat(37);
        const oversized = await request(harness.baseUrl)
            .post("/api/auth/login")
            .set("X-Requested-With", "stylefinder")
            .send({
                email: "maria@example.com",
                password: oversizedPassword,
            })
            .expect(400);

        expect(JSON.stringify(unknownProperty.body)).not.toContain(
            "private-password",
        );
        expect(JSON.stringify(oversized.body)).not.toContain(oversizedPassword);
        expect(harness.authService.register).not.toHaveBeenCalled();
        expect(harness.authService.login).not.toHaveBeenCalled();
    });

    it("enforces the strict registration throttle on the fourth request", async () => {
        const harness = await createHarness({
            authEnabled: true,
            registrationEnabled: true,
        });
        const payload = {
            name: "Мария",
            email: "maria@example.com",
            password: "safe-password",
        };

        for (let index = 0; index < 3; index += 1) {
            await request(harness.baseUrl)
                .post("/api/auth/register")
                .set("X-Requested-With", "stylefinder")
                .send(payload)
                .expect(201);
        }
        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .send(payload)
            .expect(429);

        expect(harness.authService.register).toHaveBeenCalledTimes(3);
    });

    it("does not let direct clients bypass throttling with spoofed forwarding headers", async () => {
        const harness = await createHarness({
            authEnabled: true,
            registrationEnabled: true,
            trustProxyHops: 0,
        });
        const payload = {
            name: "Мария",
            email: "maria@example.com",
            password: "safe-password",
        };

        for (let index = 0; index < 3; index += 1) {
            await request(harness.baseUrl)
                .post("/api/auth/register")
                .set("X-Requested-With", "stylefinder")
                .set("X-Forwarded-For", `198.51.100.${index + 1}`)
                .send(payload)
                .expect(201);
        }
        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .set("X-Forwarded-For", "203.0.113.200")
            .send(payload)
            .expect(429);

        expect(harness.authService.register).toHaveBeenCalledTimes(3);
    });

    it("uses the single trusted reverse-proxy hop as the throttling client identity", async () => {
        const harness = await createHarness({
            authEnabled: true,
            registrationEnabled: true,
            trustProxyHops: 1,
        });
        const payload = {
            name: "Мария",
            email: "maria@example.com",
            password: "safe-password",
        };

        for (let index = 0; index < 3; index += 1) {
            await request(harness.baseUrl)
                .post("/api/auth/register")
                .set("X-Requested-With", "stylefinder")
                .set("X-Forwarded-For", "198.51.100.70")
                .send(payload)
                .expect(201);
        }
        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .set("X-Forwarded-For", "198.51.100.70")
            .send(payload)
            .expect(429);

        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .set("X-Forwarded-For", "203.0.113.80")
            .send(payload)
            .expect(201);

        expect(harness.authService.register).toHaveBeenCalledTimes(4);
    });

    it("rejects state changes without the same-origin marker before any auth work", async () => {
        const harness = await createHarness({ authEnabled: true });

        await request(harness.baseUrl)
            .post("/api/auth/login")
            .send({ email: "maria@example.com", password: "safe-password" })
            .expect(403);
        await request(harness.baseUrl)
            .post("/api/auth/login")
            .set("X-Requested-With", "stylefinder")
            .set("Origin", "https://evil.example")
            .send({ email: "maria@example.com", password: "safe-password" })
            .expect(403);

        expect(harness.authService.login).not.toHaveBeenCalled();
    });

    it("signs in with an HttpOnly SameSite cookie and never returns a token", async () => {
        const harness = await createHarness({ authEnabled: true });

        const response = await request(harness.baseUrl)
            .post("/api/auth/login")
            .set("X-Requested-With", "stylefinder")
            .set("Origin", "http://localhost:3000")
            .send({ email: "maria@example.com", password: "safe-password" })
            .expect(200);

        const cookie = String(response.headers["set-cookie"]);
        expect(cookie).toContain(`sf_session=${SESSION_TOKEN}`);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Lax/);
        expect(cookie).toMatch(/Path=\//);
        expect(response.body).toEqual({
            user: {
                id: 1,
                name: "Мария",
                email: "maria@example.com",
                role: "designer",
                emailVerified: false,
            },
        });
        expect(JSON.stringify(response.body)).not.toContain(SESSION_TOKEN);
    });

    it("resolves the profile only from the session cookie", async () => {
        const harness = await createHarness({ authEnabled: true });

        await request(harness.baseUrl)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${SESSION_TOKEN}`)
            .expect(401);
        const profile = await request(harness.baseUrl)
            .get("/api/auth/me")
            .set("Cookie", `sf_session=${SESSION_TOKEN}`)
            .expect(200);

        expect(profile.body.user).toMatchObject({ id: 1, role: "designer" });
        expect(profile.body.user.password).toBeUndefined();
    });

    it("answers the page-load probe without an error for guests", async () => {
        const harness = await createHarness({ authEnabled: true });

        await request(harness.baseUrl)
            .get("/api/auth/session")
            .expect(200, { user: null });
        const signedIn = await request(harness.baseUrl)
            .get("/api/auth/session")
            .set("Cookie", `sf_session=${SESSION_TOKEN}`)
            .expect(200);

        expect(signedIn.body.user).toMatchObject({ id: 1, role: "designer" });
    });

    it("revokes the session and expires the cookie on logout", async () => {
        const harness = await createHarness({ authEnabled: true });

        const response = await request(harness.baseUrl)
            .post("/api/auth/logout")
            .set("X-Requested-With", "stylefinder")
            .set("Cookie", `sf_session=${SESSION_TOKEN}`)
            .expect(204);

        expect(harness.sessionService.revoke).toHaveBeenCalledWith(
            SESSION_TOKEN,
        );
        expect(String(response.headers["set-cookie"])).toMatch(
            /sf_session=;.*Expires=Thu, 01 Jan 1970/,
        );
    });

    it("sends the verification letter after sign-up without blocking it", async () => {
        const harness = await createHarness({
            authEnabled: true,
            registrationEnabled: true,
        });

        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Requested-With", "stylefinder")
            .send({
                name: "Мария",
                email: "maria@example.com",
                password: "safe-password",
            })
            .expect(201);

        expect(harness.recovery.sendVerification).toHaveBeenCalledTimes(1);
    });

    it("answers forgot-password identically for known and unknown addresses", async () => {
        const harness = await createHarness({ authEnabled: true });

        const responses = [];
        for (const email of ["maria@example.com", "nobody@example.com"]) {
            responses.push(
                await request(harness.baseUrl)
                    .post("/api/auth/forgot-password")
                    .set("X-Requested-With", "stylefinder")
                    .send({ email })
                    .expect(202),
            );
        }

        expect(responses[0].body).toEqual({ accepted: true });
        expect(responses[1].body).toEqual(responses[0].body);
        expect(responses[0].headers["set-cookie"]).toBeUndefined();
        expect(harness.recovery.requestPasswordReset).toHaveBeenCalledTimes(2);
    });

    it("rejects an unknown verification link with a generic 400", async () => {
        const harness = await createHarness({ authEnabled: true });

        const rejected = await request(harness.baseUrl)
            .post("/api/auth/verify-email")
            .set("X-Requested-With", "stylefinder")
            .send({ token: "u".repeat(43) })
            .expect(400);
        const accepted = await request(harness.baseUrl)
            .post("/api/auth/verify-email")
            .set("X-Requested-With", "stylefinder")
            .send({ token: VALID_LINK_TOKEN })
            .expect(200);

        expect(rejected.body.message).toMatch(/Ссылка недействительна/);
        expect(accepted.body.user.emailVerified).toBe(true);
    });

    it("signs in with a fresh session after a successful password reset", async () => {
        const harness = await createHarness({ authEnabled: true });

        await request(harness.baseUrl)
            .post("/api/auth/reset-password")
            .set("X-Requested-With", "stylefinder")
            .send({ token: "u".repeat(43), password: "new-password-1" })
            .expect(400);
        const reset = await request(harness.baseUrl)
            .post("/api/auth/reset-password")
            .set("X-Requested-With", "stylefinder")
            .send({ token: VALID_LINK_TOKEN, password: "new-password-1" })
            .expect(200);

        expect(String(reset.headers["set-cookie"])).toContain(
            `sf_session=${SESSION_TOKEN}`,
        );
        expect(JSON.stringify(reset.body)).not.toContain("new-password-1");
    });

    it("lets only a signed-in user request another verification letter", async () => {
        const harness = await createHarness({ authEnabled: true });

        await request(harness.baseUrl)
            .post("/api/auth/resend-verification")
            .set("X-Requested-With", "stylefinder")
            .expect(401);
        await request(harness.baseUrl)
            .post("/api/auth/resend-verification")
            .set("X-Requested-With", "stylefinder")
            .set("Cookie", `sf_session=${SESSION_TOKEN}`)
            .expect(204);

        expect(harness.recovery.sendVerification).toHaveBeenCalledTimes(1);
    });

    it("serves live/ready and maps database failures to a bounded 503", async () => {
        const query = jest.fn().mockResolvedValue([{ ok: 1 }]);
        const harness = await createHarness({ databaseQuery: query });

        await request(harness.baseUrl)
            .get("/api/health/live")
            .expect(200, { status: "ok", service: "stylefinder-api" });
        await request(harness.baseUrl)
            .get("/api/health/ready")
            .expect(200, {
                status: "ok",
                service: "stylefinder-api",
                checks: { database: "up" },
            });

        query.mockRejectedValueOnce(new Error("secret database failure"));
        const failure = await request(harness.baseUrl)
            .get("/api/health/ready")
            .expect(503);
        expect(JSON.stringify(failure.body)).not.toContain(
            "secret database failure",
        );
    });
});

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
    process.env.NODE_ENV = "test";
    process.env.AUTH_ENABLED = String(options.authEnabled ?? false);
    process.env.AUTH_REGISTRATION_ENABLED = String(
        options.registrationEnabled ?? false,
    );
    process.env.PUBLIC_ORIGIN = "http://localhost:3000";

    const user = {
        id: 1,
        name: "Мария",
        email: "maria@example.com",
        role: "designer",
        password: "$2b$12$never-returned",
        emailVerifiedAt: null,
    };
    const recovery = {
        sendVerification: jest.fn().mockResolvedValue(true),
        verifyEmail: jest.fn(async (token: string) =>
            token === VALID_LINK_TOKEN
                ? { ...user, emailVerifiedAt: new Date() }
                : null,
        ),
        requestPasswordReset: jest.fn().mockResolvedValue(undefined),
        resetPassword: jest.fn(async (token: string) =>
            token === VALID_LINK_TOKEN ? user : null,
        ),
    };
    const authService = {
        register: jest.fn().mockResolvedValue(user),
        login: jest.fn().mockResolvedValue(user),
    };
    const sessionService = {
        create: jest.fn().mockResolvedValue({
            token: SESSION_TOKEN,
            session: { id: "session-1" },
        }),
        authenticate: jest.fn(async (token?: string) =>
            token === SESSION_TOKEN
                ? { user, session: { id: "session-1" } }
                : null,
        ),
        revoke: jest.fn().mockResolvedValue(undefined),
        revokeAll: jest.fn().mockResolvedValue(undefined),
    };
    const databaseQuery =
        options.databaseQuery ?? jest.fn().mockResolvedValue([{ ok: 1 }]);
    const dataSource = {
        isInitialized: true,
        query: databaseQuery,
    };
    const operationalLogger = {
        health: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
        imports: [
            ThrottlerModule.forRoot([
                { ttl: 60_000, limit: 120, blockDuration: 60_000 },
            ]),
        ],
        controllers: [AuthController, HealthController],
        providers: [
            AuthEnabledGuard,
            AuthGuard,
            RegistrationEnabledGuard,
            { provide: AuthService, useValue: authService },
            { provide: SessionService, useValue: sessionService },
            { provide: AccountRecoveryService, useValue: recovery },
            { provide: DataSource, useValue: dataSource },
            { provide: OperationalLogger, useValue: operationalLogger },
            { provide: APP_GUARD, useClass: CsrfGuard },
            { provide: APP_GUARD, useClass: ThrottlerGuard },
        ],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(createGlobalValidationPipe());
    configureTrustedProxy(
        app.getHttpAdapter().getInstance(),
        options.trustProxyHops ?? 0,
    );
    await app.listen(0, "127.0.0.1");
    activeApps.push(app);

    const address = app.getHttpServer().address() as { port: number };
    return {
        app,
        baseUrl: `http://127.0.0.1:${address.port}`,
        authService,
        sessionService,
        recovery,
        databaseQuery,
    };
}

function restoreEnvironment(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
