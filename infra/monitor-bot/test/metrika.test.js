import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFunnel, formatMetrikaError, Metrika, MetrikaError } from "../src/metrika.js";

const GOALS = {
    goals: [
        { id: 11, type: "action", conditions: [{ type: "exact", url: "test_start" }] },
        { id: 12, type: "action", conditions: [{ type: "exact", url: "test_complete" }] },
        { id: 13, type: "action", conditions: [{ type: "exact", url: "questionnaire_complete" }] },
        { id: 15, type: "action", conditions: [{ type: "exact", url: "layout_generated" }] },
        { id: 16, type: "action", conditions: [{ type: "exact", url: "plan_png_export" }] },
        { id: 17, type: "action", conditions: [{ type: "exact", url: "layout_failed" }] },
        // A composite goal over the same identifiers must not shadow the real ones.
        { id: 99, type: "step", conditions: [{ type: "exact", url: "test_start" }] },
    ],
};

function fakeApi(routes) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        const route = routes[url.pathname];
        return {
            ok: route.status === undefined,
            status: route.status ?? 200,
            json: async () => route.body,
        };
    };
    return { calls, fetchImpl };
}

const config = { token: "secret", counterId: "113737739", timeoutMs: 1000 };

test("funnel maps goal identifiers to ids and reads one stat request", async () => {
    const { calls, fetchImpl } = fakeApi({
        "/management/v1/counter/113737739/goals": { body: GOALS },
        // visits, users, then each found step in order, then layout_failed reaches.
        "/stat/v1/data": { body: { totals: [120, 95, 40, 30, 21, 15, 6, 3] } },
    });
    const result = await new Metrika(config, fetchImpl).funnel("yesterday", "yesterday");

    const stat = calls[1].url.searchParams;
    assert.equal(
        stat.get("metrics"),
        "ym:s:visits,ym:s:users,ym:s:goal11users,ym:s:goal12users,ym:s:goal13users," +
            "ym:s:goal15users,ym:s:goal16users,ym:s:goal17reaches",
    );
    assert.equal(stat.get("ids"), "113737739");
    assert.equal(stat.get("date1"), "yesterday");
    assert.equal(calls[0].init.headers.authorization, "OAuth secret");

    assert.equal(result.visits, 120);
    assert.equal(result.users, 95);
    assert.deepEqual(
        result.steps.map((step) => [step.goal, step.users]),
        [
            ["test_start", 40],
            ["test_complete", 30],
            ["questionnaire_complete", 21],
            ["room_drawn", null],
            ["layout_generated", 15],
            ["plan_png_export", 6],
        ],
    );
    assert.equal(result.failed, 3);
});

test("funnel message shows step conversion and the goals missing in Metrika", () => {
    const text = formatFunnel("вчера, 22.10", {
        visits: 120,
        users: 95,
        steps: [
            { goal: "test_start", label: "Начали тест", users: 40 },
            { goal: "test_complete", label: "Прошли тест", users: 30 },
            { goal: "room_drawn", label: "Нарисовали комнату", users: null },
            { goal: "plan_png_export", label: "Скачали план", users: 6 },
        ],
        failed: 3,
    });
    assert.equal(
        text,
        [
            "📈 Метрика: вчера, 22.10",
            "Визиты: 120, посетители: 95",
            "",
            "Воронка (посетители):",
            "• Начали тест: 40",
            "• Прошли тест: 30 · 75%",
            "• Скачали план: 6 · 20%",
            "От «Начали тест» до «Скачали план»: 15%",
            "Расстановка не удалась: 3 раз",
            "",
            "Нет целей в Метрике: room_drawn",
        ].join("\n"),
    );
});

test("a quiet day has no division by zero", () => {
    const text = formatFunnel("сегодня", {
        visits: 0,
        users: 0,
        steps: [
            { goal: "test_start", label: "Начали тест", users: 0 },
            { goal: "test_complete", label: "Прошли тест", users: 0 },
        ],
        failed: 0,
    });
    assert.match(text, /• Прошли тест: 0\n/);
    assert.doesNotMatch(text, /NaN|Infinity/);
});

test("a rejected token is reported as expired, other errors as they are", async () => {
    const { fetchImpl } = fakeApi({
        "/management/v1/counter/113737739/goals": {
            status: 403,
            body: { message: "Access is denied" },
        },
    });
    const error = await new Metrika(config, fetchImpl).funnel("today", "today").catch((e) => e);
    assert.equal(error.auth, true);
    assert.match(formatMetrikaError(error), /не приняла токен/);
    assert.doesNotMatch(error.message, /secret/);

    assert.equal(
        formatMetrikaError(new MetrikaError("Wrong parameter: 'metrics'")),
        "⚠️ Метрика: не удалось получить данные: Wrong parameter: 'metrics'",
    );
});
