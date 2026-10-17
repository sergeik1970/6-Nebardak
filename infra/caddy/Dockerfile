FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

RUN addgroup -S -g 10001 caddy \
    && adduser -S -D -h /home/caddy -s /sbin/nologin -u 10001 -G caddy caddy \
    && install -d -o caddy -g caddy -m 0750 /home/caddy /data /config \
    && chown -R caddy:caddy /data /config \
    && chmod -R u=rwX,g=rX,o= /data /config

ENV HOME=/home/caddy

USER 10001:10001
