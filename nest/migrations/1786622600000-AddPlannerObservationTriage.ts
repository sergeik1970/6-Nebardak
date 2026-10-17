import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlannerObservationTriage1786622600000
    implements MigrationInterface
{
    name = "AddPlannerObservationTriage1786622600000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "planner_observations" ADD "triage_status" character varying(16) NOT NULL DEFAULT 'new'`,
        );
        await queryRunner.query(
            `ALTER TABLE "planner_observations" ADD "triaged_at" TIMESTAMP WITH TIME ZONE`,
        );
        await queryRunner.query(
            `ALTER TABLE "planner_observations" ADD CONSTRAINT "CHK_planner_observations_triage_status" CHECK ("triage_status" IN ('new', 'in-progress', 'resolved', 'dismissed'))`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_planner_observations_triage_created_at" ON "planner_observations" ("triage_status", "created_at" DESC)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX "IDX_planner_observations_triage_created_at"`,
        );
        await queryRunner.query(
            `ALTER TABLE "planner_observations" DROP CONSTRAINT "CHK_planner_observations_triage_status"`,
        );
        await queryRunner.query(
            `ALTER TABLE "planner_observations" DROP COLUMN "triaged_at"`,
        );
        await queryRunner.query(
            `ALTER TABLE "planner_observations" DROP COLUMN "triage_status"`,
        );
    }
}
