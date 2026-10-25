import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Repository } from "typeorm";
import { LoginChallenge } from "../../entities/LoginChallenge/login-challenge.entity";
import { User } from "../../entities/User/user.entity";
import {
    createSecretToken,
    hashSecretToken,
    isSecretTokenFormat,
} from "../../security/secret-token";
import { MailService } from "../MailService/mail.service";
import { adminLoginCodeEmail } from "../MailService/mail-templates";
import { OperationalLogger } from "../OperationalLogger/operational-logger.service";

export const LOGIN_CODE_TTL_MS = 10 * 60_000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_PATTERN = /^\d{6}$/;

export interface LoginCodeChallenge {
    challenge: string;
    expiresAt: Date;
}

export type LoginCodeResult =
    | { status: "ok"; userId: number }
    | { status: "wrong"; attemptsLeft: number }
    | { status: "expired" };

/**
 * Six digits are guessable from a leaked table, so the code is hashed with
 * the challenge token as the key: the token itself is stored only as a hash.
 */
export function hashLoginCode(challenge: string, code: string): string {
    return createHmac("sha256", challenge).update(code).digest("hex");
}

/**
 * The emailed second step of an administrator sign-in. One pending code per
 * account; each has a short life and a small attempt budget.
 */
@Injectable()
export class AdminLoginCodeService {
    constructor(
        @InjectRepository(LoginChallenge)
        private readonly challengeRepository: Repository<LoginChallenge>,
        private readonly mailService: MailService,
        private readonly logger: OperationalLogger,
    ) {}

    /** Sends a fresh code. Throws when the letter could not be sent. */
    async start(user: User, now = new Date()): Promise<LoginCodeChallenge> {
        // A new sign-in attempt makes every earlier code useless.
        await this.challengeRepository.delete({ user: { id: user.id } });

        const challenge = createSecretToken();
        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        const expiresAt = new Date(now.getTime() + LOGIN_CODE_TTL_MS);
        const saved = await this.challengeRepository.save(
            this.challengeRepository.create({
                user: { id: user.id } as User,
                tokenHash: hashSecretToken(challenge),
                codeHash: hashLoginCode(challenge, code),
                attempts: 0,
                expiresAt,
            }),
        );

        try {
            await this.mailService.send(
                adminLoginCodeEmail({
                    to: user.email,
                    name: user.name,
                    code,
                    ttlMinutes: LOGIN_CODE_TTL_MS / 60_000,
                }),
            );
        } catch (error) {
            await this.challengeRepository.delete({ id: saved.id });
            this.logger.event(
                "account.admin_code_failed",
                {
                    userId: user.id,
                    reason: error instanceof Error ? error.name : "unknown",
                },
                "error",
            );
            throw error;
        }

        this.logger.event("account.admin_code_sent", { userId: user.id });
        return { challenge, expiresAt };
    }

    async confirm(
        challenge: unknown,
        code: string,
        now = new Date(),
    ): Promise<LoginCodeResult> {
        if (!isSecretTokenFormat(challenge) || !LOGIN_CODE_PATTERN.test(code)) {
            return { status: "expired" };
        }

        const pending = await this.challengeRepository.findOne({
            where: { tokenHash: hashSecretToken(challenge) },
            relations: { user: true },
        });
        if (!pending) return { status: "expired" };

        if (
            pending.expiresAt.getTime() <= now.getTime() ||
            pending.attempts >= LOGIN_CODE_MAX_ATTEMPTS
        ) {
            await this.challengeRepository.delete({ id: pending.id });
            return { status: "expired" };
        }

        if (!this.matches(pending.codeHash, hashLoginCode(challenge, code))) {
            return this.recordWrongAttempt(pending);
        }

        // Single use: of two simultaneous right answers only one deletes the row.
        const consumed = await this.challengeRepository
            .createQueryBuilder()
            .delete()
            .from(LoginChallenge)
            .where("id = :id", { id: pending.id })
            .andWhere("attempts < :max", { max: LOGIN_CODE_MAX_ATTEMPTS })
            .execute();
        if (consumed.affected !== 1) return { status: "expired" };

        this.logger.event("account.admin_code_confirmed", {
            userId: pending.user.id,
        });
        return { status: "ok", userId: pending.user.id };
    }

    /** Drops expired or exhausted codes; called by the maintenance job. */
    async purge(now = new Date()): Promise<void> {
        await this.challengeRepository
            .createQueryBuilder()
            .delete()
            .from(LoginChallenge)
            .where("expires_at <= :now OR attempts >= :max", {
                now,
                max: LOGIN_CODE_MAX_ATTEMPTS,
            })
            .execute();
    }

    private async recordWrongAttempt(
        pending: LoginChallenge,
    ): Promise<LoginCodeResult> {
        // Conditional increment, so parallel guesses cannot exceed the budget.
        const result = await this.challengeRepository
            .createQueryBuilder()
            .update(LoginChallenge)
            .set({ attempts: () => "attempts + 1" })
            .where("id = :id", { id: pending.id })
            .andWhere("attempts < :max", { max: LOGIN_CODE_MAX_ATTEMPTS })
            .returning('"attempts"')
            .execute();

        const rows = result.raw as Array<{ attempts: number }>;
        const attemptsLeft =
            rows.length === 1
                ? LOGIN_CODE_MAX_ATTEMPTS - Number(rows[0].attempts)
                : 0;
        this.logger.event(
            "account.admin_code_rejected",
            { userId: pending.user.id, attemptsLeft },
            "warn",
        );

        if (attemptsLeft <= 0) {
            await this.challengeRepository.delete({ id: pending.id });
            return { status: "expired" };
        }
        return { status: "wrong", attemptsLeft };
    }

    private matches(expected: string, actual: string): boolean {
        const left = Buffer.from(expected, "hex");
        const right = Buffer.from(actual, "hex");
        return left.length === right.length && timingSafeEqual(left, right);
    }
}
