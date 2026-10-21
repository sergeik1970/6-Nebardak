# StyleFinder

StyleFinder — веб-приложение для теста визуальных предпочтений, поштучного
подбора мебели и проверки расстановки в прямоугольной комнате.

## Состав проекта

- `next/` — Next.js frontend: главная, тест, анкета и локальный планировщик;
- `nest/` — NestJS API: health endpoints и выключаемый контур авторизации;
- `infra/` — Caddy и подготовка least-privilege ролей PostgreSQL;
- `docker-compose.yml` — production-контур;
- `docker-compose.dev.yml` — только локальная PostgreSQL для разработки.

Актуальные требования находятся в
[`docs/stylefinder-remediation-spec.md`](docs/stylefinder-remediation-spec.md).
Production runbook — в [`DEPLOY.md`](DEPLOY.md).

## Локальный запуск

Нужны Node.js 22.23.1, npm и Docker. Контейнерный baseline зафиксирован на
PostgreSQL 16.15 (Alpine 3.24) и Caddy 2.11.7; обновление версий выполняется
отдельным проверяемым изменением, а не плавающим major-тегом.

```bash
docker compose -p stylefinder-dev -f docker-compose.dev.yml up -d
cp nest/.env.example nest/.env
cd nest
npm ci
npm run start:dev
```

API и TypeORM CLI загружают `nest/.env` нативным parser Node.js 22 до чтения
runtime-конфига. Уже заданные переменные процесса имеют приоритет; в
`NODE_ENV=production` dotenv-файл намеренно не читается.

Во втором терминале:

```bash
cp next/.env.example next/.env
cd next
npm ci
npm run dev
```

Frontend откроется на `http://localhost:3000`, API — на
`http://localhost:3001/api` (браузер ходит в него через `/api` на порту 3000).
Все письма локального API (подтверждение почты, сброс пароля) попадают в Mailpit:
`http://localhost:8025`. Значения из dev-файлов нельзя использовать на
сервере.

## Проверки

Frontend:

```bash
cd next
npm run lint
npm test
npx tsc --noEmit --incremental false
npm run build
npm run test:e2e            # Playwright на production-сборке, аккаунты выключены
npm run test:e2e:accounts   # сценарии с аккаунтами (нужен Docker, см. ниже)
```

`test:e2e:accounts` поднимает временные PostgreSQL 16 и Mailpit в Docker,
применяет миграции, запускает API и `next dev` с включёнными аккаунтами и
проходит сквозные сценарии: гость → регистрация → проект в аккаунте и на втором
устройстве; письмо подтверждения; сброс пароля с выходом на других устройствах;
офлайн-правка; две вкладки; конфликт двух устройств; чужой проект; удаление
аккаунта; проверки на телефоне. Порты 3200 и 3201 должны быть свободны.
Контейнеры удаляются после прогона.

Backend:

```bash
cd nest
npm run lint:check
npm test
npm run test:e2e
npm run test:db   # SQL-тесты проектов и очистки аккаунтов на временной PostgreSQL 16 (нужен Docker)
npm run build
```

Проверка миграций на чистой PostgreSQL, rollback/reapply и прав runtime-роли:

```bash
sh infra/postgres/verify-migrations.sh
```

Скрипт использует отдельный временный Compose project и удаляет только его
контейнеры и volume после проверки. Без `STYLEFINDER_ENV_FILE` он сам подставляет
три эфемерных test-only пароля вместо пустых значений шаблона; они действуют только
в этом изолированном проекте и не выводятся в лог. Для репетиции конкретного
server-конфига передайте путь явно: `STYLEFINDER_ENV_FILE=/path/to/.env.server sh
infra/postgres/verify-migrations.sh`. Production preflight требует не менее 16
символов и разные секреты для admin, migrator и runtime-ролей.

Сам fail-fast без подключения к базе проверяется отдельно:

```bash
sh infra/postgres/test-role-preflight.sh
```

## Незавершённые функции

Регистрация не комментируется в JSX и не публикуется по умолчанию. Она
управляется feature flags:

- `NEXT_PUBLIC_AUTH_ENABLED=false`;
- `NEXT_PUBLIC_AUTH_REGISTRATION_ENABLED=false`;
- `AUTH_ENABLED=false`;
- `AUTH_REGISTRATION_ENABLED=false`.

Клиентские и серверные флаги включаются согласованно. Если авторизация включена,
а регистрация выключена, интерфейс остаётся строго login-only. При выключенной
авторизации клиент очищает старую локальную сессию и не обращается к auth API.
Сессия — непрозрачный токен в HttpOnly-cookie, в БД хранится только его хеш.
Браузер обращается к API только через `/api` на том же origin: в production это
делает Caddy, локально — rewrite `next dev` на `API_PROXY_TARGET`. В production с
включённой авторизацией обязателен `PUBLIC_ORIGIN` (https).

Legacy Deals удалён из runtime и схемы прямой миграцией; исторические миграции
сохранены неизменными. Если коммерческий контур понадобится позже, он должен
появиться как новая функция со своей моделью и флагом, а не возвращением Deals.

Перед включением аккаунтов в production нужны: домен с HTTPS, SMTP-провайдер
с SPF/DKIM/DMARC, сервер и резервные копии в РФ, уведомление РКН и
проверенные юристом тексты `/privacy` и `/consent` — по шагам в
[`docs/launch-checklist.md`](docs/launch-checklist.md), технически в `DEPLOY.md`.
