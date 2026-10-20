import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import {
    EmailToken,
    EmailTokenPurpose,
} from "../../entities/EmailToken/email-token.entity";
import { User } from "../../entities/User/user.entity";
import {
    createSecretToken,
    hashSecretToken,
    isSecretTokenFormat,
} from "../../security/secret-token";

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
    "verify-email": 48 * 60 * 60_000,
    "reset-password": 60 * 60_000,
};

@Injectable()
export class EmailTokenService {
    constructor(
        @InjectRepository(EmailToken)
        private readonly tokenRepository: Repository<EmailToken>,
    ) {}

    /** Issues a fresh link; any older unused link of the same kind stops working. */
    async issue(
        userId: number,
        purpose: EmailTokenPurpose,
        now = new Date(),
    ): Promise<string> {
        await this.revoke(userId, purpose);

        const token = createSecretToken();
        await this.tokenRepository.save(
            this.tokenRepository.create({
                user: { id: userId } as User,
                purpose,
                tokenHash: hashSecretToken(token),
                expiresAt: new Date(
                    now.getTime() + EMAIL_TOKEN_TTL_MS[purpose],
                ),
                usedAt: null,
            }),
        );
        return token;
    }

    /** Invalidates every unused link of this kind, e.g. after a password change. */
    async revoke(userId: number, purpose: EmailTokenPurpose): Promise<void> {
        await this.tokenRepository.delete({
            user: { id: userId },
            purpose,
            usedAt: IsNull(),
        });
    }

    /**
     * Marks the link used and returns its owner. A single conditional UPDATE
     * makes two simultaneous clicks race safely: only one gets the user id.
     */
    async consume(
        token: unknown,
        purpose: EmailTokenPurpose,
        now = new Date(),
    ): Promise<number | null> {
        if (!isSecretTokenFormat(token)) return null;

        const result = await this.tokenRepository
            .createQueryBuilder()
            .update(EmailToken)
            .set({ usedAt: now })
            .where("token_hash = :tokenHash", {
                tokenHash: hashSecretToken(token),
            })
            .andWhere("purpose = :purpose", { purpose })
            .andWhere("used_at IS NULL")
            .andWhere("expires_at > :now", { now })
            // A raw string: TypeORM silently drops array entries that are not
            // entity properties, which would spend the link yet return nothing.
            .returning('"user_id"')
            .execute();

        const rows = result.raw as Array<{ user_id: number }>;
        return rows.length === 1 ? Number(rows[0].user_id) : null;
    }

    /** Drops used or expired links; called by the maintenance job. */
    async purge(now = new Date()): Promise<void> {
        await this.tokenRepository
            .createQueryBuilder()
            .delete()
            .where("used_at IS NOT NULL OR expires_at <= :now", { now })
            .execute();
    }
}
