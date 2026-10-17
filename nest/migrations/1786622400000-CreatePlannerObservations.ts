import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlannerObservations1786622400000
    implements MigrationInterface
{
    name = "CreatePlannerObservations1786622400000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "planner_observations" ("id" SERIAL NOT NULL, "created_by_user_id" integer NOT NULL, "client_observation_id" character varying(64) NOT NULL, "input_snapshot" jsonb NOT NULL, "layout_snapshot" jsonb NOT NULL, "input_fingerprint" character varying(512) NOT NULL, "layout_fingerprint" character varying(512) NOT NULL, "algorithm_version" character varying(80) NOT NULL, "catalog_version" character varying(512) NOT NULL, "solver_status" character varying(24) NOT NULL, "review_verdict" character varying(16), "review_comment" character varying(1200), "reviewed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_planner_observations_id" PRIMARY KEY ("id"), CONSTRAINT "FK_planner_observations_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "UQ_planner_observations_owner_client" ON "planner_observations" ("created_by_user_id", "client_observation_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_planner_observations_reviewed_at" ON "planner_observations" ("reviewed_at")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "planner_observations"`);
    }
}
