# StyleFinder: безопасное развёртывание

Этот документ описывает production-контур из четырёх сервисов:

```text
Internet -> Caddy (:80/:443) -> Next (:3000, edge)
                              -> Nest (/api/*, :3001, api_internal)
                                      -> PostgreSQL (:5432, database_internal)
```

Порты `3000`, `3001` и `5432` наружу не публикуются. Сайт не зависит от
готовности API: при недоступном Nest страницы Next продолжают открываться, а
только запросы `/api/*` возвращают ошибку upstream.

Сети разделены по назначению: Next не видит БД, Caddy не видит БД, PostgreSQL
не подключён к edge-сети. Только Nest одновременно входит в API- и
database-сегменты.

`docker-compose.yml` является основным production-файлом.
`docker-compose.prod.yml` сохраняется как его явный эквивалент.
`docker-compose.dev.yml` поднимает только локальную PostgreSQL на
`127.0.0.1:5432`.

## 1. Что хранится вне Git и Docker image

Скопируйте единый server-шаблон и ограничьте доступ:

```bash
cp .env.server.example .env.server
chmod 600 .env.server
```

`.env.server` не входит в Git и не копируется в Docker image. Сгенерируйте три
разных пароля БД длиной не менее 16 символов. DB-пароли в шаблоне
намеренно пустые: Compose остановится до создания volume, пока вы их не заполните.
Production preflight также отклоняет старые placeholder-значения, одинаковые
пароли ролей и пароль, совпадающий с именем роли:

```env
SITE_ADDRESS=stylefinder.design
POSTGRES_DB=stylefinder
POSTGRES_ADMIN_USER=stylefinder_admin
POSTGRES_ADMIN_PASSWORD=REPLACE_WITH_LONG_RANDOM_ADMIN_PASSWORD
APP_DB_USER=stylefinder_app
APP_DB_PASSWORD=REPLACE_WITH_DIFFERENT_APP_PASSWORD
MIGRATOR_DB_USER=stylefinder_migrator
MIGRATOR_DB_PASSWORD=REPLACE_WITH_DIFFERENT_MIGRATOR_PASSWORD
PUBLIC_ORIGIN=https://stylefinder.design
AUTH_ENABLED=false
AUTH_REGISTRATION_ENABLED=false
```

Аккаунты используют серверные сессии: браузер получает случайный токен только в
cookie `__Host-sf_session` (`HttpOnly; Secure; SameSite=Lax`), а в таблице
`user_session` хранится лишь его SHA-256. Подписывающего секрета нет. При
`AUTH_ENABLED=true` обязателен `PUBLIC_ORIGIN` — точный https-origin сайта; API
отклоняет изменяющие запросы с другим `Origin` или без заголовка
`X-Requested-With: stylefinder`.

Письма подтверждения почты и сброса пароля уходят через SMTP-релей. При
`AUTH_ENABLED=true` обязательны `SMTP_HOST` и `SMTP_FROM` (например,
`StyleFinder <contact@stylefinder.online>`); `SMTP_USER`/`SMTP_PASSWORD`
задаются парой. На порту 465 используется TLS сразу (`SMTP_SECURE=true`), на
587 production требует STARTTLS. До включения аккаунтов у домена отправителя
должны быть SPF, DKIM и DMARC, выданные провайдером (Yandex Cloud Postbox,
Unisender Go и т. п.), иначе письма попадут в спам. Зарубежный сервис получает
адреса пользователей — это трансграничная передача по 152-ФЗ со своим
уведомлением, поэтому предпочтителен российский. В логах фиксируются только
`userId` и коды событий — без адресов и ссылок.

У Nest нет выхода в интернет (сети `internal`), поэтому SMTP идёт через
сервис `smtp-relay`: он пробрасывает TCP только на `SMTP_RELAY_UPSTREAM`, а TLS
устанавливается между Nest и провайдером напрямую. Для reg.ru:
`SMTP_RELAY_UPSTREAM=mail.hosting.reg.ru:465`, `SMTP_HOST=smtp-relay`,
`SMTP_PORT=2465`, `SMTP_SECURE=true`,
`SMTP_TLS_SERVERNAME=mail.hosting.reg.ru`. Пустой `SMTP_RELAY_UPSTREAM`
оставляет релей в режиме ожидания.

