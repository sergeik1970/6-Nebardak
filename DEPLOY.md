# Docker Compose Dev/Prod

В проекте используются:

- `docker-compose.dev.yml` — локальная dev-конфигурация.
- `docker-compose.prod.yml` — production-конфигурация.
- `docker-compose.yml` — такой же production compose по умолчанию, чтобы на сервере можно было писать просто `docker compose ...`.

## Env-файлы

- `nest/.env` — env для `nest` и `db`.
- `next/.env` — env для `next`.
- `nest/.env.example` и `next/.env.example` — шаблоны.

## Локальная разработка

```bash
cp nest/.env.example nest/.env
cp next/.env.example next/.env
docker compose -p nebardak-dev -f docker-compose.dev.yml up -d
```

`docker-compose.dev.yml` поднимает локальный PostgreSQL.

## Сервер

Скопировать env-файлы:

```bash
cp nest/.env.example nest/.env
cp next/.env.example next/.env
```

Заполнить `nest/.env`:

```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=nebardak
DB_PASSWORD=your_strong_password
DB_NAME=nebardak
JWT_SECRET=your_random_jwt_secret_min_32_chars
NODE_ENV=dev

POSTGRES_DB=nebardak
POSTGRES_USER=nebardak
POSTGRES_PASSWORD=your_strong_password
```

Заполнить `next/.env`:

```env
NEXT_PUBLIC_API_URL=http://SERVER_IP:3001/api
```

Сборка и запуск:

```bash
docker compose build next
docker compose build nest
docker compose up -d --no-build
```

Обновление после `git pull`:

```bash
git pull
docker compose build next
docker compose build nest
docker compose up -d --no-build
```

Проверка:

```bash
docker compose ps
docker compose logs -f next
docker compose logs -f nest
curl http://SERVER_IP:3001/api/health
```

## Что открывается снаружи

- сайт: `http://SERVER_IP`
- API: `http://SERVER_IP:3001/api`

В этой схеме `Caddy` не используется и автоматического HTTPS нет.
