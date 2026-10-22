import { formatTime } from "./format.js";

// Counters for the daily report, kept in memory since the last report (or bot start).
export class Stats {
    constructor(now = Date.now()) {
        this.reset(now);
    }

    reset(now = Date.now()) {
        this.since = now;
        this.http = new Map();
        this.restarts = [];
    }

    recordHttp(key, label, result) {
        const entry = this.http.get(key) ?? {
            label,
            total: 0,
            up: 0,
            sumMs: 0,
            timed: 0,
            maxMs: 0,
        };
        this.http.set(key, entry);
        entry.total += 1;
        if (result.reachable) entry.up += 1;
        if (result.ms !== null) {
            entry.sumMs += result.ms;
            entry.timed += 1;
            entry.maxMs = Math.max(entry.maxMs, result.ms);
        }
    }

    recordRestarts(events) {
        this.restarts.push(...events);
    }
}

function percent(up, total) {
    if (total === 0) return "нет данных";
    const value = (up / total) * 100;
    return `${value === 100 ? "100" : value.toFixed(2)}%`;
}

export function formatReport(stats, alerts, timeZone) {
    const lines = [
        `📋 Сводка StyleFinder с ${formatTime(stats.since, timeZone)}`,
        "",
        "Доступность:",
    ];
    for (const entry of stats.http.values()) {
        const speed = entry.timed
            ? `, в среднем ${Math.round(entry.sumMs / entry.timed)} мс, максимум ${entry.maxMs} мс`
            : "";
        lines.push(`• ${entry.label}: ${percent(entry.up, entry.total)}${speed}`);
    }

    const incidents = alerts.incidents.filter((incident) => incident.at >= stats.since);
    lines.push("", `Сбоев: ${incidents.length}`);
    for (const { label, at } of incidents) lines.push(`• ${formatTime(at, timeZone)} ${label}`);

    const crashes = stats.restarts.reduce((sum, event) => sum + event.crashes, 0);
    const starts = stats.restarts.filter((event) => event.crashes === 0).length;
    lines.push(`Падений контейнеров: ${crashes}, запусков заново: ${starts}`);

    const details = [...alerts.checks.entries()]
        .filter(([key]) => /^(prod:(disk|memory|backup)|tls:)/.test(key))
        .map(([, check]) => `${check.label}: ${check.detail}`);
    if (details.length) lines.push("", ...details);

    const problems = [...alerts.checks.values()].filter((check) => !check.ok);
    lines.push(
        "",
        problems.length
            ? `Сейчас проблемы: ${problems.map((check) => check.label).join(", ")}`
            : "Сейчас всё в норме ✅",
    );
    return lines.join("\n");
}

function localParts(ms, timeZone) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        })
            .formatToParts(new Date(ms))
            .map(({ type, value }) => [type, value]),
    );
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`,
    };
}

// Fires once a day at or after `time` (HH:MM in `timeZone`). Started after today's
// time, it waits for tomorrow instead of sending a report covering a few minutes.
export class DailySchedule {
    constructor(time, timeZone, now = Date.now()) {
        this.time = time;
        this.timeZone = timeZone;
        const { date, time: current } = localParts(now, timeZone);
        this.lastDate = current >= time ? date : null;
    }

    due(now = Date.now()) {
        const { date, time } = localParts(now, this.timeZone);
        if (time < this.time || date === this.lastDate) return false;
        this.lastDate = date;
        return true;
    }
}
