FROM node:22.23.1-alpine

WORKDIR /opt/ai-relay
COPY package.json ./
COPY src ./src

USER node
EXPOSE 8790
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8790/health || exit 1
CMD ["node", "src/index.js"]
