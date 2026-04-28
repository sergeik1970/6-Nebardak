# Production Deploy

Рекомендуемая схема для VPS: Docker Compose + Caddy + PostgreSQL.

## Что нужно на сервере

- Ubuntu 24.04 LTS.
- Docker и Docker Compose plugin.
- Открытые порты `80` и `443`.
- DNS `A`-запись домена на публичный IP сервера.

## Настройка

1. Скопировать `.env.production.example` в `.env`.
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
6. Запустить:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Если `SITE_ADDRESS` указан как домен, Caddy автоматически выпустит и будет обновлять HTTPS-сертификат.

## Проверка

```bash
docker compose -f docker-compose.prod.yml --env-file .env ps
docker compose -f docker-compose.prod.yml --env-file .env logs -f caddy
```

После запуска сайт должен открываться по адресу из `SITE_ADDRESS`, API healthcheck — по `${NEXT_PUBLIC_API_URL}/health`.
