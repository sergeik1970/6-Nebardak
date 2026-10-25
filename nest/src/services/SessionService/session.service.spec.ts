import { Repository } from "typeorm";
import { User } from "../../entities/User/user.entity";
import { UserSession } from "../../entities/UserSession/user-session.entity";
import {
    ADMIN_SESSION_ABSOLUTE_TTL_MS,
    ADMIN_SESSION_IDLE_TTL_MS,
    MAX_SESSIONS_PER_USER,
    SESSION_ABSOLUTE_TTL_MS,
    SESSION_IDLE_TTL_MS,
    SESSION_TOUCH_INTERVAL_MS,
    SessionService,
} from "./session.service";
import { hashSecretToken } from "../../security/secret-token";

function makeRepository() {
    const repository = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => ({ ...value, id: "session-1" })),
        findOne: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        surplus: [] as Array<{ id: string }>,
        offset: jest.fn(),
        createQueryBuilder: jest.fn(),
    };
    const builder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        offset: jest.fn((value: number) => {
            repository.offset(value);
            return builder;
        }),
        getRawMany: jest.fn(async () => repository.surplus),
    };
    repository.createQueryBuilder.mockReturnValue(builder);
    return repository as unknown as Repository<UserSession> & typeof repository;
}

const user = { id: 7, name: "Мария" } as User;
const now = new Date("2026-10-20T12:00:00.000Z");

function storedSession(overrides: Partial<UserSession> = {}): UserSession {
    return {
        id: "session-1",
        user,
        tokenHash: "x".repeat(64),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
        absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
        userAgent: null,
        secondFactorAt: null,
        ...overrides,
    };
}

describe("SessionService", () => {
    it("stores only the hash of a high-entropy token", async () => {
        const repository = makeRepository();
        const service = new SessionService(repository);

        const { token } = await service.create(user, "Browser\u0000/1", now);

        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const saved = repository.save.mock.calls[0][0];
        expect(saved.tokenHash).toBe(hashSecretToken(token));
        expect(saved.tokenHash).not.toContain(token);
        expect(saved.userAgent).toBe("Browser/1");
        expect(saved.expiresAt.getTime()).toBe(
            now.getTime() + SESSION_IDLE_TTL_MS,
        );
        expect(saved.absoluteExpiresAt.getTime()).toBe(
            now.getTime() + SESSION_ABSOLUTE_TTL_MS,
        );
    });

    it("marks only a code-confirmed sign-in as second-factor", async () => {
        const repository = makeRepository();
        const service = new SessionService(repository);

        await service.create(user, undefined, now);
        await service.create(user, undefined, now, { secondFactor: true });

        expect(repository.save.mock.calls[0][0].secondFactorAt).toBeNull();
        expect(repository.save.mock.calls[1][0].secondFactorAt).toEqual(now);
    });

    it("gives administrators a short idle and absolute lifetime", async () => {
        const repository = makeRepository();
        const admin = { ...user, role: "admin" } as User;
        const service = new SessionService(repository);

        await service.create(admin, undefined, now, { secondFactor: true });

        const saved = repository.save.mock.calls[0][0];
        expect(saved.expiresAt.getTime()).toBe(
            now.getTime() + ADMIN_SESSION_IDLE_TTL_MS,
        );
        expect(saved.absoluteExpiresAt.getTime()).toBe(
            now.getTime() + ADMIN_SESSION_ABSOLUTE_TTL_MS,
        );
    });

    it("slides an administrator session by the admin idle window", async () => {
        const repository = makeRepository();
        const admin = { ...user, role: "admin" } as User;
        repository.findOne.mockResolvedValue(
            storedSession({
                user: admin,
                expiresAt: new Date(now.getTime() + ADMIN_SESSION_IDLE_TTL_MS),
                absoluteExpiresAt: new Date(
                    now.getTime() + ADMIN_SESSION_ABSOLUTE_TTL_MS,
                ),
            }),
        );
        const service = new SessionService(repository);
        const later = new Date(now.getTime() + 2 * SESSION_TOUCH_INTERVAL_MS);

        await service.authenticate("a".repeat(43), later);

        expect(repository.update.mock.calls[0][1].expiresAt.getTime()).toBe(
            later.getTime() + ADMIN_SESSION_IDLE_TTL_MS,
        );
    });

    it("keeps at most the most recent sessions per user", async () => {
        const repository = makeRepository();
        repository.surplus = [{ id: "old-1" }, { id: "old-2" }];
        const service = new SessionService(repository);

        await service.create(user, undefined, now);

        expect(repository.offset).toHaveBeenCalledWith(MAX_SESSIONS_PER_USER);
        expect(repository.delete).toHaveBeenLastCalledWith(["old-1", "old-2"]);
    });

    it.each([undefined, "", "short", "a".repeat(44), "a".repeat(42) + "!"])(
        "never queries the database for a malformed token %s",
        async (token) => {
            const repository = makeRepository();
            const service = new SessionService(repository);

            await expect(service.authenticate(token, now)).resolves.toBeNull();
            expect(repository.findOne).not.toHaveBeenCalled();
        },
    );

    it("deletes and rejects an idle-expired session", async () => {
        const repository = makeRepository();
        repository.findOne.mockResolvedValue(
            storedSession({ expiresAt: new Date(now.getTime() - 1) }),
        );
        const service = new SessionService(repository);

        await expect(
            service.authenticate("a".repeat(43), now),
        ).resolves.toBeNull();
        expect(repository.delete).toHaveBeenCalledWith({ id: "session-1" });
    });

    it("does not write activity more often than the touch interval", async () => {
        const repository = makeRepository();
        repository.findOne.mockResolvedValue(storedSession());
        const service = new SessionService(repository);

        const result = await service.authenticate(
            "a".repeat(43),
            new Date(now.getTime() + SESSION_TOUCH_INTERVAL_MS - 1),
        );

        expect(result?.user).toBe(user);
        expect(repository.update).not.toHaveBeenCalled();
    });

    it("slides the idle expiry but never past the absolute limit", async () => {
        const repository = makeRepository();
        const absoluteExpiresAt = new Date(now.getTime() + 10 * 60 * 60_000);
        repository.findOne.mockResolvedValue(
            storedSession({
                expiresAt: absoluteExpiresAt,
                absoluteExpiresAt,
            }),
        );
        const service = new SessionService(repository);
        const later = new Date(now.getTime() + 2 * SESSION_TOUCH_INTERVAL_MS);

        await service.authenticate("a".repeat(43), later);

        expect(repository.update).toHaveBeenCalledWith(
            { id: "session-1" },
            { lastSeenAt: later, expiresAt: absoluteExpiresAt },
        );
    });

    it("revokes by token hash and ignores malformed tokens", async () => {
        const repository = makeRepository();
        const service = new SessionService(repository);
        const token = "b".repeat(43);

        await service.revoke("not-a-token");
        await service.revoke(token);

        expect(repository.delete).toHaveBeenCalledTimes(1);
        expect(repository.delete).toHaveBeenCalledWith({
            tokenHash: hashSecretToken(token),
        });
    });
});
