import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteTest1708260920831 implements MigrationInterface {
    name = "DeleteTest1708260920831";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "deals" DROP COLUMN "test"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "deals" ADD "test" character varying NOT NULL`,
        );
    }
}
