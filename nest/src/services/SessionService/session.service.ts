import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { User, UserRole } from "../../entities/User/user.entity";
import { UserSession } from "../../entities/UserSession/user-session.entity";
import {
    createSecretToken,
    hashSecretToken,
    isSecretTokenFormat,
} from "../../security/secret-token";

const DAY_MS = 24 * 60 * 60_000;

export const SESSION_IDLE_TTL_MS = 30 * DAY_MS;
export const SESSION_ABSOLUTE_TTL_MS = 90 * DAY_MS;
/**
 * An administrator signs in again after a week away and at least once a
 * month; the emailed code is asked again when the trusted device expires.
 */
export const ADMIN_SESSION_IDLE_TTL_MS = 7 * DAY_MS;
export const ADMIN_SESSION_ABSOLUTE_TTL_MS = 30 * DAY_MS;
/** Activity is written at most this often, not on every request. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60_000;
export const MAX_SESSIONS_PER_USER = 20;

export interface SessionLifetime {
    idleMs: number;
    absoluteMs: number;
}

export function sessionLifetime(role: UserRole): SessionLifetime {
    return role === "admin"
        ? {
              idleMs: ADMIN_SESSION_IDLE_TTL_MS,
              absoluteMs: ADMIN_SESSION_ABSOLUTE_TTL_MS,
          }
        : { idleMs: SESSION_IDLE_TTL_MS, absoluteMs: SESSION_ABSOLUTE_TTL_MS };
}

export interface CreateSessionOptions {
    /** The sign-in also passed the emailed one-time code. */
    secondFactor?: boolean;
}

export interface AuthenticatedSession {
    user: User;
    session: UserSession;
}

@Injectable()
export class SessionService {
    constructor(
        @InjectRepository(UserSession)
        private readonly sessionRepository: Repository<UserSession>,
    ) {}

    async create(
        user: User,
        userAgent?: string,
        now = new Date(),
        options: CreateSessionOptions = {},
    ): Promise<{ token: string; session: UserSession }> {
        const token = createSecretToken();
        const lifetime = sessionLifetime(user.role);
        const absoluteExpiresAt = new Date(now.getTime() + lifetime.absoluteMs);
        const session = await this.sessionRepository.save(
            this.sessionRepository.create({
                user: { id: user.id } as User,
                tokenHash: hashSecretToken(token),
                lastSeenAt: now,
                expiresAt: new Date(now.getTime() + lifetime.idleMs),
                absoluteExpiresAt,
                secondFactorAt: options.secondFactor ? now : null,
                userAgent: this.normalizeUserAgent(userAgent),
            }),
        );

        await this.pruneUserSessions(user.id, now);
        return { token, session };
    }

    async authenticate(
        token: string | undefined,
        now = new Date(),
    ): Promise<AuthenticatedSession | null> {
        if (!isSecretTokenFormat(token)) return null;

        const session = await this.sessionRepository.findOne({
            where: { tokenHash: hashSecretToken(token) },
            relations: { user: true },
        });
        if (!session?.user) return null;

        if (session.expiresAt.getTime() <= now.getTime()) {
            await this.sessionRepository.delete({ id: session.id });
            return null;
        }

        if (
            now.getTime() - session.lastSeenAt.getTime() >=
            SESSION_TOUCH_INTERVAL_MS
        ) {
            session.lastSeenAt = now;
            session.expiresAt = new Date(
                Math.min(
                    now.getTime() + sessionLifetime(session.user.role).idleMs,
                    session.absoluteExpiresAt.getTime(),
                ),
            );
            await this.sessionRepository.update(
                { id: session.id },
                {
                    lastSeenAt: session.lastSeenAt,
                    expiresAt: session.expiresAt,
                },
            );
        }

        return { user: session.user, session };
    }

    async revoke(token: string | undefined): Promise<void> {
        if (!isSecretTokenFormat(token)) return;
        await this.sessionRepository.delete({
            tokenHash: hashSecretToken(token),
        });
    }

    async revokeAll(userId: number): Promise<void> {
        await this.sessionRepository.delete({ user: { id: userId } });
    }

    /** Ends every other sign-in, e.g. after the user changes the password. */
    async revokeOthers(userId: number, keepSessionId: string): Promise<void> {
        await this.sessionRepository
            .createQueryBuilder()
            .delete()
            .where("user_id = :userId", { userId })
            .andWhere("id <> :keepSessionId", { keepSessionId })
            .execute();
    }

    private async pruneUserSessions(userId: number, now: Date): Promise<void> {
        await this.sessionRepository.delete({
            user: { id: userId },
            expiresAt: LessThan(now),
        });

        // A raw OFFSET query: `find` with skip + order on a relation filter
        // makes TypeORM emit an invalid DISTINCT wrapper on PostgreSQL.
        const surplus: Array<{ id: string }> = await this.sessionRepository
            .createQueryBuilder("session")
            .select("session.id", "id")
            .where("session.user_id = :userId", { userId })
            .orderBy("session.last_seen_at", "DESC")
            .addOrderBy("session.created_at", "DESC")
            .offset(MAX_SESSIONS_PER_USER)
            .getRawMany();
        if (surplus.length > 0) {
            await this.sessionRepository.delete(
                surplus.map((session) => session.id),
            );
        }
    }

    private normalizeUserAgent(userAgent?: string): string | null {
        const value = userAgent?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
        return value ? value.slice(0, 200) : null;
    }
}
