#!/bin/bash
# Disk and memory check for the production server (DEPLOY.md, §8). Reports to a
# Healthchecks.io check: success while usage is within limits, /fail otherwise,
# and silence (which also alerts) if the server stops running it.
set -euo pipefail

CONFIG=${STYLEFINDER_BACKUP_CONFIG:-/etc/stylefinder/backup.env}
# shellcheck source=/dev/null
. "$CONFIG"

: "${HC_RESOURCES_PING_URL:?Set HC_RESOURCES_PING_URL in $CONFIG}"
DISK_LIMIT=${DISK_LIMIT_PERCENT:-80}
MEMORY_FLOOR=${MEMORY_AVAILABLE_MIN_PERCENT:-10}

problems=()
for mount in / /var/lib/docker; do
    [ -d "$mount" ] || continue
    used=$(df --output=pcent "$mount" | tail -n 1 | tr -dc '0-9')
    if [ "$used" -ge "$DISK_LIMIT" ]; then problems+=("disk $mount ${used}%"); fi
done

available=$(awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {print int(a * 100 / t)}' /proc/meminfo)
if [ "$available" -lt "$MEMORY_FLOOR" ]; then problems+=("memory available ${available}%"); fi

if [ ${#problems[@]} -eq 0 ]; then
    curl -fsS -m 10 --retry 3 -o /dev/null "$HC_RESOURCES_PING_URL"
else
    curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${problems[*]}" "$HC_RESOURCES_PING_URL/fail"
fi
