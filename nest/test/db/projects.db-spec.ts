import { ConflictException, NotFoundException } from "@nestjs/common";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { MAX_PROJECTS_PER_USER } from "../../src/projects/project-document";
import { ProjectService } from "../../src/services/ProjectService/project.service";

/**
 * Exercises the real SQL against PostgreSQL 16 with every migration applied:
 * ownership scoping, optimistic revisions, the per-user limit and import
 * idempotency all live in the statements themselves, which mocks cannot test.
 * Run through `npm run test:db`.
 */
const document = (marker = "base") => ({
    version: 4,
    updatedAt: 1,
    questionnaire: { items: [], meta: { styleLabel: marker } },
});

describe("ProjectService on PostgreSQL", () => {
    let dataSource: DataSource;
    let service: ProjectService;
    let owner: number;
    let stranger: number;

    beforeAll(async () => {
        dataSource = await new DataSource({
            type: "postgres",
            host: process.env.TEST_DB_HOST,
            port: Number(process.env.TEST_DB_PORT),
            username: "postgres",
            password: process.env.TEST_DB_PASSWORD,
            database: "stylefinder_test",
            installExtensions: false,
            migrations: [join(__dirname, "../../migrations/*.ts")],
        }).initialize();
        await dataSource.runMigrations();
        service = new ProjectService(dataSource);
    });

    afterAll(async () => {
        await dataSource?.destroy();
    });

    beforeEach(async () => {
        await dataSource.query(`DELETE FROM "user"`);
        owner = await createUser("owner@example.test");
        stranger = await createUser("stranger@example.test");
    });

    async function createUser(email: string): Promise<number> {
        const [{ id }] = await dataSource.query(
            `INSERT INTO "user" ("email", "name", "password") VALUES ($1, 'Тест', 'x') RETURNING "id"`,
            [email],
        );
        return id;
    }

    const create = (userId: number, extra: Record<string, unknown> = {}) =>
        service.create(userId, { document: document(), ...extra });

    it("creates, lists newest first and loads the full document", async () => {
        const first = (await create(owner)).project;
        const second = (await create(owner, { name: "Спальня" })).project;

        expect(first).toMatchObject({ name: "Проект 1", revision: 1 });
        expect(second.name).toBe("Спальня");
        const list = await service.list(owner);
        expect(list.map((item) => item.id)).toEqual([second.id, first.id]);
        expect(list[0]).not.toHaveProperty("document");
        await expect(service.get(owner, first.id)).resolves.toMatchObject({
            document: document(),
            documentVersion: 4,
        });
    });

    it("treats someone else's project exactly like a missing one", async () => {
        const { project } = await create(owner);

        await expect(service.get(stranger, project.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
        await expect(
            service.saveDocument(stranger, project.id, {
                document: document("stolen"),
                baseRevision: 1,
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
            service.rename(stranger, project.id, "Чужое"),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
            service.duplicate(stranger, project.id),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
            service.remove(stranger, project.id),
        ).rejects.toBeInstanceOf(NotFoundException);

        await expect(service.get(owner, project.id)).resolves.toMatchObject({
            name: "Проект 1",
            revision: 1,
            document: document(),
        });
        await expect(service.list(stranger)).resolves.toEqual([]);
    });

    it("bumps the revision on save and rejects a stale base", async () => {
        const { project } = await create(owner);

        const saved = await service.saveDocument(owner, project.id, {
            document: document("v2"),
            baseRevision: 1,
        });
        expect(saved.revision).toBe(2);

        const conflict = await service
            .saveDocument(owner, project.id, {
                document: document("stale"),
                baseRevision: 1,
            })
            .catch((error: unknown) => error);
        expect(conflict).toBeInstanceOf(ConflictException);
        expect((conflict as ConflictException).getResponse()).toMatchObject({
            code: "revision-conflict",
            currentRevision: 2,
        });
        await expect(service.get(owner, project.id)).resolves.toMatchObject({
            document: document("v2"),
        });
    });

    it("lets exactly one of many simultaneous saves win", async () => {
        const { project } = await create(owner);

        const results = await Promise.allSettled(
            Array.from({ length: 10 }, (_, index) =>
                service.saveDocument(owner, project.id, {
                    document: document(`tab-${index}`),
                    baseRevision: 1,
                }),
            ),
        );

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(
            results.filter(
                (r) =>
                    r.status === "rejected" &&
                    r.reason instanceof ConflictException,
            ),
        ).toHaveLength(9);
        await expect(service.get(owner, project.id)).resolves.toMatchObject({
            revision: 2,
        });
    });

    it("keeps the summary unless a save provides a new one", async () => {
        const { project } = await create(owner, {
            summary: { styleLabel: "Прованс", stage: "room" },
        });

        await service.saveDocument(owner, project.id, {
            document: document(),
            baseRevision: 1,
        });
        expect((await service.get(owner, project.id)).summary).toEqual({
            styleLabel: "Прованс",
            stage: "room",
        });

        await service.saveDocument(owner, project.id, {
            document: document(),
            baseRevision: 2,
            summary: { stage: "layout", furnitureCount: 6 },
        });
        expect((await service.get(owner, project.id)).summary).toEqual({
            stage: "layout",
            furnitureCount: 6,
        });
    });

    it("renames without touching the document revision", async () => {
        const { project } = await create(owner);

        const renamed = await service.rename(owner, project.id, "Детская");

        expect(renamed).toMatchObject({ name: "Детская", revision: 1 });
    });

    it("duplicates into an independent copy with a bounded name", async () => {
        const { project } = await create(owner, { name: "Я".repeat(80) });

        const copy = await service.duplicate(owner, project.id);
        await service.saveDocument(owner, copy.id, {
            document: document("copy-only"),
            baseRevision: 1,
        });

        expect(copy.id).not.toBe(project.id);
        expect(copy.name).toHaveLength(80);
        expect(copy.name.endsWith(" (копия)")).toBe(true);
        await expect(service.get(owner, project.id)).resolves.toMatchObject({
            document: document(),
        });
    });

    it("holds the per-user limit even under parallel creation", async () => {
        const results = await Promise.allSettled(
            Array.from({ length: MAX_PROJECTS_PER_USER + 10 }, () =>
                create(owner),
            ),
        );

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(
            MAX_PROJECTS_PER_USER,
        );
        const [{ count }] = await dataSource.query(
            `SELECT COUNT(*)::int AS "count" FROM "project" WHERE "owner_user_id" = $1`,
            [owner],
        );
        expect(count).toBe(MAX_PROJECTS_PER_USER);
        const rejected = results.find((r) => r.status === "rejected");
        expect(
            (
                (rejected as PromiseRejectedResult).reason as ConflictException
            ).getResponse(),
        ).toMatchObject({ code: "project-limit" });
        await expect(create(stranger)).resolves.toMatchObject({
            created: true,
        });
    });

    it("imports a guest draft once, however many retries race", async () => {
        const results = await Promise.all(
            Array.from({ length: 6 }, () =>
                create(owner, { clientImportId: "guest-draft-0001" }),
            ),
        );

        expect(new Set(results.map((r) => r.project.id)).size).toBe(1);
        expect(results.filter((r) => r.created)).toHaveLength(1);
        await expect(service.list(owner)).resolves.toHaveLength(1);
        await expect(
            create(stranger, { clientImportId: "guest-draft-0001" }),
        ).resolves.toMatchObject({ created: true });
    });

    it("removes projects with their owner and on explicit delete", async () => {
        const kept = (await create(owner)).project;
        const removed = (await create(owner)).project;

        await service.remove(owner, removed.id);
        await expect(service.get(owner, removed.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
        await expect(service.remove(owner, removed.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );

        await dataSource.query(`DELETE FROM "user" WHERE "id" = $1`, [owner]);
        const rows = await dataSource.query(
            `SELECT 1 FROM "project" WHERE "id" = $1`,
            [kept.id],
        );
        expect(rows).toHaveLength(0);
    });
});
