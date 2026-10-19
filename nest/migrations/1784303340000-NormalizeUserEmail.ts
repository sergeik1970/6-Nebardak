import { MigrationInterface, QueryRunner } from "typeorm";

interface InvalidEmailRow {
    id: number;
}

interface DuplicateEmailGroup {
    duplicateCount: number | string;
    userIds: number[];
}

/**
 * Enforces the same normalized email identity used by AuthService. Existing
 * duplicates are reported before any data is changed so operators can resolve
 * them deliberately and rerun the migration.
 */
export class NormalizeUserEmail1784303340000 implements MigrationInterface {
    name = "NormalizeUserEmail1784303340000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE`,
        );

        const invalidRows = (await queryRunner.query(
            `SELECT "id" FROM "user" WHERE BTRIM("email") = '' ORDER BY "id" LIMIT 20`,
        )) as InvalidEmailRow[];

        if (invalidRows.length > 0) {
            throw new Error(
                `Cannot normalize user email: blank values exist for user IDs ${invalidRows
                    .map(({ id }) => id)
                    .join(", ")}. Resolve them before rerunning the migration.`,
            );
        }

        const duplicateGroups = (await queryRunner.query(
            `SELECT COUNT(*)::integer AS "duplicateCount", ARRAY_AGG("id" ORDER BY "id") AS "userIds"
             FROM "user"
             GROUP BY LOWER(BTRIM("email"))
             HAVING COUNT(*) > 1
             ORDER BY MIN("id")
             LIMIT 20`,
        )) as DuplicateEmailGroup[];

        if (duplicateGroups.length > 0) {
            const affectedUserIds = duplicateGroups
                .flatMap(({ userIds }) => userIds)
                .join(", ");
            throw new Error(
                `Cannot enforce case-insensitive unique user email: found ${duplicateGroups.length} duplicate normalized email group(s), affecting user IDs ${affectedUserIds}. Resolve duplicates before rerunning the migration.`,
            );
        }

        await queryRunner.query(
            `UPDATE "user" SET "email" = LOWER(BTRIM("email")) WHERE "email" IS DISTINCT FROM LOWER(BTRIM("email"))`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_user_email_lower_unique" ON "user" (LOWER("email"))`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_user_email_lower_unique"`,
        );
    }
}
