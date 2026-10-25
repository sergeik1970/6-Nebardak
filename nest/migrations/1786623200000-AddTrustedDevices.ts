import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrustedDevices1786623200000 implements MigrationInterface {
    name = "AddTrustedDevices1786623200000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "trusted_device" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" integer NOT NULL,
                "token_hash" character(64) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_trusted_device" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_trusted_device_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "FK_trusted_device_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
            )`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_trusted_device_user" ON "trusted_device" ("user_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "trusted_device"`);
    }
}