Полный порядок запуска по шагам — в [`docs/launch-checklist.md`](docs/launch-checklist.md).

Перед включением регистрации (152-ФЗ):

- заполнить реквизиты оператора в `next/src/shared/legal/operator.ts`; пока там
  есть значения в квадратных скобках, `/privacy` и `/consent` показывают плашку
  «Черновик»;
- согласовать тексты `/privacy` и `/consent` с юристом; при любом изменении
  текста согласия поднять `CURRENT_CONSENT_VERSION` одновременно в
  `nest/src/legal/consent.ts` и `next/src/shared/legal/consent.ts` (тест сверяет их);
- подать уведомление об обработке персональных данных в Роскомнадзор;
- разместить сервер, базу и резервные копии в РФ.

### Администратор

Роль `admin` не выдаётся из интерфейса. Её назначает one-off сервис `migrate`
(у него права владельца таблиц). Если аккаунта ещё нет (регистрация
выключена), создайте его сразу администратором — пароль спрашивается без
эха, в историю терминала он не попадает (без `-T`, нужен терминал):

```bash
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm migrate \
    npm run admin:create:prod -- --email you@example.com --name "Имя"
```

Существующему аккаунту роль выдаёт:

```bash
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm -T migrate \
    npm run admin:grant:prod -- --email you@example.com </dev/null
```

Скрипты печатают только `ADMIN_ACCOUNT_CREATED userId=…` /
`ADMIN_ROLE_GRANTED userId=…`; второй завершает все сессии аккаунта. Вход администратора идёт в два шага: пароль, затем шестизначный код
из письма (живёт 10 минут, 5 попыток, новый вход отменяет прежний код). Без
кода сессия не создаётся; если письмо не ушло, вход отвечает 503. Сессия
администратора короче обычной: 7 дней без активности и не дольше 30 дней.
Ссылка сброса пароля администратора меняет пароль, но не открывает сессию —
после неё нужен обычный вход с кодом. Закрытые API (`/api/admin/*`) принимают
только сессию, прошедшую код.

Раз в 6 часов API удаляет истёкшие сессии, использованные ссылки и коды входа,
неподтверждённые аккаунты (кроме admin), у которых 30 дней не было активности.
Это касается только аккаунтов, зарегистрированных с согласием на обработку
данных; аккаунты, созданные до этого релиза, задача не трогает.

PostgreSQL получает только admin-переменные. One-off сервис
`db-roles` создаёт отдельного владельца миграций и runtime-роль без права менять
схему. Сервис `nest` получает только runtime-реквизиты, `migrate` — только
миграционные. Runtime-роль получает DML для таблиц `user`, `user_session`, `email_token`, `login_challenge`, `trusted_device` и `project`, `SELECT`, `INSERT`
и `UPDATE` для `planner_observations` и `USAGE` только для `user_id_seq` и
`planner_observations_id_seq`; доступ к migration history, созданию временных объектов
и остальным sequence отсутствует. Все роли должны иметь разные имена и пароли.

Если база уже существует, `POSTGRES_ADMIN_USER` и
`POSTGRES_ADMIN_PASSWORD` при первом переходе должны совпадать с владельцем
существующего кластера: переменные Docker не переименуют роль внутри готового
volume. До запуска `db-roles` сделайте проверенный dump. Команда переносит
владение существующими таблицами и sequence на миграционную роль, поэтому этот
переход сначала репетируется на восстановленной копии базы. Для проверки именно
server-конфига укажите `STYLEFINDER_ENV_FILE=/path/to/.env.server`; без этой
переменной verification-скрипт намеренно создаёт отдельный временный volume с
эфемерными test-only credentials. После успешной проверки пароли можно ротировать
отдельной операцией.

Публичные переменные Next также находятся в `.env.server` и передаются только
на этапе сборки:

```env
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_AUTH_ENABLED=false
NEXT_PUBLIC_AUTH_REGISTRATION_ENABLED=false
NEXT_PUBLIC_BETA_BADGE_ENABLED=true
NEXT_PUBLIC_YM_COUNTER_ID=113737739
```

`NEXT_PUBLIC_YM_COUNTER_ID` — счётчик Яндекс Метрики. Без переменной compose
подставляет счётчик stylefinder.online; пустое значение собирает сайт без
аналитики и без cookie-баннера. Метрика загружается только после согласия
посетителя, а её домены разрешены в CSP (`infra/Caddyfile`).

