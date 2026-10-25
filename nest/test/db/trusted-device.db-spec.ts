import { join } from "node:path";
import { DataSource } from "typeorm";
import { TrustedDevice } from "../../src/entities/TrustedDevice/trusted-device.entity";
import { User } from "../../src/entities/User/user.entity";
import {
    MAX_TRUSTED_DEVICES_PER_USER,
    TRUSTED_DEVICE_TTL_MS,
    TrustedDeviceService,
} from "../../src/services/TrustedDeviceService/trusted-device.service";

/**
 * The account binding, expiry and pruning are SQL filters, so they are
 * checked on PostgreSQL 16 with every migration applied. Run through
 * `npm run test:db`.
 */
describe("TrustedDeviceService on PostgreSQL", () => {
    let dataSource: DataSource;
    let service: TrustedDeviceService;
    let adminId: number;
    let otherId: number;

    beforeAll(async () => {
        dataSource = await new DataSource({
            type: "postgres",
            host: process.env.TEST_DB_HOST,
            port: Number(process.env.TEST_DB_PORT),
            username: "postgres",
            password: process.env.TEST_DB_PASSWORD,
            database: "stylefinder_test",
            installExtensions: false,
            entities: [User, TrustedDevice],
            migrations: [join(__dirname, "../../migrations/*.ts")],
        }).initialize();
        await dataSource.runMigrations();
    });

    afterAll(async () => {
        await dataSource?.destroy();
    });

    beforeEach(async () => {
        await dataSource.query(`DELETE FROM "user"`);
        const rows: Array<{ id: number }> = await dataSource.query(
            `INSERT INTO "user" ("email", "name", "password", "role")
             VALUES ('admin@example.test', 'Админ', 'x', 'admin'),
                    ('other@example.test', 'Другой', 'x', 'admin')
             RETURNING "id"`,
        );
        [adminId, otherId] = rows.map((row) => row.id);
        service = new TrustedDeviceService(
            dataSource.getRepository(TrustedDevice),
        );
    });

    const deviceCount = async () =>
        Number(
            (
                await dataSource.query(
                    `SELECT count(*) AS n FROM "trusted_device"`,
                )
            )[0].n,
        );

    it("trusts a device only for its own account and until it expires", async () => {
        const issuedAt = new Date();
        const { token } = await service.issue(adminId, issuedAt);

        await expect(service.isTrusted(adminId, token)).resolves.toBe(true);
        await expect(service.isTrusted(otherId, token)).resolves.toBe(false);
        await expect(
            service.isTrusted(
                adminId,
                token,
                new Date(issuedAt.getTime() + TRUSTED_DEVICE_TTL_MS),
            ),
        ).resolves.toBe(false);
    });

    it("keeps only the newest devices of an account", async () => {
        const start = Date.now();
        const tokens: string[] = [];
        for (let i = 0; i <= MAX_TRUSTED_DEVICES_PER_USER; i += 1) {
            const { token } = await service.issue(adminId, new Date(start));
            tokens.push(token);
            // created_at comes from the database clock; keep the order strict.
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await service.issue(otherId);

        expect(await deviceCount()).toBe(MAX_TRUSTED_DEVICES_PER_USER + 1);
        await expect(service.isTrusted(adminId, tokens[0])).resolves.toBe(
            false,
        );
        await expect(
            service.isTrusted(adminId, tokens[tokens.length - 1]),
        ).resolves.toBe(true);
    });

    it("forgets one account's devices and cascades with the account", async () => {
        const { token: otherToken } = await service.issue(otherId);
        await service.issue(adminId);
        await service.issue(adminId);

        await service.revokeAll(adminId);
        expect(await deviceCount()).toBe(1);
        await expect(service.isTrusted(otherId, otherToken)).resolves.toBe(
            true,
        );

        await dataSource.query(`DELETE FROM "user" WHERE "id" = $1`, [otherId]);
        expect(await deviceCount()).toBe(0);
    });
});
