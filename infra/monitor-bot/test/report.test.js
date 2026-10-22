import assert from "node:assert/strict";
import { test } from "node:test";
import { AlertState } from "../src/alerts.js";
import { detectRestarts, formatRestarts, parseProdStatus } from "../src/prod.js";
import { DailySchedule, formatReport, Stats } from "../src/report.js";

const SERVICES = ["caddy", "next", "nest", "db"];
const MINUTE = 60_000;

function containers(lines) {
    return parseProdStatus(lines.map((line) => `container ${line}`).join("\n")).containers;
}

test("restart detection tells crashes from fresh starts and ignores the first poll", () => {
    const first = containers([
        "nest running healthy 0 2026-10-22T10:00:00Z",
        "next running healthy 0 2026-10-22T10:00:00Z",
        "db running healthy 0 2026-10-22T10:00:00Z",
    ]);
    assert.deepEqual(detectRestarts(new Map(), first, SERVICES), []);

    const second = containers([
        "nest running healthy 2 2026-10-22T10:07:00Z",
        "next running healthy 0 2026-10-22T10:08:00Z",
        "db running healthy 0 2026-10-22T10:00:00Z",
        "migrate exited none 0 2026-10-22T10:08:00Z",
    ]);
    const events = detectRestarts(first, second, SERVICES);
    assert.deepEqual(
        events.map(({ service, crashes }) => [service, crashes]),
        [
            ["next", 0],
            ["nest", 2],
        ],
    );
    assert.equal(
        formatRestarts(events),
        [
            "🔄 Перезапуски контейнеров:",
            "• next: запущен заново (деплой или ручной перезапуск)",
            "• nest: упал, Docker перезапустил ×2",
        ].join("\n"),
    );
    assert.equal(formatRestarts([]), null);
});

test("the old status format without restart fields reports nothing", () => {
    const before = containers(["nest running healthy"]);
    const after = containers(["nest running healthy"]);
    assert.deepEqual(detectRestarts(before, after, SERVICES), []);
});

test("the daily report sums availability, speed, incidents and restarts", () => {
    const start = Date.UTC(2026, 9, 22, 6);
    const stats = new Stats(start);
    const alerts = new AlertState({ reminderMs: 3600_000, timeZone: "Europe/Moscow" });

    for (let i = 0; i < 99; i += 1) {
        stats.recordHttp("site", "Сайт", { reachable: true, ms: 200 });
    }
    stats.recordHttp("site", "Сайт", { reachable: false, ms: null });
    stats.recordHttp("ready", "API ready", { reachable: true, ms: 4000 });
    stats.recordRestarts([
        { service: "nest", crashes: 2 },
        { service: "next", crashes: 0 },
    ]);

    alerts.record("site", "Сайт", { ok: false, detail: "HTTP 502" }, 1, start + MINUTE);
    alerts.record("site", "Сайт", { ok: true, detail: "HTTP 200" }, 1, start + 2 * MINUTE);
    alerts.record("prod:disk:/", "Диск /", { ok: true, detail: "занято 59%" }, 2, start);

    const report = formatReport(stats, alerts, "Europe/Moscow");
    assert.match(report, /^📋 Сводка StyleFinder с 22\.10, 09:00$/m);
    assert.match(report, /^• Сайт: 99\.00%, в среднем 200 мс, максимум 200 мс$/m);
    assert.match(report, /^• API ready: 100%, в среднем 4000 мс, максимум 4000 мс$/m);
    assert.match(report, /^Сбоев: 1$/m);
    assert.match(report, /^• 22\.10, 09:01 Сайт$/m);
    assert.match(report, /^Падений контейнеров: 2, запусков заново: 1$/m);
    assert.match(report, /^Диск \/: занято 59%$/m);
    assert.match(report, /Сейчас всё в норме ✅$/);
});

test("the daily schedule fires once per day and waits for tomorrow when started late", () => {
    const tz = "Europe/Moscow";
    // 06:00 UTC is 09:00 in Moscow.
    const at = (day, hour, minute = 0) => Date.UTC(2026, 9, day, hour, minute);

    const early = new DailySchedule("09:00", tz, at(22, 5));
    assert.equal(early.due(at(22, 5, 59)), false);
    assert.equal(early.due(at(22, 6)), true);
    assert.equal(early.due(at(22, 6, 1)), false);
    assert.equal(early.due(at(23, 6)), true);

    const late = new DailySchedule("09:00", tz, at(22, 10));
    assert.equal(late.due(at(22, 11)), false);
    assert.equal(late.due(at(23, 6)), true);
});
