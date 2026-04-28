# Production Deploy

Рекомендуемая схема для VPS: Docker Compose + Caddy + PostgreSQL.

## Структура env

- Корневой `.env` — единственный env для сервера и `docker compose`.
- `nest/.env` — только для локальной разработки Nest.
- `next/.env.local` — только для локальной разработки Next.

### Локальная разработка

```bash
cp nest/.env.example nest/.env
cp next/.env.example next/.env.local
```

### Сервер

```bash
cp .env.example .env
```

## Что нужно на сервере

- Ubuntu 24.04 LTS.
- Docker и Docker Compose plugin.
- Открытые порты `80` и `443`.
- DNS `A`-запись домена на публичный IP сервера.

## Настройка сервера

1. Скопировать `.env.example` в `.env`.
2. Заменить `SITE_ADDRESS`, `NEXT_PUBLIC_API_URL`, `LETSENCRYPT_EMAIL`, `DB_PASSWORD`, `JWT_SECRET`.
3. Для запуска по IP указать:

```env
SITE_ADDRESS=http://SERVER_IP
NEXT_PUBLIC_API_URL=http://SERVER_IP/api
```

4. Для запуска с доменом указать:

```env
SITE_ADDRESS=example.com
NEXT_PUBLIC_API_URL=https://example.com/api
```

5. Если используется домен, убедиться, что DNS уже указывает на IP сервера.
6. Собрать сервисы:

```bash
docker compose -p nebardak -f docker-compose.prod.yml --env-file .env build next nest
```

7. Поднять стек без повторной сборки:

```bash
docker compose -p nebardak -f docker-compose.prod.yml --env-file .env up -d --no-build
```

Если `SITE_ADDRESS` указан как домен, Caddy автоматически выпустит и будет обновлять HTTPS-сертификат.

## Обновление после git pull

```bash
git pull
docker compose -p nebardak -f docker-compose.prod.yml --env-file .env build next nest
docker compose -p nebardak -f docker-compose.prod.yml --env-file .env up -d --no-build
```

## Короткие команды через Makefile

```bash
make prod-build
make prod-up
make prod-ps
make prod-logs
```

`make prod-rebuild` выполнит сборку и затем `up -d --no-build`.

## Проверка

```bash
docker compose -p nebardak -f docker-compose.prod.yml --env-file .env ps
docker compose -p nebardak -f docker-compose.prod.yml --env-file .env logs -f caddy
```

После запуска сайт должен открываться по адресу из `SITE_ADDRESS`, API healthcheck — по `${NEXT_PUBLIC_API_URL}/health`.
