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
import { AuthService } from "../src/services/AuthService/auth.service";
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
        validateToken: jest.Mock;
    };
    databaseQuery: jest.Mock;
}

const activeApps: INestApplication[] = [];
const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_ENABLED: process.env.AUTH_ENABLED,
    AUTH_REGISTRATION_ENABLED: process.env.AUTH_REGISTRATION_ENABLED,
    JWT_SECRET: process.env.JWT_SECRET,
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
        restoreEnvironment("JWT_SECRET", originalEnvironment.JWT_SECRET);
    });

    it("does not expose a legacy API root endpoint", async () => {
        const harness = await createHarness();

        await request(harness.baseUrl).get("/api").expect(404);
    });

    it("returns 404 for login, registration and profile while auth is disabled", async () => {
        const harness = await createHarness({ authEnabled: false });

        await request(harness.baseUrl)
            .post("/api/auth/login")
            .send({ email: "maria@example.com", password: "safe-password" })
            .expect(404);
        await request(harness.baseUrl)
            .post("/api/auth/register")
            .send({
                name: "Мария",
                email: "maria@example.com",
                password: "safe-password",
            })
            .expect(404);
        await request(harness.baseUrl).get("/api/auth/me").expect(404);

        expect(harness.authService.login).not.toHaveBeenCalled();
        expect(harness.authService.register).not.toHaveBeenCalled();
        expect(harness.authService.validateToken).not.toHaveBeenCalled();
    });

    it("applies global DTO validation without echoing rejected passwords", async () => {
        const harness = await createHarness({
            authEnabled: true,
            registrationEnabled: true,
        });

        const unknownProperty = await request(harness.baseUrl)
            .post("/api/auth/register")
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
                .send(payload)
                .expect(201);
        }
        await request(harness.baseUrl)
            .post("/api/auth/register")
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
                .set("X-Forwarded-For", `198.51.100.${index + 1}`)
                .send(payload)
                .expect(201);
        }
        await request(harness.baseUrl)
            .post("/api/auth/register")
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
                .set("X-Forwarded-For", "198.51.100.70")
                .send(payload)
                .expect(201);
        }
        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Forwarded-For", "198.51.100.70")
            .send(payload)
            .expect(429);

        await request(harness.baseUrl)
            .post("/api/auth/register")
            .set("X-Forwarded-For", "203.0.113.80")
            .send(payload)
            .expect(201);

        expect(harness.authService.register).toHaveBeenCalledTimes(4);
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
    process.env.JWT_SECRET = "test-only-e2e-jwt-secret-long-enough-2026";

    const authService = {
        register: jest.fn().mockResolvedValue({ user: { id: 1 }, token: "t" }),
        login: jest.fn().mockResolvedValue({ user: { id: 1 }, token: "t" }),
        validateToken: jest.fn().mockResolvedValue(null),
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
            { provide: DataSource, useValue: dataSource },
            { provide: OperationalLogger, useValue: operationalLogger },
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
