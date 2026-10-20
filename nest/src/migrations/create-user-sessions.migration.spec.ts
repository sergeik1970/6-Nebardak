import { QueryRunner } from "typeorm";
import { CreateUserSessions1786622700000 } from "../../migrations/1786622700000-CreateUserSessions";

describe("CreateUserSessions1786622700000", () => {
    it("stores unique token hashes that disappear with their user", async () => {
        const query = jest.fn().mockResolvedValue(undefined);
        const migration = new CreateUserSessions1786622700000();

        await migration.up({ query } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledTimes(2);
        const createTable = query.mock.calls[0][0] as string;
        expect(createTable).toMatch(/CREATE TABLE "user_session"/);
        expect(createTable).toMatch(/"token_hash" character\(64\) NOT NULL/);
        expect(createTable).toMatch(/UNIQUE \("token_hash"\)/);
        expect(createTable).toMatch(/ON DELETE CASCADE/);
        expect(createTable).toMatch(
            /CHECK \("expires_at" <= "absolute_expires_at"\)/,
        );
        expect(query.mock.calls[1][0]).toMatch(/IDX_user_session_user/);
    });

    it("removes only the session table on rollback", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new CreateUserSessions1786622700000().down({
            query,
        } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledWith(`DROP TABLE "user_session"`);
    });
});
