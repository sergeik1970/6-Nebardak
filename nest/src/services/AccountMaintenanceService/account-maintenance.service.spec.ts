import { DataSource } from "typeorm";
import { EmailTokenService } from "../EmailTokenService/email-token.service";
import { OperationalLogger } from "../OperationalLogger/operational-logger.service";
import {
    AccountMaintenanceService,
    UNVERIFIED_ACCOUNT_RETENTION_MS,
} from "./account-maintenance.service";

function makeService() {
    const query = jest.fn().mockResolvedValue([[], 2]);
    const emailTokens = { purge: jest.fn() };
    const logger = { event: jest.fn() };
    const service = new AccountMaintenanceService(
        { query } as unknown as DataSource,
        emailTokens as unknown as EmailTokenService,
        logger as unknown as OperationalLogger,
    );
    return { service, query, emailTokens, logger };
}

const now = new Date("2026-10-20T12:00:00.000Z");

describe("AccountMaintenanceService", () => {
    it("deletes only stale unverified non-admin accounts without recent sessions", async () => {
        const { service, query } = makeService();

        await expect(service.deleteStaleUnverifiedAccounts(now)).resolves.toBe(
            2,
        );

        const [sql, parameters] = query.mock.calls[0];
        expect(sql).toMatch(/"emailVerifiedAt" IS NULL/);
        expect(sql).toMatch(/"role" <> 'admin'/);
        // Accounts created before sign-up consent existed are never removed.
        expect(sql).toMatch(/"consentAt" IS NOT NULL/);
        expect(sql).toMatch(/NOT EXISTS[\s\S]*"last_seen_at" >= \$1/);
        expect(parameters).toEqual([
            new Date(now.getTime() - UNVERIFIED_ACCOUNT_RETENTION_MS),
        ]);
    });

    it("purges sessions and links and reports counts only", async () => {
        const { service, emailTokens, logger } = makeService();

        await service.runOnce(now);

        expect(emailTokens.purge).toHaveBeenCalledWith(now);
        expect(logger.event).toHaveBeenCalledWith("account.maintenance", {
            expiredSessions: 2,
            deletedUnverifiedAccounts: 2,
        });
    });

    it("logs and survives a database failure", async () => {
        const { service, query, logger } = makeService();
        query.mockRejectedValue(new Error("connection lost"));

        await expect(service.runOnce(now)).resolves.toBeUndefined();
        expect(logger.event).toHaveBeenCalledWith(
            "account.maintenance_failed",
            { reason: "Error" },
            "error",
        );
    });
});
