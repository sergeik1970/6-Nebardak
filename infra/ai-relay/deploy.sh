#!/usr/bin/env bash
# Installs or updates the AI relay on the Amsterdam server. Run from anywhere
# in the repository: bash infra/ai-relay/deploy.sh
# The provider key is never sent from here: it is typed into the server's .env.
set -euo pipefail

SERVER="${AI_RELAY_SERVER:-root@89.208.107.138}"
REMOTE=/root/stylefinder-ai-relay
HERE="$(cd "$(dirname "$0")" && pwd)"

rsync -a --delete --exclude .env --exclude data --exclude node_modules "$HERE/" "$SERVER:$REMOTE/"

ssh "$SERVER" bash -s <<EOF
set -euo pipefail
cd $REMOTE
if [ ! -f .env ]; then
    umask 077
    sed "s/^RELAY_TOKEN=.*/RELAY_TOKEN=\$(openssl rand -hex 32)/" .env.example > .env
    echo "Created .env with a new RELAY_TOKEN. Put AI_API_KEY and AI_MODEL into $REMOTE/.env"
fi
chmod 600 .env
# 120 s was too short for whole-apartment plans.
sed -i 's/^RELAY_TIMEOUT_SECONDS=120$/RELAY_TIMEOUT_SECONDS=300/' .env
install -d -o 1000 -g 1000 -m 700 data
docker compose up -d --build --force-recreate
sleep 3
docker compose ps
curl -fsS http://127.0.0.1:8790/health && echo
EOF
