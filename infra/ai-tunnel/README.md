# Туннель к посреднику ИИ

Production‑API (`nest`) живёт во внутренних сетях без выхода в интернет. До
посредника ИИ (`infra/ai-relay`, сервер в Амстердаме) он доходит через этот
контейнер: `nest` обращается к `http://ai-tunnel:8790`, контейнер держит
SSH‑туннель на `127.0.0.1:8790` сервера посредника и сам переподключается при
обрывах (`autossh`).

Пока `AI_TUNNEL_TARGET` пуст, контейнер спит и никуда не подключается.

Ключ создаётся на production‑сервере и его не покидает. На сервере посредника
ему разрешено только одно: пробросить порт `127.0.0.1:8790` и только с адреса
`62.113.60.95`; оболочки у пользователя нет. Ключ сервера посредника записан в
`setup-prod.sh` заранее, а не принимается при первом подключении.

## Настройка (один раз)

С компьютера разработчика, из корня репозитория:

```sh
PUB=$(ssh deploy@62.113.60.95 'sudo bash -s' < infra/ai-tunnel/setup-prod.sh) \
  && ssh root@89.208.107.138 'bash -s' -- "$PUB" < infra/ai-relay/allow-tunnel.sh
```

Первая команда создаёт на production `/etc/stylefinder/ai-tunnel/` (ключ,
владелец 10001, права 600, и `known_hosts`) и печатает открытый ключ; вторая
заводит на сервере посредника пользователя `ai-tunnel` с этим ключом.

Затем в `.env.server` на production:

```env
AI_TUNNEL_TARGET=ai-tunnel@89.208.107.138
AI_TUNNEL_KEYS=/etc/stylefinder/ai-tunnel
AI_RELAY_URL=http://ai-tunnel:8790
AI_RELAY_TOKEN=<RELAY_TOKEN из /root/stylefinder-ai-relay/.env посредника>
```

и пересоздать `ai-tunnel` и `nest`. Проверка с production:

```sh
docker compose exec nest wget -qO- http://ai-tunnel:8790/health
```

Распознавание включается отдельно (`PLAN_RECOGNITION_ENABLED=true` и
`NEXT_PUBLIC_PLAN_UPLOAD_ENABLED=true` с пересборкой `next`) и только после того,
как согласие на передачу изображения плана за рубеж закреплено в политике
конфиденциальности.

## Отключение

Очистить `AI_TUNNEL_TARGET` и пересоздать контейнер; доступ закрывается и на
стороне посредника: `userdel -r ai-tunnel` на `89.208.107.138`.
