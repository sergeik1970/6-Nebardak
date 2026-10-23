import { join } from "node:path";
import { DataSource } from "typeorm";
import { LoginChallenge } from "../../src/entities/LoginChallenge/login-challenge.entity";
import { User } from "../../src/entities/User/user.entity";
import { UserSession } from "../../src/entities/UserSession/user-session.entity";
import {
    AdminLoginCodeService,
    LOGIN_CODE_MAX_ATTEMPTS,
} from "../../src/services/AdminLoginCodeService/admin-login-code.service";
import { MailService } from "../../src/services/MailService/mail.service";
import { MailMessage } from "../../src/services/MailService/mail-templates";
import { OperationalLogger } from "../../src/services/OperationalLogger/operational-logger.service";

/**
 * The attempt budget and single use live in conditional UPDATE/DELETE
 * statements, so they are checked on PostgreSQL 16 with every migration
 * applied. Run through `npm run test:db`.
 */
describe("AdminLoginCodeService on PostgreSQL", () => {
    let dataSource: DataSource;
    let service: AdminLoginCodeService;
    let sent: MailMessage[];
    let admin: User;

    beforeAll(async () => {
        dataSource = await new DataSource({
            type: "postgres",
            host: process.env.TEST_DB_HOST,
            port: Number(process.env.TEST_DB_PORT),
            username: "postgres",
            password: process.env.TEST_DB_PASSWORD,
            database: "stylefinder_test",
            installExtensions: false,
            entities: [User, UserSession, LoginChallenge],
            migrations: [join(__dirname, "../../migrations/*.ts")],
        }).initialize();
        await dataSource.runMigrations();
    });

    afterAll(async () => {
        await dataSource?.destroy();
    });

    beforeEach(async () => {
        await dataSource.query(`DELETE FROM "user"`);
        const [{ id }] = await dataSource.query(
            `INSERT INTO "user" ("email", "name", "password", "role")
             VALUES ('admin@example.test', 'Админ', 'x', 'admin') RETURNING "id"`,
        );
        admin = { id, email: "admin@example.test", name: "Админ" } as User;
        sent = [];
        service = new AdminLoginCodeService(
            dataSource.getRepository(LoginChallenge),
            {
                send: async (message: MailMessage) => {
                    sent.push(message);
                },
            } as unknown as MailService,
            { event: jest.fn() } as unknown as OperationalLogger,
        );
    });

    const lastCode = () => /\b(\d{6})\b/.exec(sent[sent.length - 1].text)![1];
    const wrongCode = () => (lastCode() === "000000" ? "111111" : "000000");
    const pendingCount = async () =>
        Number(
            (
                await dataSource.query(
                    `SELECT count(*) AS n FROM "login_challenge"`,
                )
            )[0].n,
        );

    it("accepts the right code exactly once", async () => {
        const { challenge } = await service.start(admin);
        const code = lastCode();

        const results = await Promise.all([
            service.confirm(challenge, code),
            service.confirm(challenge, code),
        ]);

        expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
        expect(await pendingCount()).toBe(0);
    });

    it("keeps one pending code per account", async () => {
        const first = await service.start(admin);
        const firstCode = lastCode();
        await service.start(admin);

        await expect(
            service.confirm(first.challenge, firstCode),
        ).resolves.toEqual({ status: "expired" });
        expect(await pendingCount()).toBe(1);
    });

    it("never grants more wrong guesses than the budget, even in parallel", async () => {
        const { challenge } = await service.start(admin);
        const code = lastCode();

        const results = await Promise.all(
            Array.from({ length: LOGIN_CODE_MAX_ATTEMPTS + 3 }, () =>
                service.confirm(challenge, wrongCode()),
            ),
        );

        expect(results.filter((r) => r.status === "wrong")).toHaveLength(
            LOGIN_CODE_MAX_ATTEMPTS - 1,
        );
        await expect(service.confirm(challenge, code)).resolves.toEqual({
            status: "expired",
        });
        expect(await pendingCount()).toBe(0);
    });

    it("purges expired codes and leaves fresh ones", async () => {
        await service.start(admin);
        await service.purge(new Date(Date.now() + 11 * 60_000));
        expect(await pendingCount()).toBe(0);

        await service.start(admin);
        await service.purge();
        expect(await pendingCount()).toBe(1);
    });

    it("disappears with the account", async () => {
        await service.start(admin);
        await dataSource.query(`DELETE FROM "user"`);
        expect(await pendingCount()).toBe(0);
    });
});
