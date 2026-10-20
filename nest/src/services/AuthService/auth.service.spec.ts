import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Repository } from "typeorm";
import { User } from "../../entities/User/user.entity";
import { AuthService } from "./auth.service";

const managedEnvironmentKeys = ["NODE_ENV", "AUTH_ENABLED"] as const;

function makeRepository() {
    const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
    };
    const repository = {
        createQueryBuilder: jest.fn(() => queryBuilder),
        create: jest.fn((value) => value),
        save: jest.fn(),
        findOne: jest.fn(),
    } as unknown as Repository<User>;

    return { repository, queryBuilder };
}

function makeUser(password: string): User {
    return {
        id: 17,
        name: "Мария",
        email: "maria@example.com",
        password,
        role: "designer",
    } as User;
}

describe("AuthService", () => {
    const originalValues = Object.fromEntries(
        managedEnvironmentKeys.map((key) => [key, process.env[key]]),
    );

    beforeEach(() => {
        process.env.NODE_ENV = "test";
        process.env.AUTH_ENABLED = "true";
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(() => {
        for (const key of managedEnvironmentKeys) {
            const originalValue = originalValues[key];
            if (originalValue === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalValue;
            }
        }
    });

    it.each(["a".repeat(73), "я".repeat(37)])(
        "rejects a %s-byte-overflow password before login queries",
        async (password) => {
            const { repository } = makeRepository();
            const service = new AuthService(repository);

            await expect(
                service.login({ email: "maria@example.com", password }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(repository.createQueryBuilder).not.toHaveBeenCalled();
        },
    );

    it("rejects an oversized password before registration queries", async () => {
        const { repository } = makeRepository();
        const service = new AuthService(repository);

        await expect(
            service.register({
                name: "Мария",
                email: "maria@example.com",
                password: "я".repeat(37),
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("never compares a legacy cost hash and performs cost-12 dummy work", async () => {
        const legacyHash = bcrypt.hashSync("correct-password", 10);
        const { repository, queryBuilder } = makeRepository();
        queryBuilder.getOne.mockResolvedValue(makeUser(legacyHash));
        const compare = jest.spyOn(bcrypt, "compare");
        const service = new AuthService(repository);

        const legacyError = (await service
            .login({
                email: "maria@example.com",
                password: "correct-password",
            })
            .catch((error: unknown) => error)) as UnauthorizedException;
        queryBuilder.getOne.mockResolvedValue(null);
        const missingUserError = (await service
            .login({
                email: "missing@example.com",
                password: "correct-password",
            })
            .catch((error: unknown) => error)) as UnauthorizedException;

        expect(legacyError).toBeInstanceOf(UnauthorizedException);
        expect(missingUserError).toBeInstanceOf(UnauthorizedException);
        expect(legacyError.getResponse()).toEqual(
            missingUserError.getResponse(),
        );
        expect(compare).toHaveBeenCalledTimes(2);
        for (const [, comparedHash] of compare.mock.calls) {
            expect(comparedHash).not.toBe(legacyHash);
            expect(bcrypt.getRounds(comparedHash)).toBe(12);
        }
    });

    it("authenticates a cost-12 hash by the normalized email", async () => {
        const password = "correct-password";
        const { repository, queryBuilder } = makeRepository();
        queryBuilder.getOne.mockResolvedValue(
            makeUser(bcrypt.hashSync(password, 12)),
        );
        const service = new AuthService(repository);

        const user = await service.login({
            email: " MARIA@EXAMPLE.COM ",
            password,
        });

        expect(user.id).toBe(17);
        expect(user.role).toBe("designer");
        expect(queryBuilder.where).toHaveBeenCalledWith(
            "LOWER(user.email) = :email",
            { email: "maria@example.com" },
        );
    });

    it("rejects a wrong password with the generic credentials error", async () => {
        const { repository, queryBuilder } = makeRepository();
        queryBuilder.getOne.mockResolvedValue(
            makeUser(bcrypt.hashSync("correct-password", 12)),
        );
        const service = new AuthService(repository);

        await expect(
            service.login({
                email: "maria@example.com",
                password: "wrong-password",
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("creates designers only and never stores the plain password", async () => {
        const { repository, queryBuilder } = makeRepository();
        queryBuilder.getOne.mockResolvedValue(null);
        (repository.save as jest.Mock).mockImplementation(async (value) => ({
            ...value,
            id: 18,
        }));
        const service = new AuthService(repository);

        const user = await service.register({
            name: "Мария",
            email: "Maria@Example.com",
            password: "safe-password",
        });

        expect(user).toMatchObject({
            id: 18,
            email: "maria@example.com",
            role: "designer",
        });
        expect(user.password).not.toBe("safe-password");
        expect(bcrypt.getRounds(user.password)).toBe(12);
    });
});
