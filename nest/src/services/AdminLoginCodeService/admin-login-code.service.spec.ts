import { Repository } from "typeorm";
import { LoginChallenge } from "../../entities/LoginChallenge/login-challenge.entity";
import { User } from "../../entities/User/user.entity";
import { hashSecretToken } from "../../security/secret-token";
import { MailService } from "../MailService/mail.service";
import { MailMessage } from "../MailService/mail-templates";
import { OperationalLogger } from "../OperationalLogger/operational-logger.service";
import {
    AdminLoginCodeService,
    LOGIN_CODE_MAX_ATTEMPTS,
    LOGIN_CODE_TTL_MS,
    hashLoginCode,
} from "./admin-login-code.service";

const now = new Date("2026-10-23T12:00:00.000Z");
const admin = {
    id: 3,
    name: "Мария",
    email: "admin@example.com",
    role: "admin",
} as User;
const CHALLENGE = "c".repeat(43);

function makeService(
    options: {
        pending?: Partial<LoginChallenge> | null;
        attemptsAfterIncrement?: number[];
        consumedRows?: number;
        mailError?: Error;
    } = {},
) {
    const builder = {
        update: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn(async () => ({
            raw: (options.attemptsAfterIncrement ?? []).map((attempts) => ({
                attempts,
            })),
            affected: options.consumedRows ?? 1,
        })),
    };
    const repository = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => ({ ...value, id: "challenge-1" })),
        delete: jest.fn(),
        findOne: jest.fn(async () =>
            options.pending === null
                ? null
                : {
                      id: "challenge-1",
                      user: admin,
                      tokenHash: hashSecretToken(CHALLENGE),
                      codeHash: hashLoginCode(CHALLENGE, "123456"),
                      attempts: 0,
                      expiresAt: new Date(now.getTime() + LOGIN_CODE_TTL_MS),
                      ...options.pending,
                  },
        ),
        createQueryBuilder: jest.fn(() => builder),
    };
    const mail = {
        send: jest.fn(async (message: MailMessage) => {
            if (options.mailError) throw options.mailError;
            return message;
        }),
    };
    const logger = { event: jest.fn() };
    const service = new AdminLoginCodeService(
        repository as unknown as Repository<LoginChallenge>,
        mail as unknown as MailService,
        logger as unknown as OperationalLogger,
    );
    return { service, repository, builder, mail, logger };
}

describe("AdminLoginCodeService", () => {
    it("replaces any earlier code and stores neither the token nor the code", async () => {
        const { service, repository, mail } = makeService();

        const { challenge, expiresAt } = await service.start(admin, now);

        expect(repository.delete).toHaveBeenCalledWith({ user: { id: 3 } });
        expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(expiresAt.getTime()).toBe(now.getTime() + LOGIN_CODE_TTL_MS);

        const saved = repository.save.mock.calls[0][0];
        const code = /\b(\d{6})\b/.exec(mail.send.mock.calls[0][0].text)?.[1];
        expect(code).toBeDefined();
        expect(saved.tokenHash).toBe(hashSecretToken(challenge));
        expect(saved.codeHash).toBe(hashLoginCode(challenge, code as string));
        expect(JSON.stringify(saved)).not.toContain(challenge);
        expect(JSON.stringify(saved)).not.toContain(`"${code}"`);
        expect(mail.send.mock.calls[0][0].to).toBe("admin@example.com");
    });

    it("leaves no usable code behind when the letter fails", async () => {
        const { service, repository, logger } = makeService({
            mailError: new Error("smtp down"),
        });

        await expect(service.start(admin, now)).rejects.toThrow("smtp down");
        expect(repository.delete).toHaveBeenLastCalledWith({
            id: "challenge-1",
        });
        expect(logger.event).toHaveBeenCalledWith(
            "account.admin_code_failed",
            { userId: 3, reason: "Error" },
            "error",
        );
    });

    it("signs in once with the right code", async () => {
        const { service, builder } = makeService();

        await expect(
            service.confirm(CHALLENGE, "123456", now),
        ).resolves.toEqual({ status: "ok", userId: 3 });
        expect(builder.delete).toHaveBeenCalled();
    });

    it("loses a race for the same right code", async () => {
        const { service } = makeService({ consumedRows: 0 });

        await expect(
            service.confirm(CHALLENGE, "123456", now),
        ).resolves.toEqual({ status: "expired" });
    });

    it("counts a wrong code and reports the attempts left", async () => {
        const { service, builder } = makeService({
            attemptsAfterIncrement: [1],
        });

        await expect(
            service.confirm(CHALLENGE, "000000", now),
        ).resolves.toEqual({
            status: "wrong",
            attemptsLeft: LOGIN_CODE_MAX_ATTEMPTS - 1,
        });
        expect(builder.andWhere).toHaveBeenCalledWith("attempts < :max", {
            max: LOGIN_CODE_MAX_ATTEMPTS,
        });
    });

    it("burns the code on the last wrong attempt", async () => {
        const { service, repository } = makeService({
            attemptsAfterIncrement: [LOGIN_CODE_MAX_ATTEMPTS],
        });

        await expect(
            service.confirm(CHALLENGE, "000000", now),
        ).resolves.toEqual({ status: "expired" });
        expect(repository.delete).toHaveBeenCalledWith({ id: "challenge-1" });
    });

    it.each([
        ["expired", { expiresAt: now }],
        ["exhausted", { attempts: LOGIN_CODE_MAX_ATTEMPTS }],
    ])("rejects an %s code even when it is right", async (_label, pending) => {
        const { service, repository } = makeService({ pending });

        await expect(
            service.confirm(CHALLENGE, "123456", now),
        ).resolves.toEqual({ status: "expired" });
        expect(repository.delete).toHaveBeenCalledWith({ id: "challenge-1" });
    });

    it.each([
        [undefined, "123456"],
        ["short", "123456"],
        [CHALLENGE, "12345"],
        [CHALLENGE, "abcdef"],
    ])(
        "never queries for a challenge or code we could not have issued",
        async (challenge, code) => {
            const { service, repository } = makeService();

            await expect(
                service.confirm(challenge, code, now),
            ).resolves.toEqual({ status: "expired" });
            expect(repository.findOne).not.toHaveBeenCalled();
        },
    );

    it("keys the code hash by the challenge token", () => {
        expect(hashLoginCode("a".repeat(43), "123456")).not.toBe(
            hashLoginCode("b".repeat(43), "123456"),
        );
    });
});
