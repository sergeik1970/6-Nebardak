import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminLoginCode1786623100000 implements MigrationInterface {
    name = "AddAdminLoginCode1786623100000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "login_challenge" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" integer NOT NULL,
                "token_hash" character(64) NOT NULL,
                "code_hash" character(64) NOT NULL,
                "attempts" smallint NOT NULL DEFAULT 0,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_login_challenge" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_login_challenge_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "CHK_login_challenge_attempts" CHECK ("attempts" >= 0),
                CONSTRAINT "FK_login_challenge_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
            )`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_login_challenge_user" ON "login_challenge" ("user_id")`,
        );
        await queryRunner.query(
            `ALTER TABLE "user_session" ADD "second_factor_at" TIMESTAMP WITH TIME ZONE`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user_session" DROP COLUMN "second_factor_at"`,
        );
        await queryRunner.query(`DROP TABLE "login_challenge"`);
    }
}
