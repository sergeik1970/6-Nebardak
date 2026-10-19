#!/bin/sh
set -eu

for variable in \
    PGHOST PGDATABASE PGUSER PGPASSWORD \
    APP_DB_USER APP_DB_PASSWORD \
    MIGRATOR_DB_USER MIGRATOR_DB_PASSWORD
do
    eval "value=\${$variable:-}"
    if [ -z "$value" ]; then
        echo "Missing required database provisioning variable: $variable" >&2
        exit 1
    fi
done

validate_password() (
    password_name=$1
    password_value=$2
    minimum_length=16

    if [ "${#password_value}" -lt "$minimum_length" ]; then
        echo "$password_name must contain at least $minimum_length characters" >&2
        exit 1
    fi

    normalized=$(printf '%s' "$password_value" | tr '[:upper:]' '[:lower:]')
    case "$normalized" in
        password|database-password|replace_with_*|change_this_*|change_me|change_me_*)
            echo "$password_name must not use a documented or common placeholder" >&2
            exit 1
            ;;
    esac
)

validate_password PGPASSWORD "$PGPASSWORD"
validate_password APP_DB_PASSWORD "$APP_DB_PASSWORD"
validate_password MIGRATOR_DB_PASSWORD "$MIGRATOR_DB_PASSWORD"

if [ "$APP_DB_USER" = "$MIGRATOR_DB_USER" ] || \
   [ "$APP_DB_USER" = "$PGUSER" ] || \
   [ "$MIGRATOR_DB_USER" = "$PGUSER" ]; then
    echo "Admin, migrator and application roles must be different" >&2
    exit 1
fi

if [ "$PGPASSWORD" = "$APP_DB_PASSWORD" ] || \
   [ "$PGPASSWORD" = "$MIGRATOR_DB_PASSWORD" ] || \
   [ "$APP_DB_PASSWORD" = "$MIGRATOR_DB_PASSWORD" ]; then
    echo "Admin, migrator and application passwords must be different" >&2
    exit 1
fi

if [ "$PGPASSWORD" = "$PGUSER" ] || \
   [ "$APP_DB_PASSWORD" = "$APP_DB_USER" ] || \
   [ "$MIGRATOR_DB_PASSWORD" = "$MIGRATOR_DB_USER" ]; then
    echo "A database password must not equal its role name" >&2
    exit 1
fi

psql --set=ON_ERROR_STOP=1 \
    --set=db_name="$PGDATABASE" \
    --set=app_user="$APP_DB_USER" \
    --set=app_password="$APP_DB_PASSWORD" \
    --set=migrator_user="$MIGRATOR_DB_USER" \
    --set=migrator_password="$MIGRATOR_DB_PASSWORD" <<'SQL'
BEGIN;

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'migrator_user', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_user') \gexec

SELECT format(
    'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'app_user', :'app_password'
) \gexec
SELECT format(
    'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'migrator_user', :'migrator_password'
) \gexec

-- An upgraded cluster may contain stale memberships from the legacy setup.
-- NOINHERIT alone is insufficient because SET ROLE would still be available.
SELECT format('REVOKE %I FROM %I', granted_role.rolname, member_role.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname IN (:'app_user', :'migrator_user') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM %I', :'db_name', :'app_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'app_user') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'db_name', :'migrator_user') \gexec

SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', datname)
FROM pg_database
WHERE datallowconn AND datname <> :'db_name' \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', datname, :'app_user')
FROM pg_database
WHERE datallowconn AND datname <> :'db_name' \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', datname, :'migrator_user')
FROM pg_database
WHERE datallowconn AND datname <> :'db_name' \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON SCHEMA public FROM %I', :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migrator_user') \gexec

-- Remove grants that may predate the least-privilege model. Otherwise the app
-- can regain access indirectly through PUBLIC even after its direct ACL is reset.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'app_user') \gexec

SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'migrator_user')
FROM pg_tables
WHERE schemaname = 'public' \gexec

SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', sequence_schema, sequence_name, :'migrator_user')
FROM information_schema.sequences
WHERE sequence_schema = 'public' \gexec

SELECT format('REVOKE ALL ON TABLE %I.%I FROM %I', schemaname, tablename, :'app_user')
FROM pg_tables
WHERE schemaname = 'public' \gexec

SELECT format(
    'REVOKE ALL ON SEQUENCE %I.%I FROM %I',
    sequence_schema, sequence_name, :'app_user'
)
FROM information_schema.sequences
WHERE sequence_schema = 'public' \gexec

SELECT format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I',
    schemaname, tablename, :'app_user'
)
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'user' \gexec

-- Planner observations are written and triaged by the API but never deleted
-- by it; user deletion cascades as the table owner.
SELECT format(
    'GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO %I',
    schemaname, tablename, :'app_user'
)
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'planner_observations' \gexec

SELECT format(
    'GRANT USAGE ON SEQUENCE %I.%I TO %I',
    sequence_schema, sequence_name, :'app_user'
)
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name IN ('user_id_seq', 'planner_observations_id_seq') \gexec

SELECT format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
    :'migrator_user', :'app_user'
) \gexec
SELECT format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
    :'migrator_user', :'app_user'
) \gexec
SELECT format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
    :'migrator_user'
) \gexec
SELECT format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
    :'migrator_user'
) \gexec
SELECT format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
    :'migrator_user', :'app_user'
) \gexec
SELECT format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC',
    :'migrator_user'
) \gexec

SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'app_user', '5s') \gexec
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'migrator_user', '60s') \gexec

COMMIT;
SQL

echo "Database roles and least-privilege grants are ready; run this service again after every migration."
