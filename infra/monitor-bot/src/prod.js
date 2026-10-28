import { execFile } from "node:child_process";
import { formatDuration } from "./format.js";

// The key is forced to prod/stylefinder-status on the server, so no remote command is sent.
export function fetchProdStatus(prod, timeoutMs) {
    const args = [
        "-i",
        prod.keyFile,
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${prod.knownHostsFile}`,
        "-o",
        `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
        prod.target,
    ];
    return new Promise((resolve, reject) => {
        execFile("ssh", args, { timeout: timeoutMs * 3 }, (error, stdout, stderr) => {
            if (error) {
                const reason = stderr.trim().split("\n").pop() || error.message;
                reject(new Error(reason));
            } else {
                resolve(stdout);
            }
        });
    });
}

export function parseProdStatus(text) {
    const status = { disks: [], memoryAvailable: null, containers: new Map(), backup: {}, users: null };
    for (const line of text.split("\n")) {
        const [kind, ...fields] = line.trim().split(/\s+/);
        if (kind === "disk") {
            status.disks.push({ mount: fields[0], percent: Number(fields[1]) });
        } else if (kind === "memory_available") {
            status.memoryAvailable = Number(fields[0]);
        } else if (kind === "container") {
            const [service, state, health, restartCount, startedAt] = fields;
            // A finished one-off container must not hide the running one of the same service.
            if (status.containers.get(service)?.state !== "running") {
                status.containers.set(service, {
                    state,
                    health,
                    restartCount: restartCount === undefined ? null : Number(restartCount),
                    startedAt: startedAt ?? null,
                });
            }
        } else if (kind === "backup_last_success") {
            status.backup.lastSuccess = Number(fields[0]) * 1000;
            status.backup.name = fields[1];
        } else if (kind === "users") {
            status.users = { count: Number(fields[0]), lastId: Number(fields[1]) };
        } else if (kind === "backup_last_result") {
            status.backup.lastResult = fields[0];
        }
    }
    return status;
}

// Compares container start times between polls. Docker's RestartCount grows when it
// revives a crashed container; a recreated container (deploy) starts again from zero.
export function detectRestarts(previous, containers, services) {
    const events = [];
    for (const service of services) {
        const current = containers.get(service);
        const before = previous.get(service);
        if (!current) continue;
        if (!before?.startedAt || !current.startedAt || before.startedAt === current.startedAt) {
            continue;
        }
        const crashes = current.restartCount - before.restartCount;
        events.push(
            crashes > 0
                ? { service, crashes, detail: `упал, Docker перезапустил ×${crashes}` }
                : { service, crashes: 0, detail: "запущен заново (деплой или ручной перезапуск)" },
        );
    }
    return events;
}

// The first poll after the bot starts only remembers the last id, so a restart of the
// bot does not announce old accounts.
export function formatRegistrations(previousLastId, users) {
    if (!users || previousLastId === null || users.lastId <= previousLastId) return null;
    const added = users.lastId - previousLastId;
    const head = added === 1 ? "🎉 Новая регистрация" : `🎉 Новых регистраций: ${added}`;
    return `${head} (id ${users.lastId}). Всего пользователей: ${users.count}.`;
}

export function formatRestarts(events) {
    if (events.length === 0) return null;
    const lines = events.map(({ service, detail }) => `• ${service}: ${detail}`);
    return ["🔄 Перезапуски контейнеров:", ...lines].join("\n");
}

export function evaluateProd(status, prod, now = Date.now()) {
    const results = [];

    for (const { mount, percent } of status.disks) {
        results.push({
            key: `prod:disk:${mount}`,
            label: `Диск ${mount}`,
            ok: percent < prod.diskLimit,
            detail: `занято ${percent}%`,
        });
    }

    results.push({
        key: "prod:memory",
        label: "Память",
        ok: status.memoryAvailable !== null && status.memoryAvailable >= prod.memoryFloor,
        detail:
            status.memoryAvailable === null ? "нет данных" : `доступно ${status.memoryAvailable}%`,
    });

    for (const service of prod.services) {
        const container = status.containers.get(service);
        const healthy = container?.state === "running" && container.health !== "unhealthy";
        results.push({
            key: `prod:container:${service}`,
            label: `Контейнер ${service}`,
            ok: healthy,
            detail: container
                ? `${container.state}${container.health === "none" ? "" : `, ${container.health}`}`
                : "не найден",
        });
    }

    const { lastSuccess, name, lastResult } = status.backup;
    const age = lastSuccess ? now - lastSuccess : null;
    const fresh = age !== null && age <= prod.backupMaxAgeHours * 3600_000;
    const lastRunFailed = lastResult && lastResult !== "success";
    results.push({
        key: "prod:backup",
        label: "Бэкап",
        ok: fresh && !lastRunFailed,
        detail: [
            age === null
                ? "нет отметки об успешном бэкапе"
                : `успешный ${formatDuration(age)} назад`,
            name,
            lastRunFailed ? `последний запуск: ${lastResult}` : null,
        ]
            .filter(Boolean)
            .join(", "),
    });

    return results;
}
