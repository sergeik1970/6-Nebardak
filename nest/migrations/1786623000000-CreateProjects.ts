import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProjects1786623000000 implements MigrationInterface {
    name = "CreateProjects1786623000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "project" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "owner_user_id" integer NOT NULL,
                "name" character varying(80) NOT NULL,
                "document" jsonb NOT NULL,
                "document_version" smallint NOT NULL,
                "revision" integer NOT NULL DEFAULT 1,
                "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "client_import_id" character varying(64),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_project" PRIMARY KEY ("id"),
                CONSTRAINT "CHK_project_revision" CHECK ("revision" >= 1),
                CONSTRAINT "CHK_project_document_object" CHECK (jsonb_typeof("document") = 'object'),
                CONSTRAINT "FK_project_owner" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE
            )`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_project_owner_updated" ON "project" ("owner_user_id", "updated_at" DESC)`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "UQ_project_owner_import" ON "project" ("owner_user_id", "client_import_id") WHERE "client_import_id" IS NOT NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "project"`);
    }
}
