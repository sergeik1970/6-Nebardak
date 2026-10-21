#!/bin/sh
# End-to-end tests with accounts switched on: a throwaway PostgreSQL and
# Mailpit in Docker, every migration applied, then Playwright starts the API
# and the Next.js dev server (it proxies /api, as Caddy does in production).
# Containers are removed on exit. Extra arguments go to Playwright.
set -eu

cd "$(dirname "$0")/.."
NEST_DIR=$(cd ../nest && pwd)

db="stylefinder-e2e-db-$$"
mail="stylefinder-e2e-mail-$$"
db_image="postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
mail_image="axllent/mailpit:v1.31.3@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d"
db_password="e2e-only-db-password"

cleanup() { docker rm -f "$db" "$mail" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$db" \
    -e POSTGRES_DB=stylefinder_e2e -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD="$db_password" -p 127.0.0.1::5432 "$db_image" >/dev/null
docker run -d --rm --name "$mail" -p 127.0.0.1::1025 -p 127.0.0.1::8025 "$mail_image" >/dev/null

port_of() { docker port "$1" "$2/tcp" | head -n 1 | sed 's/.*://'; }

i=0
until docker exec "$db" psql -U postgres -d stylefinder_e2e -c 'SELECT 1' >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 60 ] && { echo "PostgreSQL did not start" >&2; exit 1; }
    sleep 1
done

export E2E_DB_PORT="$(port_of "$db" 5432)"
export E2E_DB_PASSWORD="$db_password"
export E2E_SMTP_PORT="$(port_of "$mail" 1025)"
export E2E_MAILPIT_URL="http://127.0.0.1:$(port_of "$mail" 8025)"

(
    cd "$NEST_DIR"
    NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT="$E2E_DB_PORT" DB_USERNAME=postgres \
        DB_PASSWORD="$db_password" DB_NAME=stylefinder_e2e \
        npm run -s typeorm:run-migrations >/dev/null
)

npx playwright test -c playwright.accounts.config.ts "$@"
