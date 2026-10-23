import { ConflictException, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request = require("supertest");
import {
    configureBodyParsers,
    configureNoStore,
    configureTrustedProxy,
} from "../src/config/http-runtime";
import { createGlobalValidationPipe } from "../src/config/validation";
import { AuthController } from "../src/controllers/AuthController/auth.controller";
import { ProjectsController } from "../src/controllers/ProjectsController/projects.controller";
import { AuthEnabledGuard } from "../src/guards/auth-enabled.guard";
import { AuthGuard } from "../src/guards/auth.guard";
import { CsrfGuard } from "../src/guards/csrf.guard";
import { RegistrationEnabledGuard } from "../src/guards/registration-enabled.guard";
import { AccountRecoveryService } from "../src/services/AccountRecoveryService/account-recovery.service";
import { AdminLoginCodeService } from "../src/services/AdminLoginCodeService/admin-login-code.service";
import { AuthService } from "../src/services/AuthService/auth.service";
import { ProjectService } from "../src/services/ProjectService/project.service";
import { SessionService } from "../src/services/SessionService/session.service";

const SESSION_TOKEN = "p".repeat(43);
const PROJECT_ID = "3f0c2a52-9a43-4c2b-8f3e-2b1d7c9e4a10";
const document = { version: 4, questionnaire: { items: [] } };
const project = {
    id: PROJECT_ID,
    name: "Проект 1",
    summary: {},
    documentVersion: 4,
    revision: 1,
    createdAt: new Date("2026-10-20T10:00:00Z"),
    updatedAt: new Date("2026-10-20T10:00:00Z"),
    document,
};

const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_ENABLED: process.env.AUTH_ENABLED,
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
};

