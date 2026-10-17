import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserRoles1786622500000 implements MigrationInterface {
    name = "AddUserRoles1786622500000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user" ADD "role" character varying(16) NOT NULL DEFAULT 'designer'`,
        );
        await queryRunner.query(
            `ALTER TABLE "user" ADD CONSTRAINT "CHK_user_role" CHECK ("role" IN ('designer', 'admin'))`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_user_role" ON "user" ("role")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_user_role"`);
        await queryRunner.query(
            `ALTER TABLE "user" DROP CONSTRAINT "CHK_user_role"`,
        );
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "role"`);
    }
}
