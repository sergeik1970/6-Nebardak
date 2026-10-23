import { QueryRunner } from "typeorm";
import { AddAdminLoginCode1786623100000 } from "../../migrations/1786623100000-AddAdminLoginCode";

describe("AddAdminLoginCode1786623100000", () => {
    it("adds hashed sign-in challenges and the session second-factor mark", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddAdminLoginCode1786623100000().up({
            query,
        } as unknown as QueryRunner);

        const createTable = query.mock.calls[0][0] as string;
        expect(createTable).toMatch(/CREATE TABLE "login_challenge"/);
        expect(createTable).toMatch(/UNIQUE \("token_hash"\)/);
        expect(createTable).toMatch(/"code_hash" character\(64\) NOT NULL/);
        expect(createTable).toMatch(/CHECK \("attempts" >= 0\)/);
        expect(createTable).toMatch(/ON DELETE CASCADE/);
        expect(query.mock.calls[2][0]).toBe(
            `ALTER TABLE "user_session" ADD "second_factor_at" TIMESTAMP WITH TIME ZONE`,
        );
    });

    it("rolls back the column before the table", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddAdminLoginCode1786623100000().down({
            query,
        } as unknown as QueryRunner);

        expect(query.mock.calls.map(([sql]) => sql)).toEqual([
            `ALTER TABLE "user_session" DROP COLUMN "second_factor_at"`,
            `DROP TABLE "login_challenge"`,
        ]);
    });
});