`NEXT_PUBLIC_AUTH_REGISTRATION_ENABLED` действует только вместе с
`NEXT_PUBLIC_AUTH_ENABLED`. Для login-only режима включите первый auth-флаг и
оставьте registration-флаг выключенным. Серверные `AUTH_ENABLED` и
`AUTH_REGISTRATION_ENABLED` должны соответствовать опубликованному UI.

Не помещайте в переменные с префиксом `NEXT_PUBLIC_` секреты: браузер всё равно
сможет их прочитать.

## 2. DNS и HTTPS

Для production создайте у регистратора:

- `A`-запись корня домена на IPv4 сервера;
- `AAAA` только если сервер действительно принимает IPv6;
- при необходимости `CNAME www -> stylefinder.design` и отдельный адрес в
  Caddyfile.

Проверьте DNS до запуска:

```bash
dig +short A stylefinder.design
```

При `SITE_ADDRESS=stylefinder.design` Caddy самостоятельно получает сертификат,
слушает `80/443` и перенаправляет HTTP на HTTPS. Данные ACME сохраняются в
именованном volume `caddy_data`; volume нельзя удалять при обычном обновлении.

Для временного IP-only стенда допустимо:

```env
SITE_ADDRESS=:80
```

Такой стенд доступен только по HTTP и не считается production. Не вводите на нём
пароли или персональные данные.

## 3. Первый запуск

Сначала проверьте итоговую конфигурацию без вывода секретов в терминал общего
доступа:

```bash
docker compose --env-file .env.server -f docker-compose.yml config --quiet
docker compose --env-file .env.server -f docker-compose.yml --profile tools build caddy next nest smtp-relay migrate
docker compose --env-file .env.server -f docker-compose.yml up -d db
```

Сначала создайте/обновите раздельные роли, затем выполните миграции отдельной
ролью. Эти действия не запускаются при обычном старте:

```bash
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm db-roles
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm migrate
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm db-roles
docker compose --env-file .env.server -f docker-compose.yml up -d --no-build --remove-orphans
```

Повторный `db-roles` после миграций обязателен: он выдаёт runtime-роли права на
новые прикладные таблицы, но оставляет закрытой служебную таблицу TypeORM
`migrations`. Default privileges намеренно не выдают приложению доступ ко всем
будущим объектам схемы.

Для уже работающего сервера сначала остановите запись в базу или включите окно
обслуживания, сделайте dump по разделу 5 и проверьте восстановление на отдельном
volume. Только затем запускайте `db-roles` и `migrate`. Не подменяйте этот шаг
ручным `synchronize`: production-схема меняется исключительно миграциями.

Проверка:

```bash
docker compose --env-file .env.server -f docker-compose.yml ps
docker compose --env-file .env.server -f docker-compose.yml logs --tail=100 caddy next nest db
curl -fsS https://stylefinder.design/
curl -fsS https://stylefinder.design/api/health/live
curl -fsS https://stylefinder.design/api/health/ready
```

Временная IP-only проверка:

```bash
curl -fsS http://SERVER_IP/
curl -fsS http://SERVER_IP/api/health/live
curl -fsS http://SERVER_IP/api/health/ready
```

Проверка закрытых портов выполняется с другой машины:

```bash
nc -vz SERVER_IP 3001
nc -vz SERVER_IP 5432
```

Оба соединения должны завершиться отказом или timeout.

## 4. Обычное обновление

Не разворачивайте непроверенную рабочую копию. Зафиксируйте SHA текущего релиза
как точку возврата и сделайте backup до миграций:

```bash
PREVIOUS_RELEASE_SHA="$(git rev-parse HEAD)"
printf 'Previous release: %s\n' "$PREVIOUS_RELEASE_SHA"
docker compose --env-file .env.server -f docker-compose.yml ps
```

После получения проверенного коммита:

```bash
git pull --ff-only
FAILED_RELEASE_SHA="$(git rev-parse HEAD)"
printf 'Candidate release: %s\n' "$FAILED_RELEASE_SHA"
docker compose --env-file .env.server -f docker-compose.yml config --quiet
docker compose --env-file .env.server -f docker-compose.yml --profile tools build caddy next nest smtp-relay migrate
docker compose --env-file .env.server -f docker-compose.yml up -d db
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm db-roles
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm migrate
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm db-roles
docker compose --env-file .env.server -f docker-compose.yml up -d --no-build --remove-orphans
docker compose --env-file .env.server -f docker-compose.yml ps
```

