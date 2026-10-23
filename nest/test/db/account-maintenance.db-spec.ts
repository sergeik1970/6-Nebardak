import { join } from "node:path";
import { DataSource } from "typeorm";
import { AccountMaintenanceService } from "../../src/services/AccountMaintenanceService/account-maintenance.service";
import { AdminLoginCodeService } from "../../src/services/AdminLoginCodeService/admin-login-code.service";
import { EmailTokenService } from "../../src/services/EmailTokenService/email-token.service";
import { OperationalLogger } from "../../src/services/OperationalLogger/operational-logger.service";

/**
 * The clean-up deletes accounts and, by cascade, their projects, so its SQL
 * is checked on PostgreSQL 16 with every migration applied. Run through
 * `npm run test:db`.
 */
const DAY_MS = 24 * 60 * 60_000;
const now = new Date("2026-10-21T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

describe("AccountMaintenanceService on PostgreSQL", () => {
    let dataSource: DataSource;
    let service: AccountMaintenanceService;

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
        service = new AccountMaintenanceService(
            dataSource,
            { purge: jest.fn() } as unknown as EmailTokenService,
            { purge: jest.fn() } as unknown as AdminLoginCodeService,
            { event: jest.fn() } as unknown as OperationalLogger,
        );
    });

    afterAll(async () => {
        await dataSource?.destroy();
    });

    beforeEach(async () => {
        await dataSource.query(`DELETE FROM "user"`);
    });

    async function createUser(
        email: string,
        options: {
            createdAt: Date;
            consentAt?: Date | null;
            verifiedAt?: Date | null;
            role?: string;
        },
    ): Promise<number> {
        const [{ id }] = await dataSource.query(
            `INSERT INTO "user"
                ("email", "name", "password", "role", "createdAt", "consentAt", "consentVersion", "emailVerifiedAt")
             VALUES ($1, 'Тест', 'x', $2, $3, $4, $5, $6) RETURNING "id"`,
            [
                email,
                options.role ?? "designer",
                options.createdAt,
                options.consentAt ?? null,
                options.consentAt ? "2026-10" : null,
                options.verifiedAt ?? null,
            ],
        );
        await dataSource.query(
            `INSERT INTO "project" ("owner_user_id", "name", "document", "document_version")
             VALUES ($1, 'Проект', '{"version":5}'::jsonb, 5)`,
            [id],
        );
        return id;
    }

    const remaining = async (): Promise<string[]> =>
        (
            await dataSource.query(
                `SELECT "email" FROM "user" ORDER BY "email"`,
            )
        ).map((row: { email: string }) => row.email);

    it("removes only stale unverified sign-ups and keeps accounts from before consent", async () => {
        await createUser("legacy@example.test", { createdAt: daysAgo(400) });
        await createUser("stale@example.test", {
            createdAt: daysAgo(40),
            consentAt: daysAgo(40),
        });
        await createUser("fresh@example.test", {
            createdAt: daysAgo(5),
            consentAt: daysAgo(5),
        });
        await createUser("verified@example.test", {
            createdAt: daysAgo(40),
            consentAt: daysAgo(40),
            verifiedAt: daysAgo(39),
        });
        const active = await createUser("active@example.test", {
            createdAt: daysAgo(40),
            consentAt: daysAgo(40),
        });
        await dataSource.query(
            `INSERT INTO "user_session"
                ("user_id", "token_hash", "last_seen_at", "expires_at", "absolute_expires_at")
             VALUES ($1, repeat('a', 64), $2, $3, $3)`,
            [active, daysAgo(2), daysAgo(-28)],
        );

        await expect(service.deleteStaleUnverifiedAccounts(now)).resolves.toBe(
            1,
        );

        expect(await remaining()).toEqual([
            "active@example.test",
            "fresh@example.test",
            "legacy@example.test",
            "verified@example.test",
        ]);
        // The deleted account's projects went with it; nobody else's did.
        const [{ count }] = await dataSource.query(
            `SELECT COUNT(*)::int AS "count" FROM "project"`,
        );
        expect(count).toBe(4);
    });
});
