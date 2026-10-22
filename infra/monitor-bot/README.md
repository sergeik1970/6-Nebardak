# Монитор StyleFinder в Telegram

Отдельный бот на внешнем сервере (Амстердам, `89.208.107.138`). Он работает вне
production, поэтому сообщит и о падении самого сервера. Входящих портов не
открывает: команды получает через long polling Telegram, а состояние сервера
читает по SSH ключом, которому разрешена только одна read-only команда.

Что проверяется:

| Проверка                                              | Как часто | Алерт                                               |
| ----------------------------------------------------- | --------- | --------------------------------------------------- |
| `/`, `/api/health/live`, `/api/health/ready` (`"ok"`) | 60 с      | после 2 сбоев подряд; ответ дольше 3 с тоже сбой    |
| TLS `stylefinder.online`, `www`                       | 5 мин     | меньше 14 дней до истечения                         |
| Диск `/`, `/var/lib/docker`                           | 5 мин     | от 80 %                                             |
| Доступная память                                      | 5 мин     | меньше 10 %                                         |
| Контейнеры `caddy`, `next`, `nest`, `db`              | 5 мин     | не `running` или `unhealthy`                        |
| Бэкап                                                 | 5 мин     | успешного нет дольше 26 ч или последний запуск упал |
| Перезапуски контейнеров                               | 5 мин     | сразу: упал и поднят Docker или запущен заново      |

Проверки идут по сетке часов: HTTP в начале каждой минуты (hh:mm:00), остальное
ровно в hh:00:00, hh:05:00, … Интервал отсчитывается от часов, а не от конца
прошлой проверки, поэтому время не уползает; если проверка ещё не закончилась к
следующей отметке, эта отметка пропускается. В `/status` видно, сколько секунд
назад была самая старая проверка.

Бот пишет при сбое, раз в 6 ч, пока сбой длится, и при восстановлении (с
длительностью). Перезапуск контейнера ловится по времени его старта, поэтому
бот заметит и падение, после которого Docker поднял контейнер между проверками.

Каждый день в 09:00 (`DAILY_REPORT_TIME`) приходит сводка: доступность и
скорость каждого адреса, сбои, перезапуски, диск, память, бэкап и сертификаты.
Счётчики хранятся в памяти, поэтому после перезапуска бота первая сводка
охватывает время с его старта.

Команды: `/status` проверяет всё сразу и присылает состояние, `/report`
показывает сводку с последнего отчёта, `/help` показывает справку. Сообщения
из других чатов бот игнорирует.

Зависимостей нет: Node 22, встроенный `fetch`, Bot API напрямую. Тесты:
`npm test`.

## 1. Бот в Telegram

1. В @BotFather: `/newbot`, получить токен.
2. Написать новому боту любое сообщение, затем узнать свой chat id:
   `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"` → `message.chat.id`.

## 2. Доступ к production (`62.113.60.95`)

Ключ генерируется на мониторе и на prod попадает только публичной частью:

```sh
# на мониторе
install -d -m 700 /root/stylefinder-monitor/config
ssh-keygen -t ed25519 -N "" -C stylefinder-monitor -f /root/stylefinder-monitor/config/prod_ssh_key
chown 1000:1000 /root/stylefinder-monitor/config/prod_ssh_key
```

На production (от `deploy` через sudo):

```sh
sudo useradd --system --create-home --shell /bin/sh stylefinder-monitor
sudo install -m 755 -o root -g root infra/monitor-bot/prod/stylefinder-status /usr/local/bin/stylefinder-status
echo 'stylefinder-monitor ALL=(root) NOPASSWD: /usr/local/bin/stylefinder-status' |
    sudo tee /etc/sudoers.d/stylefinder-monitor >/dev/null
sudo chmod 440 /etc/sudoers.d/stylefinder-monitor && sudo visudo -c
sudo install -d -m 700 -o stylefinder-monitor -g stylefinder-monitor ~stylefinder-monitor/.ssh
echo 'restrict,from="89.208.107.138",command="sudo -n /usr/local/bin/stylefinder-status" <ПУБЛИЧНЫЙ КЛЮЧ>' |
    sudo tee ~stylefinder-monitor/.ssh/authorized_keys >/dev/null
sudo chown stylefinder-monitor: ~stylefinder-monitor/.ssh/authorized_keys
sudo chmod 600 ~stylefinder-monitor/.ssh/authorized_keys
```

Если в `sshd_config` есть `AllowUsers`, добавьте туда `stylefinder-monitor`.
Ключ ограничен: вход только с IP монитора, без shell, PTY и проброса портов,
выполняется только `stylefinder-status`. Скрипт выводит проценты диска и
памяти, статусы контейнеров и время последнего бэкапа, без секретов и данных
пользователей.

Отметку `/var/lib/stylefinder-backup/last-success` пишет `infra/backup/backup.sh`.
Пока после обновления скрипта не прошёл ни один бэкап, бот сообщит «нет отметки
об успешном бэкапе». Чтобы этого не ждать, запустите бэкап вручную:
`sudo systemctl start stylefinder-backup.service`.

## 3. Запуск на мониторе

```sh
# с рабочей машины
rsync -a --exclude .env --exclude 'config/prod_ssh_key*' --exclude config/known_hosts \
    infra/monitor-bot/ root@89.208.107.138:/root/stylefinder-monitor/

# на мониторе
cd /root/stylefinder-monitor
cp .env.example .env && chmod 600 .env   # вписать TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID
ssh-keyscan -t ed25519 62.113.60.95 > config/known_hosts   # сверить отпечаток с известным
docker compose up -d --build
docker compose logs -f
```

После запуска бот пишет «Мониторинг StyleFinder запущен». Проверьте `/status`.

Кто проверяет сам монитор: создайте проверку в Healthchecks.io с периодом
2 мин и укажите её адрес в `HC_PING_URL`. Бот пингует её после каждого цикла,
и если он сам или амстердамский сервер упадёт, Healthchecks.io пришлёт письмо.

Обновление: повторить `rsync` и `docker compose up -d --build`. Если менялся
`prod/stylefinder-status`, переустановите его на production:

```sh
sudo bash -c 'cd /root/6-Nebardak && git pull --ff-only origin main &&
    install -m 755 -o root -g root infra/monitor-bot/prod/stylefinder-status /usr/local/bin/stylefinder-status'
```
