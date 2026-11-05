# The production API reaches the AI relay (infra/ai-relay) on the Amsterdam
# server through this SSH tunnel: Nest stays on internal-only networks and
# talks to ai-tunnel:8790, which forwards to the relay's localhost port. The
# key is generated on the production server and allows nothing but that port.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

RUN apk add --no-cache openssh-client autossh \
    # ssh refuses to run as a uid with no passwd entry.
    && adduser -D -H -u 10001 -s /sbin/nologin tunnel

COPY tunnel.sh /usr/local/bin/ai-tunnel
RUN chmod 555 /usr/local/bin/ai-tunnel

USER 10001:10001

ENTRYPOINT ["/usr/local/bin/ai-tunnel"]
