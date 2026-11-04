# Посредник для запросов к ИИ

Gemini и OpenAI не принимают запросы из России, поэтому к ним ходит этот
маленький сервис на сервере в Амстердаме (`89.208.107.138`, там же бот
мониторинга). Ключ провайдера лежит только в его `.env`; тем, кто к нему
обращается, нужен лишь токен посредника.

- `GET /health` — без токена: `{ ok, provider, model }`.
- `POST /v1/vision` с `Authorization: Bearer <RELAY_TOKEN>`:
  `{ prompt, image: { mimeType: "image/png" | "image/jpeg" | "image/webp", base64 }, json? }`
  → `{ text, provider, model, ms }`. Ошибка провайдера приходит как 502 с его текстом.

Защита: порт открыт только на `127.0.0.1` сервера (снаружи — через SSH‑туннель),
токен сравнивается за постоянное время, не больше `RELAY_DAILY_LIMIT` запросов
в сутки (UTC) и двух одновременно, тело до 12 МБ. В журнал пишутся только
размер картинки и время, без текста запроса и без картинок.

Зависимостей нет: Node 22 и встроенный `fetch`. Тесты: `npm test`.

## Установка и обновление

С компьютера разработчика:

```sh
bash infra/ai-relay/deploy.sh
```

Скрипт копирует сервис в `/root/stylefinder-ai-relay`, при первом запуске
создаёт `.env` со случайным `RELAY_TOKEN` и запускает контейнер. Ключ провайдера
вписывается на сервере вручную:

```sh
ssh root@89.208.107.138
nano /root/stylefinder-ai-relay/.env    # AI_API_KEY=..., AI_MODEL=...
cd /root/stylefinder-ai-relay && docker compose up -d
```

## Обращение с компьютера

```sh
ssh -fN -L 8790:127.0.0.1:8790 root@89.208.107.138   # туннель, работает в фоне
curl -s http://127.0.0.1:8790/health
```

Замер распознавания планов (`next/`, `npm run plan-recognition:live`) берёт
токен из `~/.stylefinder-ai.env`:

```sh
ssh root@89.208.107.138 'grep ^RELAY_TOKEN= /root/stylefinder-ai-relay/.env' \
  | sed 's/^RELAY_TOKEN=/AI_RELAY_TOKEN=/' > ~/.stylefinder-ai.env
chmod 600 ~/.stylefinder-ai.env
```

Когда к посреднику пойдёт production, он будет ходить так же, через туннель или
по отдельному порту, открытому только для `62.113.60.95`.
