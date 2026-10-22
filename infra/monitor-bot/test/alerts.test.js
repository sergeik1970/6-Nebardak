import assert from "node:assert/strict";
import { test } from "node:test";
import { AlertState } from "../src/alerts.js";

const down = { ok: false, detail: "HTTP 502, ожидался 200" };
const up = { ok: true, detail: "HTTP 200, 40 мс" };
const MINUTE = 60_000;

function state() {
    return new AlertState({ reminderMs: 60 * MINUTE, timeZone: "UTC" });
}

test("alerts only after the threshold of consecutive failures", () => {
    const alerts = state();
    assert.equal(alerts.record("site", "Сайт", down, 2, 0), null);
    assert.equal(alerts.record("site", "Сайт", down, 2, MINUTE), "🔴 Сайт: HTTP 502, ожидался 200");
    assert.equal(alerts.record("site", "Сайт", down, 2, 2 * MINUTE), null);
});

test("a single blip resets without any message", () => {
    const alerts = state();
    assert.equal(alerts.record("site", "Сайт", down, 2, 0), null);
    assert.equal(alerts.record("site", "Сайт", up, 2, MINUTE), null);
    assert.equal(alerts.record("site", "Сайт", down, 2, 2 * MINUTE), null);
});

test("recovery reports how long the outage lasted from the first failure", () => {
    const alerts = state();
    alerts.record("site", "Сайт", down, 2, 0);
    alerts.record("site", "Сайт", down, 2, MINUTE);
    assert.equal(
        alerts.record("site", "Сайт", up, 2, 5 * MINUTE),
        "✅ Сайт: снова в норме, сбой длился 5 мин. HTTP 200, 40 мс",
    );
    assert.equal(alerts.record("site", "Сайт", up, 2, 6 * MINUTE), null);
});

test("reminds while a check stays down", () => {
    const alerts = state();
    alerts.record("site", "Сайт", down, 1, 0);
    assert.equal(alerts.record("site", "Сайт", down, 1, 30 * MINUTE), null);
    assert.match(alerts.record("site", "Сайт", down, 1, 60 * MINUTE), /всё ещё сбой, 1 ч 0 мин/);
    assert.equal(alerts.record("site", "Сайт", down, 1, 61 * MINUTE), null);
});

test("summary marks healthy, failing and alerted checks", () => {
    const alerts = state();
    alerts.record("a", "A", up, 2, 0);
    alerts.record("b", "B", down, 2, 0);
    alerts.record("c", "C", down, 1, 0);
    const summary = alerts.summary(MINUTE);
    assert.match(summary, /^✅ A: HTTP 200/m);
    assert.match(summary, /^🟡 B: HTTP 502/m);
    assert.match(summary, /^🔴 C: HTTP 502/m);
    assert.match(summary, /Самая старая проверка: 1 мин 00 с назад, в 00:00:00/);
});

test("summary reports the age of the oldest check to the second", () => {
    const alerts = state();
    alerts.record("a", "A", up, 2, 0);
    alerts.record("b", "B", up, 2, 4 * MINUTE);
    assert.match(alerts.summary(4 * MINUTE + 5_000), /Самая старая проверка: 4 мин 05 с назад/);
    assert.match(alerts.summary(42_000), /Самая старая проверка: 42 с назад/);
});
