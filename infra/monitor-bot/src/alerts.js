import { formatAge, formatClock, formatDuration, formatTime } from "./format.js";

// Turns a stream of check results into messages: one when a check goes down after
// `threshold` failures in a row, a reminder while it stays down, one on recovery.
// Failures that end before the threshold (a deploy, a restart) get one short notice,
// unless the target only answered slowly.
export class AlertState {
    constructor({ reminderMs, timeZone }) {
        this.reminderMs = reminderMs;
        this.timeZone = timeZone;
        this.checks = new Map();
        this.incidents = [];
    }

    record(key, label, result, threshold, now = Date.now()) {
        const check = this.checks.get(key) ?? { failures: 0, down: false };
        this.checks.set(key, check);
        Object.assign(check, { label, ok: result.ok, detail: result.detail, checkedAt: now });

        if (result.ok) {
            let message = null;
            if (check.down) {
                message = `✅ ${label}: снова в норме, сбой длился ${formatDuration(now - check.failingSince)}. ${result.detail}`;
            } else if (check.failures > 0 && check.blipDetail) {
                message = `⚠️ ${label}: кратковременный сбой, восстановился за ${formatDuration(now - check.failingSince)}. Было: ${check.blipDetail}`;
            }
            Object.assign(check, {
                failures: 0,
                down: false,
                failingSince: null,
                blipDetail: null,
            });
            return message;
        }

        check.failures += 1;
        if (check.failures === 1) check.failingSince = now;
        if (result.reachable !== true) check.blipDetail = result.detail;
        if (!check.down && check.failures >= threshold) {
            Object.assign(check, { down: true, alertedAt: now });
            this.incidents.push({ label, at: now });
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
        lines.push(
            "",
            `Самая старая проверка: ${formatAge(now - oldest)} назад, в ${formatClock(oldest, this.timeZone)}`,
        );
        return lines.join("\n");
    }
}