Затем повторите HTTP-проверки и просмотрите свежие логи. В compose включена
ротация Docker JSON-логов: максимум пять файлов по 10 МБ на production-сервис.

## 5. Backup и проверка восстановления

Создайте каталог, недоступный обычным пользователям:

```bash
set -o pipefail
sudo install -d -m 700 /var/backups/stylefinder
BACKUP_FILE="/var/backups/stylefinder/stylefinder-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env.server -f docker-compose.yml exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' | sudo tee "$BACKUP_FILE" >/dev/null
sudo chmod 600 "$BACKUP_FILE"
```

Проверьте, что dump читается (команда использует тот же PostgreSQL image):

```bash
sudo test -s "$BACKUP_FILE"
sudo docker run --rm \
  -v /var/backups/stylefinder:/backup:ro \
  postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea \
  pg_restore --list "/backup/$(basename "$BACKUP_FILE")" | head
```

Сам файл на том же VPS не является backup. Ежедневную внешнюю копию делает
`infra/backup/backup.sh` по systemd-таймеру:

1. `pg_dump -Fc` из контейнера `db` и проверка `pg_restore --list`;
2. шифрование [age](https://github.com/FiloSottile/age) на публичный ключ:
   приватный ключ на сервере не хранится;
3. загрузка в S3-совместимое хранилище в РФ ключом, который может только
   загружать: прочитать или удалить копии с сервера нельзя;
4. сигнал в Healthchecks.io: `/start`, затем успех или `/fail` с номером строки.

Копии лежат в `daily/`. Lifecycle-правило bucket удаляет любую копию через 30
дней — этот срок указан в политике обработки персональных данных
(`next/src/shared/legal/operator.ts`), меняйте их вместе.

### 5.1. Подготовка (один раз)

На своей машине, не на сервере, создайте ключ шифрования:

```bash
age-keygen -o stylefinder-backup.key   # строка "Public key: age1..." — публичный ключ
```

Храните `stylefinder-backup.key` в менеджере паролей и в офлайн-копии. Без него
backup не расшифровать.

В хранилище (Yandex Object Storage или Selectel S3):

- приватный bucket, например `stylefinder-backups`;
- lifecycle-правило: удалять объекты через 30 дней;
- ключ для сервера только с правом загрузки в этот bucket (в Yandex Cloud —
  сервисный аккаунт с ролью `storage.uploader` на bucket);
- отдельный ключ только на чтение для restore drill, на сервер его не класть.

В Healthchecks.io создайте три проверки:

| Проверка | Период | Grace |
| --- | --- | --- |
| `stylefinder-backup` | 1 день | 2 часа |
| `stylefinder-resources` | 10 минут | 20 минут |
| `stylefinder-restore-drill` | 31 день | 3 дня |

### 5.2. Установка на сервере

```bash
sudo apt-get install -y age curl
sudo install -d -m 700 /etc/stylefinder
sudo install -m 600 infra/backup/backup.env.example /etc/stylefinder/backup.env
sudoedit /etc/stylefinder/backup.env   # APP_DIR, AGE_RECIPIENT, S3_*, HC_*
sudo install -m 644 infra/backup/systemd/*.service infra/backup/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start stylefinder-backup.service
sudo journalctl -u stylefinder-backup.service -n 20   # ожидается "uploaded stylefinder-....dump.age"
sudo systemctl enable --now stylefinder-backup.timer stylefinder-resource-check.timer
```

Unit-файлы запускают скрипты из `/srv/stylefinder`. Если checkout лежит в
другом каталоге, исправьте `ExecStart` и `APP_DIR`.

### 5.3. Проверка восстановления

Минимум раз в месяц и обязательно до включения аккаунтов восстанавливайте
свежую копию на отдельной машине с Docker (не на production-сервере):

```bash
mkdir -p ~/.config/stylefinder
cat > ~/.config/stylefinder/drill.env <<'EOF'
AGE_IDENTITY=/path/to/stylefinder-backup.key
S3_ENDPOINT=https://storage.yandexcloud.net
S3_REGION=ru-central1
S3_BUCKET=stylefinder-backups
S3_ACCESS_KEY_ID=...        # ключ только на чтение
S3_SECRET_ACCESS_KEY=...
HC_DRILL_PING_URL=https://hc-ping.com/...
EOF
chmod 600 ~/.config/stylefinder/drill.env
bash infra/backup/restore-drill.sh
```

Скрипт скачивает последнюю копию из `daily/`, расшифровывает её и
восстанавливает в одноразовый PostgreSQL-контейнер без сети. Затем проверяет
таблицу `migrations` и печатает число строк в каждой таблице. Последняя строка
`restore drill OK <дата> source=… migrations=N` — это запись о проверке:
добавьте её в журнал релизов. Непроверенный backup нельзя считать рабочим.

## 6. Rollback

Не начинайте rollback, пока не определены `PREVIOUS_RELEASE_SHA` и SHA
неудачного релиза. Сначала остановите запись и сделайте ещё один dump: он нужен
даже при наличии pre-deploy backup.

Если старое приложение совместимо с уже применённой схемой, миграцию не
откатывайте. Верните код и обязательно пересоберите также migrator, чтобы
следующий запуск не использовал образ от другого коммита:

```bash
git checkout "$PREVIOUS_RELEASE_SHA"
docker compose --env-file .env.server -f docker-compose.yml --profile tools build caddy next nest smtp-relay migrate
docker compose --env-file .env.server -f docker-compose.yml up -d --no-build --remove-orphans
```

Если старое приложение несовместимо с новой схемой, а `down`-операция миграции
явно обратима и уже проверена на копии базы, откатите миграцию **до** `git
checkout`. В этот момент локальный `migrate` image ещё обязан соответствовать
неудачному релизу, который эту миграцию применил:

```bash
test "$(git rev-parse HEAD)" = "$FAILED_RELEASE_SHA"
docker compose --env-file .env.server -f docker-compose.yml --profile tools run --rm --no-deps migrate npm run typeorm:revert-migration:prod
git checkout "$PREVIOUS_RELEASE_SHA"
docker compose --env-file .env.server -f docker-compose.yml --profile tools build caddy next nest smtp-relay migrate
docker compose --env-file .env.server -f docker-compose.yml up -d --no-build --remove-orphans
```

После возврата повторите readiness, HTTP-smoke и проверку закрытых портов. Если
миграция необратима или image неудачного релиза уже потерян, не пытайтесь
запускать `migration:revert` из старого checkout: восстановите проверенный
pre-deploy dump по отдельному runbook релиза. Не удаляйте volumes командами
`down -v` или `volume rm` во время rollback.

## 7. SSH и firewall

Ранее переданный общий root-пароль необходимо сменить. Для каждого человека
используйте собственный SSH-ключ и отдельную учётную запись; это позволяет
отозвать один доступ, не меняя остальные.

На сервере создайте deploy-пользователя:

```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo install -m 600 -o deploy -g deploy /dev/null /home/deploy/.ssh/authorized_keys
```

Добавьте публичный ключ в `authorized_keys`. Не добавляйте пользователя в группу
`docker` без необходимости: членство в ней практически эквивалентно root.
Используйте `sudo docker compose ...`.

Проверьте вход по ключу в отдельном терминале. Только после успешной проверки
создайте `/etc/ssh/sshd_config.d/99-stylefinder-hardening.conf`:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

Перед применением:

```bash
sudo sshd -t
sudo systemctl reload ssh
```

Не закрывайте действующую root-сессию, пока новый вход не проверен.

Firewall:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

Установите fail2ban, включите unattended security updates и регулярно проверяйте
необходимость перезагрузки:

```bash
sudo apt update
sudo apt install fail2ban unattended-upgrades
sudo systemctl enable --now fail2ban unattended-upgrades
test -f /var/run/reboot-required && cat /var/run/reboot-required
```

## 8. Наблюдаемость и текущие ограничения

Перед любым публичным релизом отдельно выполните обязательный реестр прав:

```bash
cd next
npm run assets:rights:release
```

Команда сверяет все файлы `public/images` с
`image-rights.manifest.json`, проверяет количество и общий SHA-256 каждого
набора и завершится ошибкой, пока у любого набора остаётся
`rightsStatus: "unverified"` или отсутствует стабильная `https://`-ссылка на
письменное подтверждение (либо внутренний идентификатор вида `record:...`).
Обычный CI запускает `assets:rights:inventory`: он защищает реестр от тихого
добавления или замены файлов, но не выдаёт разрешение на публикацию.

Минимальные проверки production:

- UptimeRobot, HTTP(S)-мониторы с интервалом 5 минут на
  `https://stylefinder.design/`, `/api/health/live` и `/api/health/ready`
  (для ready — keyword `"ok"`); у монитора `/` включить SSL-оповещение об
  истечении сертификата;
- диск (`/`, `/var/lib/docker` от 80 %) и доступная память (меньше 10 %):
  `infra/backup/resource-check.sh` каждые 10 минут, проверка
  `stylefinder-resources` в Healthchecks.io (§5.1);
- свежесть off-site backup: проверка `stylefinder-backup` поднимает тревогу,
  если за сутки не было успешной загрузки;
- ежемесячный restore drill: проверка `stylefinder-restore-drill`;
- сбор ошибок браузера и API без паролей и токенов.

Те же проверки и состояние контейнеров выполняет Telegram-бот на отдельном
сервере: `infra/monitor-bot/README.md`.

Оповещения UptimeRobot и Healthchecks.io направьте на почту или в Telegram
владельца. Эти сервисы получают только адреса проверок и тексты сигналов, без
персональных данных пользователей.

`/api/health/live` подтверждает, что процесс отвечает. `/api/health/ready`
дополнительно выполняет безопасный `SELECT 1` и подтверждает доступность
PostgreSQL. Docker healthcheck использует readiness, а внешний uptime-monitor
должен проверять оба маршрута отдельно.

Контейнеры Next, Nest и миграций запускаются от пользователя `node`, без Linux
capabilities и с `no-new-privileges`. Тонкий образ Caddy наследует закреплённый
`caddy:2.11.7-alpine` по digest, но заменяет бинарник на тот же релиз Caddy,
пересобранный через `xcaddy` на Go 1.26.10 с `golang.org/x/net` v0.60.0: в
upstream-образе остаются CVE-2026-78667, CVE-2026-78669 и CVE-2026-97031.
Когда выйдет официальный образ с исправлениями, стадию `builder` нужно убрать.
Образ создаёт непривилегированного пользователя
`10001:10001` и заранее передаёт ему `/data` и `/config`. Поэтому новые именованные
volumes получают корректного владельца при первом подключении, а ACME-данные и
конфигурация остаются записываемыми без root. Compose удаляет все capabilities и
возвращает Caddy только `NET_BIND_SERVICE`, необходимую для контейнерных портов
`80/443`; host ports и автоматический HTTPS при доменном `SITE_ADDRESS` не
меняются. Runtime-образ Nest не содержит CLI-конфигурацию и файлы миграций: они
есть только в отдельном one-off target `migrator`. PostgreSQL требует
дополнительные права на инициализацию своего volume, поэтому его capabilities
нельзя сокращать без отдельного теста образа.

Текущий rate limiter хранит счётчики в памяти процесса Nest и рассчитан на
один экземпляр API. Перед горизонтальным масштабированием вынесите счётчики в
общий Redis-compatible storage, иначе каждый экземпляр будет применять лимит независимо.
Старые аккаунты с bcrypt cost ниже 12 не могут войти по паролю: такие хеши
намеренно не проверяются и не обновляются во время входа. Их владельцы входят
через «Забыли пароль?» (`/auth/forgot`) — сброс по письму задаёт новый хеш с
cost 12 и подтверждает почту. Сообщите им об этом до включения `AUTH_ENABLED`.

Перед включением аккаунтов прогоните `npm run test:e2e:accounts` в `next/`
(сквозные сценарии с настоящими API, PostgreSQL и Mailpit) и проверьте реальную
доставку писем выбранного SMTP-провайдера на нескольких почтовых сервисах.

## 9. Локальная разработка

```bash
docker compose -p stylefinder-dev -f docker-compose.dev.yml up -d
cd nest && npm run start:dev
cd next && npm run dev
```

Локальная база слушает только loopback-интерфейс. Dev-пароли из compose нельзя
использовать на сервере. `nest/.env` загружается только вне production; для
production Nest и мигратор принимают конфигурацию исключительно из окружения.
