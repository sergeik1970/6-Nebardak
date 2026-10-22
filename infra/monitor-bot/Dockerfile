FROM node:22.23.1-alpine

RUN apk add --no-cache openssh-client

WORKDIR /opt/monitor
COPY package.json ./
COPY src ./src

USER node
CMD ["node", "src/index.js"]
