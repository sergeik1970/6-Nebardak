#!/bin/bash
# Monthly restore drill (DEPLOY.md, §5). Runs on a separate machine with Docker,
# never on the production server: it needs the age private key and a read-only
# storage key, neither of which the server holds.
#
#   restore-drill.sh                     restores the newest daily/ copy
#   restore-drill.sh path/to/file.age    restores a local copy
#
# The dump is restored into a throwaway PostgreSQL container without network
# access, then the migrations table and per-table row counts are checked.
set -euo pipefail

CONFIG=${STYLEFINDER_DRILL_CONFIG:-$HOME/.config/stylefinder/drill.env}
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"

: "${AGE_IDENTITY:?Set AGE_IDENTITY (path to the age private key) in $CONFIG}"
POSTGRES_IMAGE=postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
EMPTY_SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

WORK=$(mktemp -d)
CONTAINER="stylefinder-restore-drill-$$"
cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

s3_get() {
    printf 'user = "%s:%s"\n' "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" |
        curl -fsS -m 600 --retry 3 -K - \
            --aws-sigv4 "aws:amz:$S3_REGION:s3" \
            -H "x-amz-content-sha256: $EMPTY_SHA" \
            "$S3_ENDPOINT/$S3_BUCKET/$1"
}

if [ $# -ge 1 ]; then
    SOURCE=$1
    cp "$SOURCE" "$WORK/backup.age"
else
    : "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
    # Object names carry a UTC timestamp, so the lexically last key is the newest.
    SOURCE=$(s3_get '?list-type=2&prefix=daily/' |
        grep -o '<Key>[^<]*</Key>' | sed 's/<[^>]*>//g' | sort | tail -n 1)
    [ -n "$SOURCE" ] || { echo "no objects under daily/" >&2; exit 1; }
    s3_get "$SOURCE" >"$WORK/backup.age"
fi

age -d -i "$AGE_IDENTITY" -o "$WORK/backup.dump" "$WORK/backup.age"
chmod 644 "$WORK/backup.dump"

docker run -d --name "$CONTAINER" --network none \
    -e POSTGRES_PASSWORD=restore-drill-only \
    -e POSTGRES_DB=stylefinder_drill \
    -v "$WORK:/backup:ro" \
    "$POSTGRES_IMAGE" >/dev/null

for _ in $(seq 60); do
    docker exec "$CONTAINER" pg_isready -U postgres -d stylefinder_drill >/dev/null 2>&1 && break
    sleep 1
done

psql() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d stylefinder_drill -At "$@"; }

docker exec "$CONTAINER" pg_restore --exit-on-error --no-owner --no-privileges \
    -U postgres -d stylefinder_drill /backup/backup.dump

MIGRATIONS=$(psql -c 'SELECT count(*) FROM migrations')
[ "$MIGRATIONS" -gt 0 ] || { echo "migrations table is empty" >&2; exit 1; }

echo "Row counts:"
psql <<'SQL'
SELECT format('SELECT %L || '' '' || count(*) FROM public.%I', table_name, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec
SQL

SUMMARY="restore drill OK $(date -u +%Y-%m-%d) source=$SOURCE migrations=$MIGRATIONS"
echo "$SUMMARY"
if [ -n "${HC_DRILL_PING_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$SUMMARY" "$HC_DRILL_PING_URL" || true
fi
