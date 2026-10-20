import { QueryRunner } from "typeorm";
import { AddEmailVerification1786622800000 } from "../../migrations/1786622800000-AddEmailVerification";

describe("AddEmailVerification1786622800000", () => {
    it("adds the verification timestamp and hashed single-purpose links", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddEmailVerification1786622800000().up({
            query,
        } as unknown as QueryRunner);

        expect(query.mock.calls[0][0]).toMatch(
            /ALTER TABLE "user" ADD "emailVerifiedAt" TIMESTAMP WITH TIME ZONE$/,
        );
        const createTable = query.mock.calls[1][0] as string;
        expect(createTable).toMatch(/CREATE TABLE "email_token"/);
        expect(createTable).toMatch(/UNIQUE \("token_hash"\)/);
        expect(createTable).toMatch(
            /CHECK \("purpose" IN \('verify-email', 'reset-password'\)\)/,
        );
        expect(createTable).toMatch(/ON DELETE CASCADE/);
    });

    it("rolls back the table before the column", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddEmailVerification1786622800000().down({
            query,
        } as unknown as QueryRunner);

        expect(query.mock.calls.map(([sql]) => sql)).toEqual([
            `DROP TABLE "email_token"`,
            `ALTER TABLE "user" DROP COLUMN "emailVerifiedAt"`,
        ]);
    });
});
