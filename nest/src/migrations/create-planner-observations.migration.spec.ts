import { QueryRunner } from "typeorm";
import { CreatePlannerObservations1786622400000 } from "../../migrations/1786622400000-CreatePlannerObservations";

describe("CreatePlannerObservations1786622400000", () => {
    it("creates immutable JSON snapshots, one review and owner-scoped idempotency", async () => {
        const query = jest.fn().mockResolvedValue(undefined);
        const migration = new CreatePlannerObservations1786622400000();

        await migration.up({ query } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledTimes(3);
        expect(query.mock.calls[0][0]).toMatch(
            /CREATE TABLE "planner_observations"/,
        );
        expect(query.mock.calls[0][0]).toMatch(
            /"input_snapshot" jsonb NOT NULL/,
        );
        expect(query.mock.calls[0][0]).toMatch(
            /"review_comment" character varying\(1200\)/,
        );
        expect(query.mock.calls[1][0]).toMatch(
            /UNIQUE INDEX "UQ_planner_observations_owner_client"/,
        );
    });

    it("removes only the observations table on rollback", async () => {
        const query = jest.fn().mockResolvedValue(undefined);
        const migration = new CreatePlannerObservations1786622400000();

        await migration.down({ query } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledWith(`DROP TABLE "planner_observations"`);
    });
});
