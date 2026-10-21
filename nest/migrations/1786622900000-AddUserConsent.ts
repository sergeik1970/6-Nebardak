import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserConsent1786622900000 implements MigrationInterface {
    name = "AddUserConsent1786622900000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user" ADD "consentVersion" character varying(16), ADD "consentAt" TIMESTAMP WITH TIME ZONE`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user" DROP COLUMN "consentAt", DROP COLUMN "consentVersion"`,
        );
    }
}
