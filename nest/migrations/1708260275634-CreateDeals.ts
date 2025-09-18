import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDeals1708260275634 implements MigrationInterface {
    name = "CreateDeals1708260275634";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "deals" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "test" character varying NOT NULL, CONSTRAINT "PK_8c66f03b250f613ff8615940b4b" PRIMARY KEY ("id"))`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "deals"`);
    }
}
