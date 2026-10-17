import { QueryRunner } from "typeorm";
import { NormalizeUserEmail1784303340000 } from "../../migrations/1784303340000-NormalizeUserEmail";

function makeQueryRunner(results: unknown[] = []) {
    const query = jest.fn();
    for (const result of results) query.mockResolvedValueOnce(result);
    query.mockResolvedValue(undefined);
    return {
        queryRunner: { query } as unknown as QueryRunner,
        query,
    };
}

describe("NormalizeUserEmail1784303340000", () => {
    const migration = new NormalizeUserEmail1784303340000();

    it("checks existing data, normalizes it, then adds a LOWER(email) unique index", async () => {
        const { queryRunner, query } = makeQueryRunner([undefined, [], []]);

        await migration.up(queryRunner);

        expect(query).toHaveBeenCalledTimes(5);
        expect(query.mock.calls[0][0]).toMatch(
            /LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE/,
        );
        expect(query.mock.calls[1][0]).toMatch(/BTRIM\("email"\) = ''/);
        expect(query.mock.calls[2][0]).toMatch(
            /GROUP BY LOWER\(BTRIM\("email"\)\)/,
        );
        expect(query.mock.calls[2][0]).toMatch(/HAVING COUNT\(\*\) > 1/);
        expect(query.mock.calls[3][0]).toMatch(
            /SET "email" = LOWER\(BTRIM\("email"\)\)/,
        );
        expect(query.mock.calls[4][0]).toMatch(
            /CREATE UNIQUE INDEX "IDX_user_email_lower_unique".*LOWER\("email"\)/s,
        );
    });

    it("fails clearly before mutation when normalized duplicates exist", async () => {
        const { queryRunner, query } = makeQueryRunner([
            undefined,
            [],
            [{ duplicateCount: 2, userIds: [7, 12] }],
        ]);

        await expect(migration.up(queryRunner)).rejects.toThrow(
            /duplicate normalized email.*7, 12/i,
        );
        expect(query).toHaveBeenCalledTimes(3);
        expect(query.mock.calls.join(" ")).not.toMatch(/UPDATE "user"/);
    });

    it("fails clearly before mutation when blank emails exist", async () => {
        const { queryRunner, query } = makeQueryRunner([
            undefined,
            [{ id: 4 }],
        ]);

        await expect(migration.up(queryRunner)).rejects.toThrow(
            /blank values.*4/i,
        );
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("drops only the expression index on rollback", async () => {
        const { queryRunner, query } = makeQueryRunner();

        await migration.down(queryRunner);

        expect(query).toHaveBeenCalledWith(
            `DROP INDEX IF EXISTS "IDX_user_email_lower_unique"`,
        );
    });
});
