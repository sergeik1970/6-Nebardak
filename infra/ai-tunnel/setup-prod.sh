#!/bin/bash
# Run on the production server as root (from the deploy user with sudo):
#   ssh deploy@62.113.60.95 'sudo bash -s' < infra/ai-tunnel/setup-prod.sh
# Creates the tunnel's key once and prints its public half, which goes to the
# relay server (infra/ai-relay/allow-tunnel.sh). The private key never leaves
# this server.
set -euo pipefail

DIR=/etc/stylefinder/ai-tunnel
# The relay server's host key, as verified from the owner's machine.
RELAY_HOST=89.208.107.138
RELAY_HOST_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAkzJlLd0I/TIWjjaSNRFPffF+Vst1hLw6jWnHglAWvL"

install -d -m 755 /etc/stylefinder
install -d -m 700 -o 10001 -g 10001 "$DIR"
if [ ! -f "$DIR/id_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N "" -C "stylefinder-ai-tunnel@$(hostname)" -f "$DIR/id_ed25519"
fi
echo "$RELAY_HOST $RELAY_HOST_KEY" > "$DIR/known_hosts"
chown 10001:10001 "$DIR/id_ed25519" "$DIR/id_ed25519.pub" "$DIR/known_hosts"
chmod 600 "$DIR/id_ed25519"
chmod 644 "$DIR/id_ed25519.pub" "$DIR/known_hosts"
cat "$DIR/id_ed25519.pub"
