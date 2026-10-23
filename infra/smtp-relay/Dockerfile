# Narrow egress for SMTP: Nest stays on internal-only networks and reaches the
# mail provider through this TCP pass-through. TLS runs end to end between
# Nest and the provider; the relay never sees plaintext or credentials.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

RUN apk add --no-cache socat

USER 10001:10001

# Blank SMTP_RELAY_UPSTREAM keeps the relay idle, so the stack runs without mail.
ENTRYPOINT ["/bin/sh", "-c", "if [ -z \"$SMTP_RELAY_UPSTREAM\" ]; then echo 'SMTP relay disabled: SMTP_RELAY_UPSTREAM is empty'; exec sleep 2147483647; fi; exec socat -d TCP-LISTEN:2465,fork,reuseaddr,max-children=16 \"TCP:$SMTP_RELAY_UPSTREAM,connect-timeout=10\""]
