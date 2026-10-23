import { readFileSync } from "node:fs";

function required(env, name) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Set ${name}`);
    return value;
}

function number(env, name, fallback) {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
    return value;
}

function list(env, name, fallback) {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

// HH:MM in DISPLAY_TIMEZONE; "off" disables the daily report.
function dailyTime(env) {
    const raw = env.DAILY_REPORT_TIME?.trim() || "09:00";
    if (raw === "off") return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw))
        throw new Error("DAILY_REPORT_TIME must be HH:MM or off");
    return raw;
}

export function loadConfig(env = process.env) {
    const targets = JSON.parse(readFileSync(env.TARGETS_FILE || "/config/targets.json", "utf8"));
    const prodTarget = env.PROD_SSH_TARGET?.trim();

    return {
        telegramToken: required(env, "TELEGRAM_BOT_TOKEN"),
        chatId: required(env, "TELEGRAM_CHAT_ID"),
        timeZone: env.DISPLAY_TIMEZONE || "Europe/Moscow",
        checkIntervalMs: number(env, "CHECK_INTERVAL_SECONDS", 30) * 1000,
        requestTimeoutMs: number(env, "REQUEST_TIMEOUT_SECONDS", 10) * 1000,
        failureThreshold: number(env, "FAILURE_THRESHOLD", 2),
        slowResponseMs: number(env, "SLOW_RESPONSE_MS", 3000),
        dailyReportTime: dailyTime(env),
        reminderMs: number(env, "REMINDER_HOURS", 6) * 3600_000,
        http: targets.http ?? [],
        tls: {
            hosts: targets.tls ?? [],
            warnDays: number(env, "TLS_WARN_DAYS", 14),
            intervalMs: number(env, "TLS_INTERVAL_SECONDS", 300) * 1000,
        },
        // Server internals over SSH with a key that can run only the status script.
        prod: prodTarget
            ? {
                  target: prodTarget,
                  keyFile: env.PROD_SSH_KEY_FILE || "/config/prod_ssh_key",
                  knownHostsFile: env.PROD_KNOWN_HOSTS_FILE || "/config/known_hosts",
                  intervalMs: number(env, "PROD_INTERVAL_SECONDS", 300) * 1000,
                  services: list(env, "PROD_SERVICES", [
                      "caddy",
                      "next",
                      "nest",
                      "db",
                      "smtp-relay",
                  ]),
                  diskLimit: number(env, "DISK_LIMIT_PERCENT", 80),
                  memoryFloor: number(env, "MEMORY_AVAILABLE_MIN_PERCENT", 10),
                  backupMaxAgeHours: number(env, "BACKUP_MAX_AGE_HOURS", 26),
              }
            : null,
        // Optional dead man's switch: an outside service alerts when the bot itself goes quiet.
        heartbeatUrl: env.HC_PING_URL?.trim() || null,
    };
}
