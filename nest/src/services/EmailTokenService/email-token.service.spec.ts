import { Repository } from "typeorm";
import { EmailToken } from "../../entities/EmailToken/email-token.entity";
import { hashSecretToken } from "../../security/secret-token";
import { EMAIL_TOKEN_TTL_MS, EmailTokenService } from "./email-token.service";

function makeRepository(raw: unknown[] = []) {
    const builder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ raw }),
    };
    const repository = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
        delete: jest.fn(),
        createQueryBuilder: jest.fn(() => builder),
    };
    return {
        repository: repository as unknown as Repository<EmailToken>,
        mocks: repository,
        builder,
    };
}

const now = new Date("2026-10-20T12:00:00.000Z");

describe("EmailTokenService", () => {
    it("revokes older unused links of the same kind and stores only a hash", async () => {
        const { repository, mocks } = makeRepository();
        const service = new EmailTokenService(repository);

        const token = await service.issue(5, "reset-password", now);

        expect(mocks.delete).toHaveBeenCalledWith(
            expect.objectContaining({
                user: { id: 5 },
                purpose: "reset-password",
            }),
        );
        const saved = mocks.save.mock.calls[0][0];
        expect(saved.tokenHash).toBe(hashSecretToken(token));
        expect(saved.expiresAt.getTime()).toBe(
            now.getTime() + EMAIL_TOKEN_TTL_MS["reset-password"],
        );
    });

    it("gives the reset link a much shorter life than verification", () => {
        expect(EMAIL_TOKEN_TTL_MS["reset-password"]).toBe(60 * 60_000);
        expect(EMAIL_TOKEN_TTL_MS["verify-email"]).toBe(48 * 60 * 60_000);
    });

    it.each([undefined, 42, "short", "x".repeat(43) + "="])(
        "never queries for a token we could not have issued: %s",
        async (token) => {
            const { repository, mocks } = makeRepository();
            const service = new EmailTokenService(repository);

            await expect(
                service.consume(token, "verify-email", now),
            ).resolves.toBeNull();
            expect(mocks.createQueryBuilder).not.toHaveBeenCalled();
        },
    );

    it("consumes atomically: only an unused, unexpired link of the same purpose", async () => {
        const { repository, builder } = makeRepository([{ user_id: 9 }]);
        const service = new EmailTokenService(repository);
        const token = "t".repeat(43);

        await expect(service.consume(token, "verify-email", now)).resolves.toBe(
            9,
        );
        expect(builder.set).toHaveBeenCalledWith({ usedAt: now });
        expect(builder.where).toHaveBeenCalledWith("token_hash = :tokenHash", {
            tokenHash: hashSecretToken(token),
        });
        expect(builder.andWhere).toHaveBeenCalledWith("purpose = :purpose", {
            purpose: "verify-email",
        });
        expect(builder.andWhere).toHaveBeenCalledWith("used_at IS NULL");
        expect(builder.returning).toHaveBeenCalledWith('"user_id"');
        expect(builder.andWhere).toHaveBeenCalledWith("expires_at > :now", {
            now,
        });
    });

    it("returns null when the conditional update matched nothing", async () => {
        const { repository } = makeRepository([]);
        const service = new EmailTokenService(repository);

        await expect(
            service.consume("t".repeat(43), "reset-password", now),
        ).resolves.toBeNull();
    });
});
