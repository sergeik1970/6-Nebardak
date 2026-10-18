FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

RUN addgroup -S -g 10001 caddy \
    && adduser -S -D -h /home/caddy -s /sbin/nologin -u 10001 -G caddy caddy \
    && install -d -o caddy -g caddy -m 0750 /home/caddy /data /config \
    && chown -R caddy:caddy /data /config \
    && chmod -R u=rwX,g=rX,o= /data /config

ENV HOME=/home/caddy

USER 10001:10001
