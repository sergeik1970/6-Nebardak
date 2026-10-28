#!/bin/bash
# Daily off-site PostgreSQL backup (DEPLOY.md, §5).
#
# The dump is checked with pg_restore --list, encrypted with age to a public
# recipient whose private key never lives on the server, and uploaded to
# S3-compatible storage. A bucket lifecycle rule deletes copies after 30 days, the
# term stated in the privacy policy.
set -Eeuo pipefail

CONFIG=${STYLEFINDER_BACKUP_CONFIG:-/etc/stylefinder/backup.env}
# shellcheck source=/dev/null
. "$CONFIG"

: "${APP_DIR:?Set APP_DIR in $CONFIG}"
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT in $CONFIG}"
: "${S3_ENDPOINT:?Set S3_ENDPOINT in $CONFIG}"
: "${S3_REGION:?Set S3_REGION in $CONFIG}"
: "${S3_BUCKET:?Set S3_BUCKET in $CONFIG}"
: "${S3_ACCESS_KEY_ID:?Set S3_ACCESS_KEY_ID in $CONFIG}"
: "${S3_SECRET_ACCESS_KEY:?Set S3_SECRET_ACCESS_KEY in $CONFIG}"
WORK_DIR=${WORK_DIR:-/var/lib/stylefinder-backup}

ping_healthcheck() {
    # Optional: a Healthchecks.io check alerts when no successful run arrives.
    [ -n "${HC_BACKUP_PING_URL:-}" ] || return 0
    curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$HC_BACKUP_PING_URL$1" || true
}

fail() {
    status=$?
    trap - ERR
    echo "backup failed at line $1 (exit $status)" >&2
    ping_healthcheck /fail "backup failed at line $1 (exit $status)"
    exit "$status"
}
trap 'fail $LINENO' ERR

dc() {
    docker compose --env-file "$APP_DIR/.env.server" -f "$APP_DIR/docker-compose.yml" "$@"
}

s3_put() {
    local file=$1 key=$2 sha
    sha=$(sha256sum "$file" | cut -d' ' -f1)
    # Credentials go through stdin so they never appear in the process list.
    printf 'user = "%s:%s"\n' "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" |
        curl -fsS -m 600 --retry 3 -K - \
            --aws-sigv4 "aws:amz:$S3_REGION:s3" \
            -H "x-amz-content-sha256: $sha" \
            -T "$file" -o /dev/null \
            "$S3_ENDPOINT/$S3_BUCKET/$key"
}

ping_healthcheck /start

umask 077
install -d -m 700 "$WORK_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$WORK_DIR/stylefinder-$STAMP.dump"
ENCRYPTED="$DUMP.age"
trap 'rm -f "$DUMP" "$ENCRYPTED"' EXIT

# shellcheck disable=SC2016 # expanded inside the db container
dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$DUMP"
test -s "$DUMP"
dc exec -T db pg_restore --list <"$DUMP" >/dev/null

age -r "$AGE_RECIPIENT" -o "$ENCRYPTED" "$DUMP"
rm -f "$DUMP"

NAME=$(basename "$ENCRYPTED")
s3_put "$ENCRYPTED" "daily/$NAME"

SIZE=$(wc -c <"$ENCRYPTED" | tr -d ' ')
echo "uploaded $NAME ($SIZE bytes)"
# Read by the monitor bot's status script (infra/monitor-bot/prod/stylefinder-status).
echo "$(date -u +%s) $NAME" >"$WORK_DIR/last-success"
ping_healthcheck "" "uploaded $NAME ($SIZE bytes)"
