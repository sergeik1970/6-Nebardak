import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { Repository } from "typeorm";
import { User } from "../../entities/User/user.entity";
import { AuthService } from "./auth.service";

const managedEnvironmentKeys = [
    "NODE_ENV",
    "AUTH_ENABLED",
    "JWT_SECRET",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
] as const;

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
        process.env.JWT_SECRET = "test-secret-that-is-definitely-long-enough";
        process.env.JWT_ISSUER = "stylefinder-api-test";
        process.env.JWT_AUDIENCE = "stylefinder-web-test";
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

    it("authenticates a cost-12 hash and signs issuer/audience-bound HS256 tokens", async () => {
        const password = "correct-password";
        const { repository, queryBuilder } = makeRepository();
        queryBuilder.getOne.mockResolvedValue(
            makeUser(bcrypt.hashSync(password, 12)),
        );
        const service = new AuthService(repository);

        const result = await service.login({
            email: " MARIA@EXAMPLE.COM ",
            password,
        });
        const payload = jwt.verify(result.token, process.env.JWT_SECRET!, {
            algorithms: ["HS256"],
            issuer: "stylefinder-api-test",
            audience: "stylefinder-web-test",
        }) as jwt.JwtPayload;

        expect(payload.sub).toBe(17);
        expect(result.user.role).toBe("designer");
        expect(queryBuilder.where).toHaveBeenCalledWith(
            "LOWER(user.email) = :email",
            { email: "maria@example.com" },
        );
    });

    it.each([
        ["wrong-issuer", "stylefinder-web-test"],
        ["stylefinder-api-test", "wrong-audience"],
    ])(
        "rejects tokens with issuer %s and audience %s before DB lookup",
        async (issuer, audience) => {
            const { repository } = makeRepository();
            const service = new AuthService(repository);
            const token = jwt.sign({ sub: 17 }, process.env.JWT_SECRET!, {
                algorithm: "HS256",
                issuer,
                audience,
            });

            await expect(service.validateToken(token)).resolves.toBeNull();
            expect(repository.findOne).not.toHaveBeenCalled();
        },
    );

    it("constructs without a JWT secret while the server feature is disabled", () => {
        process.env.AUTH_ENABLED = "false";
        delete process.env.JWT_SECRET;
        const { repository } = makeRepository();

        expect(() => new AuthService(repository)).not.toThrow();
    });
});
