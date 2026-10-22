import { AlertState } from "./alerts.js";
import { checkHttp, checkTls } from "./checks.js";
import { loadConfig } from "./config.js";
import { evaluateProd, fetchProdStatus, parseProdStatus } from "./prod.js";
import { Outbox, Telegram } from "./telegram.js";

const config = loadConfig();
const telegram = new Telegram(config.telegramToken);
const outbox = new Outbox((text) => telegram.send(config.chatId, text));
const alerts = new AlertState({ reminderMs: config.reminderMs, timeZone: config.timeZone });

async function runHttp() {
    const results = await Promise.all(
        config.http.map((target) => checkHttp(target, config.requestTimeoutMs)),
    );
    config.http.forEach((target, index) => {
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
    for (const { key, label, ...result } of evaluateProd(status, config.prod)) {
        outbox.push(alerts.record(key, label, result, config.failureThreshold));
    }
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
    await outbox.flush();
    await heartbeat();
});
every(config.tls.intervalMs, "tls", runTls);
if (config.prod) every(config.prod.intervalMs, "prod", runProd);
handleCommands();
