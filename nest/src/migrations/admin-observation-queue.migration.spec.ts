import { QueryRunner } from "typeorm";
import { AddUserRoles1786622500000 } from "../../migrations/1786622500000-AddUserRoles";
import { AddPlannerObservationTriage1786622600000 } from "../../migrations/1786622600000-AddPlannerObservationTriage";

function makeQueryRunner() {
    const query = jest.fn().mockResolvedValue(undefined);
    return { queryRunner: { query } as unknown as QueryRunner, query };
}

describe("admin observation queue migrations", () => {
    it("adds the least-privilege user role with a database constraint", async () => {
        const { queryRunner, query } = makeQueryRunner();

        await new AddUserRoles1786622500000().up(queryRunner);

        expect(query).toHaveBeenCalledTimes(3);
        expect(query.mock.calls[0][0]).toMatch(
            /ADD "role".*DEFAULT 'designer'/,
        );
        expect(query.mock.calls[1][0]).toMatch(
            /CHECK \("role" IN \('designer', 'admin'\)\)/,
        );
    });

    it("adds triage separately from immutable planner observations", async () => {
        const { queryRunner, query } = makeQueryRunner();

        await new AddPlannerObservationTriage1786622600000().up(queryRunner);

        expect(query).toHaveBeenCalledTimes(4);
        expect(query.mock.calls[0][0]).toMatch(
            /ADD "triage_status".*DEFAULT 'new'/,
        );
        expect(query.mock.calls[2][0]).toMatch(
            /CHECK \("triage_status" IN \('new', 'in-progress', 'resolved', 'dismissed'\)\)/,
        );
    });
});
