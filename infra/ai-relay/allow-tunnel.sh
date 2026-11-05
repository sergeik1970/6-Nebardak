#!/bin/bash
# Run on the relay server as root with the production tunnel's public key:
#   ssh root@89.208.107.138 'bash -s' -- "ssh-ed25519 AAAA... comment" < infra/ai-relay/allow-tunnel.sh
# Adds a user without a shell whose only right is to forward to the relay's
# localhost port, and only from the production server.
set -euo pipefail

KEY="${1:?usage: allow-tunnel.sh \"<public key>\"}"
FROM="${AI_TUNNEL_FROM:-62.113.60.95}"
case "$KEY" in
    ssh-ed25519\ *) ;;
    *) echo "expected an ssh-ed25519 public key" >&2; exit 1 ;;
esac

id ai-tunnel >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin ai-tunnel
install -d -m 700 -o ai-tunnel -g ai-tunnel /home/ai-tunnel/.ssh
echo "restrict,port-forwarding,permitopen=\"127.0.0.1:8790\",from=\"$FROM\" $KEY" \
    > /home/ai-tunnel/.ssh/authorized_keys
chown ai-tunnel:ai-tunnel /home/ai-tunnel/.ssh/authorized_keys
chmod 600 /home/ai-tunnel/.ssh/authorized_keys
echo "ai-tunnel may forward to 127.0.0.1:8790 from $FROM"
