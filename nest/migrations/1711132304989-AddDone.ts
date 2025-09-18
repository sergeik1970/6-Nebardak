import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDone1711132304989 implements MigrationInterface {
    name = "AddDone1711132304989";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "deals" ADD "done" boolean NOT NULL DEFAULT false`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "deals" DROP COLUMN "done"`);
    }
}
