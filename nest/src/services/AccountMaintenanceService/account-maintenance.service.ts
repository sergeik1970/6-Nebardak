import {
    Injectable,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { getRuntimeConfig } from "../../config/runtime.config";
import { AdminLoginCodeService } from "../AdminLoginCodeService/admin-login-code.service";
import { EmailTokenService } from "../EmailTokenService/email-token.service";
import { OperationalLogger } from "../OperationalLogger/operational-logger.service";

const DAY_MS = 24 * 60 * 60_000;
export const UNVERIFIED_ACCOUNT_RETENTION_MS = 30 * DAY_MS;
const RUN_INTERVAL_MS = 6 * 60 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Housekeeping for the single API instance: expired sessions, spent email
 * links and sign-in codes, and unverified accounts nobody has used for 30 days (their data
 * cascades away with them, as promised in the verification letter).
 * Only accounts that signed up under that promise qualify: older accounts
 * predate both the letter and server sessions, so for them "unverified and
 * no recent session" would mean everyone.
 */
@Injectable()
export class AccountMaintenanceService
    implements OnApplicationBootstrap, OnApplicationShutdown
{
    private timers: NodeJS.Timeout[] = [];

    constructor(
        private readonly dataSource: DataSource,
        private readonly emailTokens: EmailTokenService,
        private readonly loginCodes: AdminLoginCodeService,
        private readonly logger: OperationalLogger,
    ) {}

    onApplicationBootstrap(): void {
        const { nodeEnv, authEnabled } = getRuntimeConfig();
        if (!authEnabled || nodeEnv === "test") return;

        const run = () => void this.runOnce();
        this.timers = [
            setTimeout(run, FIRST_RUN_DELAY_MS),
            setInterval(run, RUN_INTERVAL_MS),
        ];
        this.timers.forEach((timer) => timer.unref());
    }

    onApplicationShutdown(): void {
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers = [];
    }

    async runOnce(now = new Date()): Promise<void> {
        try {
            const sessions = await this.dataSource.query(
                `DELETE FROM "user_session" WHERE "expires_at" <= $1`,
                [now],
            );
            await this.emailTokens.purge(now);
            await this.loginCodes.purge(now);
            const accounts = await this.deleteStaleUnverifiedAccounts(now);
            this.logger.event("account.maintenance", {
                expiredSessions: this.affected(sessions),
                deletedUnverifiedAccounts: accounts,
            });
        } catch (error) {
            this.logger.event(
                "account.maintenance_failed",
                { reason: error instanceof Error ? error.name : "unknown" },
                "error",
            );
        }
    }

    async deleteStaleUnverifiedAccounts(now: Date): Promise<number> {
        const cutoff = new Date(
            now.getTime() - UNVERIFIED_ACCOUNT_RETENTION_MS,
        );
        const result: unknown = await this.dataSource.query(
            `DELETE FROM "user" u
             WHERE u."emailVerifiedAt" IS NULL
               AND u."consentAt" IS NOT NULL
               AND u."role" <> 'admin'
               AND u."createdAt" < $1
               AND NOT EXISTS (
                   SELECT 1 FROM "user_session" s
                   WHERE s."user_id" = u."id" AND s."last_seen_at" >= $1
               )`,
            [cutoff],
        );
        return this.affected(result);
    }

    private affected(result: unknown): number {
        // TypeORM returns [rows, rowCount] for DELETE on PostgreSQL.
        return Array.isArray(result) && typeof result[1] === "number"
            ? result[1]
            : 0;
    }
}
