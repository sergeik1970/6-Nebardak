import { QueryRunner } from "typeorm";
import { CreateProjects1786623000000 } from "../../migrations/1786623000000-CreateProjects";

describe("CreateProjects1786623000000", () => {
    it("owns projects per user with revisions and idempotent imports", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new CreateProjects1786623000000().up({
            query,
        } as unknown as QueryRunner);

        const createTable = query.mock.calls[0][0] as string;
        expect(createTable).toMatch(/CREATE TABLE "project"/);
        expect(createTable).toMatch(/"document" jsonb NOT NULL/);
        expect(createTable).toMatch(
            /CHECK \(jsonb_typeof\("document"\) = 'object'\)/,
        );
        expect(createTable).toMatch(
            /REFERENCES "user"\("id"\) ON DELETE CASCADE/,
        );
        expect(query.mock.calls[1][0]).toMatch(
            /"IDX_project_owner_updated" ON "project" \("owner_user_id", "updated_at" DESC\)/,
        );
        expect(query.mock.calls[2][0]).toMatch(
            /UNIQUE INDEX "UQ_project_owner_import"[\s\S]*WHERE "client_import_id" IS NOT NULL/,
        );
    });

    it("drops only the project table on rollback", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new CreateProjects1786623000000().down({
            query,
        } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledWith(`DROP TABLE "project"`);
    });
});
