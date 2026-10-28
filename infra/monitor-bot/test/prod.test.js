import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateProd, formatRegistrations, parseProdStatus } from "../src/prod.js";

const NOW = Date.UTC(2026, 9, 22, 12);
const prod = {
    services: ["caddy", "next", "nest", "db"],
    diskLimit: 80,
    memoryFloor: 10,
    backupMaxAgeHours: 26,
};

function output({ disk = 49, memory = 61, backupAgeHours = 9, result = "success" } = {}) {
    const stamp = Math.floor((NOW - backupAgeHours * 3600_000) / 1000);
    return [
        `disk / ${disk}`,
        "disk /var/lib/docker 49",
        `memory_available ${memory}`,
        "container caddy running healthy",
        "container next running healthy",
        "container nest running healthy",
        "container db running healthy",
        "container migrate exited none",
        `backup_last_success ${stamp} stylefinder-20261022T031500Z.dump.age`,
        `backup_last_result ${result}`,
        "",
    ].join("\n");
}

function byKey(results) {
    return Object.fromEntries(results.map((result) => [result.key, result]));
}

test("a healthy server passes every check", () => {
    const results = evaluateProd(parseProdStatus(output()), prod, NOW);
    assert.deepEqual(
        results.filter((result) => !result.ok),
        [],
    );
    assert.equal(results.length, 8);
    assert.equal(
        byKey(results)["prod:backup"].detail,
        "успешный 9 ч 0 мин назад, stylefinder-20261022T031500Z.dump.age",
    );
});

test("flags a full disk and low memory", () => {
    const results = byKey(
        evaluateProd(parseProdStatus(output({ disk: 85, memory: 6 })), prod, NOW),
    );
    assert.equal(results["prod:disk:/"].ok, false);
    assert.equal(results["prod:disk:/"].detail, "занято 85%");
    assert.equal(results["prod:memory"].ok, false);
});

test("flags a stale backup, a failed last run and a missing stamp", () => {
    const stale = byKey(evaluateProd(parseProdStatus(output({ backupAgeHours: 30 })), prod, NOW));
    assert.equal(stale["prod:backup"].ok, false);

    const failed = byKey(evaluateProd(parseProdStatus(output({ result: "exit-code" })), prod, NOW));
    assert.equal(failed["prod:backup"].ok, false);
    assert.match(failed["prod:backup"].detail, /последний запуск: exit-code/);

    const missing = byKey(evaluateProd(parseProdStatus("backup_last_result success\n"), prod, NOW));
    assert.equal(missing["prod:backup"].ok, false);
    assert.equal(missing["prod:backup"].detail, "нет отметки об успешном бэкапе");
});

test("flags unhealthy, stopped and missing containers", () => {
    const text = output()
        .replace("container nest running healthy", "container nest running unhealthy")
        .replace("container next running healthy", "container next exited none")
        .replace("container db running healthy\n", "");
    const results = byKey(evaluateProd(parseProdStatus(text), prod, NOW));
    assert.equal(results["prod:container:caddy"].ok, true);
    assert.equal(results["prod:container:nest"].detail, "running, unhealthy");
    assert.equal(results["prod:container:nest"].ok, false);
    assert.equal(results["prod:container:next"].detail, "exited");
    assert.equal(results["prod:container:next"].ok, false);
    assert.equal(results["prod:container:db"].detail, "не найден");
});

test("a finished one-off container does not hide the running one", () => {
    const text = "container db running healthy\ncontainer db exited none\n";
    assert.equal(parseProdStatus(text).containers.get("db").state, "running");
});

test("sign-ups are announced only after the first poll and only when the last id grows", () => {
    const users = parseProdStatus("users 42 57\n").users;
    assert.deepEqual(users, { count: 42, lastId: 57 });
    assert.equal(formatRegistrations(null, users), null);
    assert.equal(formatRegistrations(57, users), null);
    assert.equal(
        formatRegistrations(56, users),
        "🎉 Новая регистрация (id 57). Всего пользователей: 42.",
    );
    assert.match(formatRegistrations(54, users), /Новых регистраций: 3/);
    assert.equal(formatRegistrations(56, parseProdStatus(output()).users), null);
});
