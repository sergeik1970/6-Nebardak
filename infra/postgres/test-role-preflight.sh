#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/stylefinder-role-preflight.XXXXXX")
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

printf '%s\n' '#!/bin/sh' 'cat >/dev/null' >"$TEMP_DIR/psql"
chmod +x "$TEMP_DIR/psql"

invoke_provisioner() {
    admin_password=$1
    app_password=$2
    migrator_password=$3

    env \
        PATH="$TEMP_DIR:$PATH" \
        PGHOST=database \
        PGDATABASE=stylefinder \
        PGUSER=stylefinder_admin \
        PGPASSWORD="$admin_password" \
        APP_DB_USER=stylefinder_app \
        APP_DB_PASSWORD="$app_password" \
        MIGRATOR_DB_USER=stylefinder_migrator \
        MIGRATOR_DB_PASSWORD="$migrator_password" \
        sh "$SCRIPT_DIR/provision-db-roles.sh"
}

expect_rejected() {
    label=$1
    shift
    if invoke_provisioner "$@" >/dev/null 2>&1; then
        echo "Expected role preflight to reject: $label" >&2
        exit 1
    fi
}

expect_rejected \
    "documented placeholders" \
    replace_with_a_long_random_admin_password \
    replace_with_a_different_long_random_app_password \
    replace_with_a_third_long_random_migrator_password

expect_rejected \
    "a short password" \
    test-only-admin-password-2026 \
    too-short \
    test-only-migrator-password-2026

expect_rejected \
    "shared role passwords" \
    test-only-shared-password-2026 \
    test-only-shared-password-2026 \
    test-only-migrator-password-2026

expect_rejected \
    "a password equal to its role name" \
    stylefinder_admin \
    test-only-app-password-2026 \
    test-only-migrator-password-2026

invoke_provisioner \
    test-only-admin-password-2026 \
    test-only-app-password-2026 \
    test-only-migrator-password-2026 >/dev/null

echo "Database role password preflight verified."
