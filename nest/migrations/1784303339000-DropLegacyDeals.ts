import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Historical migrations are immutable. The unused Deals feature is removed by
 * this forward migration so fresh databases, upgraded databases and rollbacks
 * all follow the same schema history.
 */
export class DropLegacyDeals1784303339000 implements MigrationInterface {
    name = "DropLegacyDeals1784303339000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "deals"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "deals" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "done" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_8c66f03b250f613ff8615940b4b" PRIMARY KEY ("id"))`,
        );
    }
}
