#!/bin/sh
# Blank AI_TUNNEL_TARGET keeps the tunnel idle, so the stack runs without AI.
set -eu

if [ -z "${AI_TUNNEL_TARGET:-}" ]; then
    echo "AI tunnel disabled: AI_TUNNEL_TARGET is empty"
    exec sleep 2147483647
fi
for file in /keys/id_ed25519 /keys/known_hosts; do
    if [ ! -r "$file" ]; then
        echo "AI tunnel: $file is missing or unreadable (see infra/ai-tunnel/README.md)" >&2
        exec sleep 2147483647
    fi
done

# autossh restarts ssh whenever the link drops; the server-alive probes notice a
# dead link within ~90 s, and a forward that cannot bind is a hard failure.
export AUTOSSH_GATETIME=0
exec autossh -M 0 -N \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -i /keys/id_ed25519 \
    -o UserKnownHostsFile=/keys/known_hosts \
    -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -L 0.0.0.0:8790:127.0.0.1:8790 \
    "$AI_TUNNEL_TARGET"
