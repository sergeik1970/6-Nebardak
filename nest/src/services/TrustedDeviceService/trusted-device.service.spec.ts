import { FindOperator, Repository } from "typeorm";
import { TrustedDevice } from "../../entities/TrustedDevice/trusted-device.entity";
import { hashSecretToken } from "../../security/secret-token";
import {
    MAX_TRUSTED_DEVICES_PER_USER,
    TRUSTED_DEVICE_TTL_MS,
    TrustedDeviceService,
} from "./trusted-device.service";

const now = new Date("2026-10-25T12:00:00.000Z");
const TOKEN = "d".repeat(43);

function makeService(
    options: { found?: boolean; surplus?: Array<{ id: string }> } = {},
) {
    const builder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(async () => options.surplus ?? []),
    };
    const repository = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
        delete: jest.fn(),
        findOne: jest.fn<Promise<{ id: string } | null>, [unknown]>(async () =>
            options.found === false ? null : { id: "device-1" },
        ),
        createQueryBuilder: jest.fn(() => builder),
    };
    const service = new TrustedDeviceService(
        repository as unknown as Repository<TrustedDevice>,
    );
    return { service, repository, builder };
}

describe("TrustedDeviceService", () => {
    it("stores only the token hash and expires a month after the code", async () => {
        const { service, repository } = makeService();

        const { token, expiresAt } = await service.issue(3, now);

        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(expiresAt).toEqual(
            new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS),
        );
        const saved = repository.save.mock.calls[0][0];
        expect(saved).toEqual({
            user: { id: 3 },
            tokenHash: hashSecretToken(token),
            expiresAt,
        });
        expect(JSON.stringify(saved)).not.toContain(token);
    });

    it("keeps at most the newest devices per account", async () => {
        const { service, repository, builder } = makeService({
            surplus: [{ id: "old-1" }, { id: "old-2" }],
        });

        await service.issue(3, now);

        expect(builder.offset).toHaveBeenCalledWith(
            MAX_TRUSTED_DEVICES_PER_USER,
        );
        expect(repository.delete).toHaveBeenLastCalledWith(["old-1", "old-2"]);
    });

    it("trusts only an unexpired device of the same account", async () => {
        const { service, repository } = makeService();

        await expect(service.isTrusted(3, TOKEN, now)).resolves.toBe(true);

        const { where } = repository.findOne.mock.calls[0][0] as {
            where: {
                tokenHash: string;
                user: { id: number };
                expiresAt: FindOperator<Date>;
            };
        };
        expect(where.tokenHash).toBe(hashSecretToken(TOKEN));
        expect(where.user).toEqual({ id: 3 });
        expect(where.expiresAt.type).toBe("moreThan");
        expect(where.expiresAt.value).toBe(now);
    });

    it("rejects unknown and malformed tokens", async () => {
        const { service, repository } = makeService({ found: false });

        await expect(service.isTrusted(3, TOKEN, now)).resolves.toBe(false);
        await expect(service.isTrusted(3, undefined, now)).resolves.toBe(false);
        await expect(service.isTrusted(3, "short", now)).resolves.toBe(false);
        expect(repository.findOne).toHaveBeenCalledTimes(1);
    });

    it("forgets every device of an account", async () => {
        const { service, repository } = makeService();

        await service.revokeAll(3);

        expect(repository.delete).toHaveBeenCalledWith({ user: { id: 3 } });
    });
});
