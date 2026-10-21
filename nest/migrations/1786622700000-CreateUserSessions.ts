import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserSessions1786622700000 implements MigrationInterface {
    name = "CreateUserSessions1786622700000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "user_session" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" integer NOT NULL,
                "token_hash" character(64) NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "absolute_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "user_agent" character varying(200),
                CONSTRAINT "PK_user_session" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_user_session_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "CHK_user_session_expiry" CHECK ("expires_at" <= "absolute_expires_at"),
                CONSTRAINT "FK_user_session_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
            )`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_user_session_user" ON "user_session" ("user_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "user_session"`);
    }
}
