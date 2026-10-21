# Upstream caddy:2.11.7 ships a binary built with Go 1.26.8 and
# golang.org/x/net v0.59.0 (CVE-2026-78667, CVE-2026-78669, CVE-2026-97031);
# Go 1.26.10 also fixes CVE-2026-111943 in crypto/x509.
# Rebuild the same Caddy release with patched toolchain and x/net until an
# upstream image includes the fixes, then drop this stage.
FROM golang:1.26.10-alpine3.23@sha256:a07f231c19b03e6106cf442f02a5bcf262147e744d15b7b5e4b6d81d420c70a0 AS builder

ENV CGO_ENABLED=0 \
    GOTOOLCHAIN=local

RUN apk add --no-cache git \
    && go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7

RUN xcaddy build v2.11.7 \
        --output /usr/bin/caddy \
        --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
    && /usr/bin/caddy version

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# COPY drops file capabilities; restore the one upstream sets so the
# non-root user can still bind 80/443.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \
    && addgroup -S -g 10001 caddy \
    && adduser -S -D -h /home/caddy -s /sbin/nologin -u 10001 -G caddy caddy \
    && install -d -o caddy -g caddy -m 0750 /home/caddy /data /config \
    && chown -R caddy:caddy /data /config \
    && chmod -R u=rwX,g=rX,o= /data /config

ENV HOME=/home/caddy

USER 10001:10001
