FROM node:20-alpine as deps
WORKDIR /app
COPY ./package.json ./package.json
COPY ./package-lock.json ./package-lock.json

RUN npm ci

FROM node:20-alpine as builder
WORKDIR /app
COPY . .

COPY --from=deps /app/node_modules ./node_modules

RUN npm run build

FROM node:20-alpine as runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["npm", "run", "start"]
