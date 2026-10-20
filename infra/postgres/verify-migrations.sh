#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
PROJECT_NAME=${STYLEFINDER_DB_CHECK_PROJECT:-"stylefinder-db-check-${GITHUB_RUN_ID:-local}-$$"}

if [ -n "${STYLEFINDER_ENV_FILE:-}" ]; then
    ENV_FILE=$STYLEFINDER_ENV_FILE
else
    ENV_FILE="$ROOT_DIR/.env.server.example"
    # This path always creates an isolated temporary Compose project and volume.
    # Override only the documented placeholders; never print these test-only values.
    export POSTGRES_ADMIN_PASSWORD="verify-admin-${GITHUB_RUN_ID:-local}-$$-not-production"
    export APP_DB_PASSWORD="verify-app-${GITHUB_RUN_ID:-local}-$$-not-production"
    export MIGRATOR_DB_PASSWORD="verify-migrator-${GITHUB_RUN_ID:-local}-$$-not-production"
fi

dc() {
    docker compose \
        --project-name "$PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$ROOT_DIR/docker-compose.yml" \
        "$@"
}

cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [ "${KEEP_STYLEFINDER_DB_CHECK:-0}" != "1" ]; then
        dc down --volumes --remove-orphans >/dev/null 2>&1 || true
    fi
    exit "$status"
}
trap cleanup EXIT INT TERM

dc up -d db

# The app role is created first; the reserved pseudo-role `public` then forces a
# later statement to fail. The transaction must roll the first role back.
if dc --profile tools run --rm -T \
    -e APP_DB_USER=stylefinder_atomic_probe \
    -e APP_DB_PASSWORD=atomic-probe-app-password-2026 \
    -e MIGRATOR_DB_USER=public \
    -e MIGRATOR_DB_PASSWORD=atomic-probe-migrator-password-2026 \
    db-roles >/dev/null 2>&1; then
    echo "Database role provisioning failure probe unexpectedly succeeded" >&2
    exit 1
fi

dc exec -T db sh -c \
    'psql --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stylefinder_atomic_probe') THEN
        RAISE EXCEPTION 'failed role provisioning was not rolled back';
    END IF;
END
$$;
SQL

dc --profile tools run --rm db-roles
dc --profile tools run --rm migrate

# Simulate a cluster upgraded from a broader legacy ACL model. The second
# provisioning pass must remove inherited and PUBLIC grants as well as direct
# grants, not merely produce a safe fresh-volume result.
dc --profile tools run --rm -T --entrypoint /bin/sh db-roles -c '
    exec psql --set=ON_ERROR_STOP=1 --set=app_user="$APP_DB_USER"
' <<'SQL'
CREATE ROLE stylefinder_inherited_probe NOLOGIN;
GRANT SELECT ON TABLE migrations TO stylefinder_inherited_probe;
SELECT format('GRANT stylefinder_inherited_probe TO %I', :'app_user') \gexec
GRANT SELECT ON TABLE migrations TO PUBLIC;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
CREATE FUNCTION public.stylefinder_privilege_probe() RETURNS integer
LANGUAGE sql AS 'SELECT 1';
SELECT format(
    'GRANT EXECUTE ON FUNCTION public.stylefinder_privilege_probe() TO %I',
    :'app_user'
) \gexec
GRANT EXECUTE ON FUNCTION public.stylefinder_privilege_probe() TO PUBLIC;
SQL

dc --profile tools run --rm db-roles

dc exec -T db sh -c \
    'psql --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DO $$
DECLARE
    applied_migrations integer;
BEGIN
    SELECT COUNT(*) INTO applied_migrations FROM migrations;
    IF applied_migrations <> 11 THEN
        RAISE EXCEPTION 'expected 11 applied migrations, got %', applied_migrations;
    END IF;
    IF to_regclass('public.deals') IS NOT NULL THEN
        RAISE EXCEPTION 'legacy deals table still exists';
    END IF;
    IF to_regclass('public.user') IS NULL THEN
        RAISE EXCEPTION 'user table is missing';
    END IF;
