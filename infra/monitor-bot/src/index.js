import { AlertState } from "./alerts.js";
import { checkHttp, checkTls } from "./checks.js";
import { loadConfig } from "./config.js";
import {
    detectRestarts,
    evaluateProd,
    fetchProdStatus,
    formatRestarts,
    parseProdStatus,
} from "./prod.js";
import { DailySchedule, formatReport, Stats } from "./report.js";
import { Outbox, Telegram } from "./telegram.js";

const config = loadConfig();
const telegram = new Telegram(config.telegramToken);
const outbox = new Outbox((text) => telegram.send(config.chatId, text));
const alerts = new AlertState({ reminderMs: config.reminderMs, timeZone: config.timeZone });
const stats = new Stats();
const daily = config.dailyReportTime
    ? new DailySchedule(config.dailyReportTime, config.timeZone)
    : null;
let lastContainers = new Map();

async function runHttp() {
    const results = await Promise.all(
        config.http.map((target) =>
            checkHttp(target, config.requestTimeoutMs, config.slowResponseMs),
        ),
    );
    config.http.forEach((target, index) => {
        stats.recordHttp(`http:${target.url}`, target.name, results[index]);
        outbox.push(
            alerts.record(
                `http:${target.url}`,
                target.name,
                results[index],
                config.failureThreshold,
            ),
        );
    });
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
    const restarts = detectRestarts(lastContainers, status.containers, config.prod.services);
    lastContainers = status.containers;
    stats.recordRestarts(restarts);
    outbox.push(formatRestarts(restarts));
    for (const { key, label, ...result } of evaluateProd(status, config.prod)) {
        outbox.push(alerts.record(key, label, result, config.failureThreshold));
    }
}

function sendDailyReport() {
    if (!daily?.due()) return;
    outbox.push(formatReport(stats, alerts, config.timeZone));
    alerts.incidents = [];
    stats.reset();
}

async function heartbeat() {
    if (!config.heartbeatUrl) return;
    try {
        await fetch(config.heartbeatUrl, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
    } catch (error) {
        console.error(`heartbeat failed: ${error.message}`);
    }
}

// Runs a task, then waits the full interval before the next run, so slow checks never overlap.
function every(intervalMs, name, task) {
    const tick = async () => {
        try {
            await task();
        } catch (error) {
            console.error(`${name} failed: ${error.stack ?? error}`);
        }
        setTimeout(tick, intervalMs);
    };
    return tick();
}

const HELP = [
    "Мониторинг StyleFinder.",
    "/status — проверить всё сейчас и показать сводку",
    "/report — сводка за период с последнего отчёта",
    "/help — эта справка",
].join("\n");

async function handleCommands() {
    for await (const message of telegram.messages()) {
        // Only the owner's chat gets answers; everyone else is ignored silently.
        if (String(message.chat.id) !== config.chatId) continue;
        const command = message.text?.split(/[\s@]/)[0];
        if (command === "/status") {
            await Promise.all([runHttp(), config.prod ? runProd() : null]);
            outbox.push(alerts.summary());
        } else if (command === "/report") {
            outbox.push(formatReport(stats, alerts, config.timeZone));
        } else if (command === "/help" || command === "/start") {
            outbox.push(HELP);
        }
    }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

outbox.push("🟢 Мониторинг StyleFinder запущен. /status — сводка.");
every(config.checkIntervalMs, "http", async () => {
    await runHttp();
    sendDailyReport();
    await outbox.flush();
    await heartbeat();
});
every(config.tls.intervalMs, "tls", runTls);
if (config.prod) every(config.prod.intervalMs, "prod", runProd);
handleCommands();
