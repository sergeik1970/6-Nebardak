import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerification1786622800000 implements MigrationInterface {
    name = "AddEmailVerification1786622800000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user" ADD "emailVerifiedAt" TIMESTAMP WITH TIME ZONE`,
        );
        await queryRunner.query(
            `CREATE TABLE "email_token" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" integer NOT NULL,
                "purpose" character varying(32) NOT NULL,
                "token_hash" character(64) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "used_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_email_token" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_email_token_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "CHK_email_token_purpose" CHECK ("purpose" IN ('verify-email', 'reset-password')),
                CONSTRAINT "FK_email_token_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
            )`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_email_token_user_purpose" ON "email_token" ("user_id", "purpose")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "email_token"`);
        await queryRunner.query(
            `ALTER TABLE "user" DROP COLUMN "emailVerifiedAt"`,
        );
    }
}