describe("projects HTTP contract", () => {
    let app: INestApplication;
    let baseUrl: string;
    let projects: Record<string, jest.Mock>;

    beforeEach(async () => {
        process.env.NODE_ENV = "test";
        process.env.AUTH_ENABLED = "true";
        process.env.PUBLIC_ORIGIN = "http://localhost:3000";

        projects = {
            list: jest.fn().mockResolvedValue([project]),
            get: jest.fn().mockResolvedValue(project),
            create: jest.fn().mockResolvedValue({ project, created: true }),
            saveDocument: jest.fn().mockResolvedValue({
                revision: 2,
                updatedAt: new Date("2026-10-20T10:01:00Z"),
            }),
            rename: jest.fn().mockResolvedValue(project),
            duplicate: jest.fn().mockResolvedValue(project),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        const user = { id: 7, name: "Мария", role: "designer" };

        const moduleRef = await Test.createTestingModule({
            imports: [
                ThrottlerModule.forRoot([
                    { ttl: 60_000, limit: 1_000, blockDuration: 60_000 },
                ]),
            ],
            controllers: [ProjectsController, AuthController],
            providers: [
                AuthGuard,
                AuthEnabledGuard,
                RegistrationEnabledGuard,
                { provide: ProjectService, useValue: projects },
                {
                    provide: SessionService,
                    useValue: {
                        authenticate: jest.fn(async (token?: string) =>
                            token === SESSION_TOKEN
                                ? { user, session: { id: "session-7" } }
                                : null,
                        ),
                    },
                },
                { provide: AuthService, useValue: { login: jest.fn() } },
                { provide: AccountRecoveryService, useValue: {} },
                { provide: AdminLoginCodeService, useValue: {} },
                { provide: APP_GUARD, useClass: CsrfGuard },
                { provide: APP_GUARD, useClass: ThrottlerGuard },
            ],
        }).compile();

        app = moduleRef.createNestApplication({ bodyParser: false });
        configureBodyParsers(app);
        configureNoStore(app);
        app.setGlobalPrefix("api");
        app.useGlobalPipes(createGlobalValidationPipe());
        configureTrustedProxy(app.getHttpAdapter().getInstance(), 0);
        await app.listen(0, "127.0.0.1");
        const { port } = app.getHttpServer().address() as { port: number };
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        await app.close();
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    const signedIn = (
        method: "get" | "post" | "put" | "patch" | "delete",
        path: string,
    ) =>
        request(baseUrl)
            [method](path)
            .set("Cookie", `sf_session=${SESSION_TOKEN}`)
            .set("X-Requested-With", "stylefinder");

    it("requires a session for every project route", async () => {
        await request(baseUrl).get("/api/projects").expect(401);
        await request(baseUrl).get(`/api/projects/${PROJECT_ID}`).expect(401);
        await request(baseUrl)
            .delete(`/api/projects/${PROJECT_ID}`)
            .set("X-Requested-With", "stylefinder")
            .expect(401);

        expect(projects.list).not.toHaveBeenCalled();
        expect(projects.remove).not.toHaveBeenCalled();
    });

    it("rejects a cross-site write even with a valid session", async () => {
        await request(baseUrl)
            .delete(`/api/projects/${PROJECT_ID}`)
            .set("Cookie", `sf_session=${SESSION_TOKEN}`)
            .expect(403);

        expect(projects.remove).not.toHaveBeenCalled();
    });

    it("scopes every call to the signed-in owner", async () => {
        const list = await signedIn("get", "/api/projects").expect(200);
        await signedIn("get", `/api/projects/${PROJECT_ID}`).expect(200);

        expect(list.body).toMatchObject({ limit: 50 });
        // Project documents are personal data: never kept by any cache.
        expect(list.headers["cache-control"]).toBe("no-store");
        expect(projects.list).toHaveBeenCalledWith(7);
        expect(projects.get).toHaveBeenCalledWith(7, PROJECT_ID);
    });

    it.each(["not-a-uuid", "1", "' OR 1=1 --"])(
        "rejects the malformed id %p before touching storage",
        async (id) => {
            await signedIn(
                "get",
                `/api/projects/${encodeURIComponent(id)}`,
            ).expect(400);
            expect(projects.get).not.toHaveBeenCalled();
        },
    );

    it("answers 201 for a new project and 200 for a retried import", async () => {
        await signedIn("post", "/api/projects")
            .send({ document, clientImportId: "guest-draft-01" })
            .expect(201);
        projects.create.mockResolvedValueOnce({ project, created: false });
        await signedIn("post", "/api/projects")
            .send({ document, clientImportId: "guest-draft-01" })
            .expect(200);
    });

    it("passes the revision conflict through with the server's revision", async () => {
        projects.saveDocument.mockRejectedValueOnce(
            new ConflictException({
                statusCode: 409,
                code: "revision-conflict",
                message: "Проект изменён",
                currentRevision: 5,
            }),
        );

        const conflict = await signedIn(
            "put",
            `/api/projects/${PROJECT_ID}/document`,
        )
            .send({ document, baseRevision: 3 })
            .expect(409);

        expect(conflict.body).toMatchObject({
            code: "revision-conflict",
            currentRevision: 5,
        });
    });

    it("accepts a near-1 MB project but keeps other routes at 100 KB", async () => {
        const large = {
            version: 4,
            planner: { notes: "x".repeat(1_000_000) },
        };

        await signedIn("put", `/api/projects/${PROJECT_ID}/document`)
            .send({ document: large, baseRevision: 1 })
            .expect(200);
        await signedIn("put", `/api/projects/${PROJECT_ID}/document`)
            .send({
                document: {
                    version: 4,
                    planner: { notes: "x".repeat(1_200_000) },
                },
                baseRevision: 1,
            })
            .expect(413);
        await request(baseUrl)
            .post("/api/auth/login")
            .set("X-Requested-With", "stylefinder")
            .send({ email: "maria@example.com", password: "x".repeat(200_000) })
            .expect(413);
    });

    it("validates the document envelope before the service runs", async () => {
        const response = await signedIn(
            "put",
            `/api/projects/${PROJECT_ID}/document`,
        )
            .send({ document: { version: 4, secret: 1 }, baseRevision: 1 })
            .expect(400);

        expect(JSON.stringify(response.body)).toContain("неизвестные данные");
        expect(projects.saveDocument).not.toHaveBeenCalled();
    });
});
