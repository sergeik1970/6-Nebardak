import { QueryRunner } from "typeorm";
import { AddTrustedDevices1786623200000 } from "../../migrations/1786623200000-AddTrustedDevices";

describe("AddTrustedDevices1786623200000", () => {
    it("stores only hashed device tokens that disappear with the account", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddTrustedDevices1786623200000().up({
            query,
        } as unknown as QueryRunner);

        const createTable = query.mock.calls[0][0] as string;
        expect(createTable).toMatch(/CREATE TABLE "trusted_device"/);
        expect(createTable).toMatch(/"token_hash" character\(64\) NOT NULL/);
        expect(createTable).toMatch(/UNIQUE \("token_hash"\)/);
        expect(createTable).toMatch(/ON DELETE CASCADE/);
        expect(query.mock.calls[1][0]).toBe(
            `CREATE INDEX "IDX_trusted_device_user" ON "trusted_device" ("user_id")`,
        );
    });

    it("drops the table on rollback", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddTrustedDevices1786623200000().down({
            query,
        } as unknown as QueryRunner);

        expect(query.mock.calls.map(([sql]) => sql)).toEqual([
            `DROP TABLE "trusted_device"`,
        ]);
    });
});
