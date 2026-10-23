import { AlertState } from "./alerts.js";
import { checkHttp, checkTls } from "./checks.js";
import { loadConfig } from "./config.js";
import { formatDay } from "./format.js";
import { formatFunnel, formatMetrikaError, Metrika } from "./metrika.js";
import {
    detectRestarts,
    evaluateProd,
    fetchProdStatus,
    formatRestarts,
    parseProdStatus,
} from "./prod.js";
import { DailySchedule, formatReport, Stats } from "./report.js";
import { everyAligned } from "./schedule.js";
import { Outbox, Telegram } from "./telegram.js";

const config = loadConfig();
const telegram = new Telegram(config.telegramToken);
const outbox = new Outbox((text) => telegram.send(config.chatId, text));
const alerts = new AlertState({ reminderMs: config.reminderMs, timeZone: config.timeZone });
const stats = new Stats();
const daily = config.dailyReportTime
    ? new DailySchedule(config.dailyReportTime, config.timeZone)
    : null;
const metrika = config.metrika
    ? new Metrika({ ...config.metrika, timeoutMs: config.requestTimeoutMs })
    : null;
let lastContainers = new Map();
let warnedNoStartTimes = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A target that does not answer is checked again every retryMs until it does or the
// next scheduled check is due. A deploy blip of a few seconds passes unnoticed; an
// outage of retryMs × FAILURE_THRESHOLD alerts within seconds, and its recovery is
// timed to the retry rather than to the next minute. Slow answers are not retried.
// Only the scheduled attempt counts towards the availability in the daily report.
async function checkTarget(target, retry) {
    const key = `http:${target.url}`;
    const started = Date.now();
    const check = () => checkHttp(target, config.requestTimeoutMs, config.slowResponseMs);
    let result = await check();
    stats.recordHttp(key, target.name, result);
    outbox.push(alerts.record(key, target.name, result, config.failureThreshold));
    while (
        retry &&
        !result.reachable &&
        Date.now() + config.retryMs + config.requestTimeoutMs < started + config.checkIntervalMs
    ) {
        await sleep(config.retryMs);
        result = await check();
        outbox.push(alerts.record(key, target.name, result, config.failureThreshold));
    }
}

async function runHttp({ retry = true } = {}) {
    await Promise.all(config.http.map((target) => checkTarget(target, retry)));
}

async function runTls() {
    for (const host of config.tls.hosts) {
        const result = await checkTls(host, config.tls.warnDays, config.requestTimeoutMs);
        outbox.push(alerts.record(`tls:${host}`, `TLS ${host}`, result, 1));
    }
}

async function runProd() {
    let status;
    try {
        status = parseProdStatus(await fetchProdStatus(config.prod, config.requestTimeoutMs));
    } catch (error) {
        const result = { ok: false, detail: `SSH: ${error.message}` };
        outbox.push(alerts.record("prod:ssh", "Сервер (SSH)", result, config.failureThreshold));
        return;
    }
    outbox.push(alerts.record("prod:ssh", "Сервер (SSH)", { ok: true, detail: "отвечает" }, 1));
    const blind = config.prod.services.filter(
        (service) => status.containers.has(service) && !status.containers.get(service).startedAt,
    );
    if (blind.length && !warnedNoStartTimes) {
        warnedNoStartTimes = true;
        outbox.push(
            `⚠️ Не вижу время старта контейнеров (${blind.join(", ")}): перезапуски не отслеживаются. ` +
                "Обнови /usr/local/bin/stylefinder-status на сервере из infra/monitor-bot/prod.",
        );
    }
    const restarts = detectRestarts(lastContainers, status.containers, config.prod.services);
    lastContainers = status.containers;
    stats.recordRestarts(restarts);
    outbox.push(formatRestarts(restarts));
    for (const { key, label, ...result } of evaluateProd(status, config.prod)) {
        outbox.push(alerts.record(key, label, result, config.failureThreshold));
    }
}

async function metrikaReport(title, date1, date2) {
    try {
        return formatFunnel(title, await metrika.funnel(date1, date2));
    } catch (error) {
        console.error(`metrika failed: ${error.message}`);
        return formatMetrikaError(error);
    }
}

function sendDailyReport() {
    if (!daily?.due()) return;
    outbox.push(formatReport(stats, alerts, config.timeZone));
    alerts.incidents = [];
    stats.reset();
    if (metrika) {
        const day = formatDay(Date.now() - 86_400_000, config.timeZone);
        void metrikaReport(`вчера, ${day}`, "yesterday", "yesterday").then((text) =>
            outbox.push(text),
        );
    }
}

// "/funnel" → last 7 days including today, "/funnel 30" → last 30.
async function sendFunnel(text) {
    if (!metrika) {
        outbox.push("Метрика не подключена: задай METRIKA_TOKEN и METRIKA_COUNTER_ID в .env.");
        return;
    }
    const days = Math.min(Math.max(Number.parseInt(text.split(/\s+/)[1], 10) || 7, 1), 365);
    const title = days === 1 ? "сегодня" : `последние ${days} дн. с сегодняшним`;
    outbox.push(await metrikaReport(title, days === 1 ? "today" : `${days - 1}daysAgo`, "today"));
}

async function heartbeat() {
    if (!config.heartbeatUrl) return;
    try {
        await fetch(config.heartbeatUrl, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
    } catch (error) {
        console.error(`heartbeat failed: ${error.message}`);
    }
}

const HELP = [
    "Мониторинг StyleFinder.",
    "/status — проверить всё сейчас и показать сводку",
    "/report — сводка за период с последнего отчёта",
    "/funnel [дней] — воронка из Метрики, по умолчанию за 7 дней",
    "/help — эта справка",
].join("\n");

async function handleCommands() {
    for await (const message of telegram.messages()) {
        // Only the owner's chat gets answers; everyone else is ignored silently.
        if (String(message.chat.id) !== config.chatId) continue;
        const command = message.text?.split(/[\s@]/)[0];
        if (command === "/status") {
            await Promise.all([
                runHttp({ retry: false }),
                runTls(),
                config.prod ? runProd() : null,
            ]);
            outbox.push(alerts.summary());
        } else if (command === "/report") {
            outbox.push(formatReport(stats, alerts, config.timeZone));
        } else if (command === "/funnel") {
            await sendFunnel(message.text);
        } else if (command === "/help" || command === "/start") {
            outbox.push(HELP);
        }
    }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

outbox.push("🟢 Мониторинг StyleFinder запущен. /status — сводка.");
everyAligned(config.checkIntervalMs, "http", async () => {
    await runHttp();
    sendDailyReport();
    await outbox.flush();
    await heartbeat();
});
everyAligned(config.tls.intervalMs, "tls", runTls);
if (config.prod) everyAligned(config.prod.intervalMs, "prod", runProd);
handleCommands();
