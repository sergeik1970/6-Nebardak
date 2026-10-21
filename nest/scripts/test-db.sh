#!/bin/sh
# Runs the SQL-level integration tests against a throwaway PostgreSQL that
# matches production (16, Alpine). The container is removed on exit.
set -eu

name="stylefinder-test-db-$$"
image="postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
password="test-only-db-password"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$name" \
    -e POSTGRES_DB=stylefinder_test -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD="$password" -p 127.0.0.1::5432 "$image" >/dev/null

port=$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')
i=0
until docker exec "$name" pg_isready -U postgres -d stylefinder_test >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 60 ] && { echo "PostgreSQL did not start" >&2; exit 1; }
    sleep 1
done
# pg_isready can succeed during the init restart; wait for a real query.
until docker exec "$name" psql -U postgres -d stylefinder_test -c 'SELECT 1' >/dev/null 2>&1; do sleep 1; done

TEST_DB_HOST=127.0.0.1 TEST_DB_PORT="$port" TEST_DB_PASSWORD="$password" \
    npx jest --config ./test/jest-db.json --runInBand "$@"
