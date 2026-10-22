import { formatDuration, formatTime } from "./format.js";

// Turns a stream of check results into messages: one when a check goes down after
// `threshold` failures in a row, a reminder while it stays down, one on recovery.
export class AlertState {
    constructor({ reminderMs, timeZone }) {
        this.reminderMs = reminderMs;
        this.timeZone = timeZone;
        this.checks = new Map();
    }

    record(key, label, result, threshold, now = Date.now()) {
        const check = this.checks.get(key) ?? { failures: 0, down: false };
        this.checks.set(key, check);
        Object.assign(check, { label, ok: result.ok, detail: result.detail, checkedAt: now });

        if (result.ok) {
            const message = check.down
                ? `✅ ${label}: снова в норме, сбой длился ${formatDuration(now - check.failingSince)}. ${result.detail}`
                : null;
            Object.assign(check, { failures: 0, down: false, failingSince: null });
            return message;
        }

        check.failures += 1;
        if (check.failures === 1) check.failingSince = now;
        if (!check.down && check.failures >= threshold) {
            Object.assign(check, { down: true, alertedAt: now });
            return `🔴 ${label}: ${result.detail}`;
        }
        if (check.down && now - check.alertedAt >= this.reminderMs) {
            check.alertedAt = now;
            return `🔴 ${label}: всё ещё сбой, ${formatDuration(now - check.failingSince)}. ${result.detail}`;
        }
        return null;
    }

    summary(now = Date.now()) {
        if (this.checks.size === 0) return "Проверки ещё не выполнялись.";
        const lines = [];
        for (const check of this.checks.values()) {
            const icon = check.ok ? "✅" : check.down ? "🔴" : "🟡";
            const since = check.ok ? "" : ` (с ${formatTime(check.failingSince, this.timeZone)})`;
            lines.push(`${icon} ${check.label}: ${check.detail}${since}`);
        }
        const oldest = Math.min(...[...this.checks.values()].map((check) => check.checkedAt));
        lines.push("", `Самая старая проверка: ${formatDuration(now - oldest)} назад`);
        return lines.join("\n");
    }
}