END
$$;

INSERT INTO "user" ("email", "name", "password")
VALUES ('Case@Test.Example', 'CI migration check', 'not-a-real-password-hash');

DO $$
BEGIN
    BEGIN
        INSERT INTO "user" ("email", "name", "password")
        VALUES ('case@test.example', 'Must conflict', 'not-a-real-password-hash');
        RAISE EXCEPTION 'case-insensitive unique email constraint did not reject a duplicate';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END
$$;
SQL

dc --profile tools run --rm -T --entrypoint /bin/sh db-roles -c '
    export PGUSER="$APP_DB_USER" PGPASSWORD="$APP_DB_PASSWORD"
    exec psql --set=ON_ERROR_STOP=1
' <<'SQL'
DO $$
BEGIN
    IF has_database_privilege(current_user, current_database(), 'TEMP') THEN
        RAISE EXCEPTION 'runtime role can create temporary objects';
    END IF;
    IF has_schema_privilege(current_user, 'public', 'CREATE') THEN
        RAISE EXCEPTION 'runtime role can create schema objects';
    END IF;
    IF NOT has_table_privilege(current_user, 'public.user', 'SELECT') OR
       NOT has_table_privilege(current_user, 'public.user', 'INSERT') OR
       NOT has_table_privilege(current_user, 'public.user', 'UPDATE') OR
       NOT has_table_privilege(current_user, 'public.user', 'DELETE') THEN
        RAISE EXCEPTION 'runtime role lacks required user-table DML rights';
    END IF;
    IF has_table_privilege(current_user, 'public.migrations', 'SELECT') THEN
        RAISE EXCEPTION 'runtime role can read migration history';
    END IF;
    IF has_function_privilege(
        current_user,
        'public.stylefinder_privilege_probe()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'runtime role retained access to a legacy public function';
    END IF;
    IF NOT has_sequence_privilege(current_user, 'public.user_id_seq', 'USAGE') THEN
        RAISE EXCEPTION 'runtime role cannot allocate user identifiers';
    END IF;
    IF NOT has_table_privilege(current_user, 'public.planner_observations', 'SELECT') OR
       NOT has_table_privilege(current_user, 'public.planner_observations', 'INSERT') OR
       NOT has_table_privilege(current_user, 'public.planner_observations', 'UPDATE') THEN
        RAISE EXCEPTION 'runtime role lacks required planner-observation rights';
    END IF;
    IF has_table_privilege(current_user, 'public.planner_observations', 'DELETE') THEN
        RAISE EXCEPTION 'runtime role can delete planner observations';
    END IF;
    IF NOT has_sequence_privilege(current_user, 'public.planner_observations_id_seq', 'USAGE') THEN
        RAISE EXCEPTION 'runtime role cannot allocate planner observation identifiers';
    END IF;
    IF NOT has_table_privilege(current_user, 'public.user_session', 'SELECT') OR
       NOT has_table_privilege(current_user, 'public.user_session', 'INSERT') OR
       NOT has_table_privilege(current_user, 'public.user_session', 'UPDATE') OR
       NOT has_table_privilege(current_user, 'public.user_session', 'DELETE') THEN
        RAISE EXCEPTION 'runtime role lacks required session rights';
    END IF;
    IF NOT has_table_privilege(current_user, 'public.email_token', 'SELECT') OR
       NOT has_table_privilege(current_user, 'public.email_token', 'INSERT') OR
       NOT has_table_privilege(current_user, 'public.email_token', 'UPDATE') OR
       NOT has_table_privilege(current_user, 'public.email_token', 'DELETE') THEN
        RAISE EXCEPTION 'runtime role lacks required email-link rights';
    END IF;
    IF has_sequence_privilege(current_user, 'public.user_id_seq', 'SELECT') OR
       has_sequence_privilege(current_user, 'public.user_id_seq', 'UPDATE') THEN
        RAISE EXCEPTION 'runtime role has broader sequence rights than required';
    END IF;

    BEGIN
        EXECUTE 'CREATE TEMP TABLE runtime_role_must_not_create_temp (id integer)';
        RAISE EXCEPTION 'runtime role unexpectedly created a temporary table';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = current_user
          AND (rolinherit OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'runtime role retains INHERIT or BYPASSRLS';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_auth_members membership
        JOIN pg_roles member_role ON member_role.oid = membership.member
        WHERE member_role.rolname = current_user
    ) THEN
        RAISE EXCEPTION 'runtime role retains a legacy role membership';
    END IF;
END
$$;

INSERT INTO "user" ("email", "name", "password")
VALUES ('runtime-ci@example.test', 'Runtime CI', 'not-a-real-password-hash');
SELECT "id" FROM "user" WHERE "email" = 'runtime-ci@example.test';
UPDATE "user" SET "name" = 'Runtime CI updated'
WHERE "email" = 'runtime-ci@example.test';
INSERT INTO "planner_observations" (
    "created_by_user_id", "client_observation_id", "input_snapshot", "layout_snapshot",
    "input_fingerprint", "layout_fingerprint", "algorithm_version", "catalog_version",
    "solver_status"
)
SELECT "id", 'runtime-ci', '{}', '{}', 'ci', 'ci', 'ci', 'ci', 'solved'
FROM "user" WHERE "email" = 'runtime-ci@example.test';
UPDATE "planner_observations" SET "review_verdict" = 'good'
WHERE "client_observation_id" = 'runtime-ci';
INSERT INTO "user_session" (
    "user_id", "token_hash", "last_seen_at", "expires_at", "absolute_expires_at"
)
SELECT "id", repeat('a', 64), now(), now() + interval '1 day', now() + interval '2 days'
FROM "user" WHERE "email" = 'runtime-ci@example.test';
UPDATE "user_session" SET "last_seen_at" = now() WHERE "token_hash" = repeat('a', 64);
DELETE FROM "user_session" WHERE "token_hash" = repeat('a', 64);
INSERT INTO "email_token" ("user_id", "purpose", "token_hash", "expires_at")
SELECT "id", 'verify-email', repeat('b', 64), now() + interval '1 hour'
FROM "user" WHERE "email" = 'runtime-ci@example.test';
UPDATE "email_token" SET "used_at" = now() WHERE "token_hash" = repeat('b', 64);
UPDATE "user" SET "emailVerifiedAt" = now() WHERE "email" = 'runtime-ci@example.test';
DELETE FROM "email_token" WHERE "token_hash" = repeat('b', 64);
DELETE FROM "user" WHERE "email" = 'runtime-ci@example.test';
SQL

if dc --profile tools run --rm -T --entrypoint /bin/sh db-roles -c '
    export PGUSER="$APP_DB_USER" PGPASSWORD="$APP_DB_PASSWORD"
    exec psql --set=ON_ERROR_STOP=1 --dbname=postgres --command="SELECT 1"
' >/dev/null 2>&1; then
    echo "Runtime role can connect to the maintenance database" >&2
    exit 1
fi

dc --profile tools run --rm migrate npm run typeorm:revert-migration:prod
dc --profile tools run --rm migrate
dc --profile tools run --rm db-roles

dc exec -T db sh -c \
    'psql --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DO $$
DECLARE
    applied_migrations integer;
BEGIN
    SELECT COUNT(*) INTO applied_migrations FROM migrations;
    IF applied_migrations <> 11 THEN
        RAISE EXCEPTION 'rollback/reapply left % migrations instead of 11', applied_migrations;
    END IF;
    IF to_regclass('public.deals') IS NOT NULL THEN
        RAISE EXCEPTION 'legacy deals table returned after rollback/reapply';
    END IF;
END
$$;
SQL

echo "Fresh migrations, least-privilege access and rollback/reapply verified."
