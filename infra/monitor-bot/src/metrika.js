// Yandex Metrika: the product funnel from the goals the site sends
// (next/src/shared/lib/analytics). Read-only token, scope metrika:read.
const API = "https://api-metrika.yandex.net";

// Goal identifiers as the site sends them, in funnel order.
export const FUNNEL = [
    ["test_start", "Начали тест"],
    ["test_complete", "Прошли тест"],
    ["questionnaire_complete", "Заполнили анкету"],
    ["room_drawn", "Нарисовали комнату"],
    ["layout_generated", "Получили расстановку"],
    ["plan_png_export", "Скачали план"],
];
const LAYOUT_FAILED = "layout_failed";

export class MetrikaError extends Error {
    constructor(message, { auth = false } = {}) {
        super(message);
        this.auth = auth;
    }
}

export class Metrika {
    constructor({ token, counterId, timeoutMs }, fetchImpl = fetch) {
        this.token = token;
        this.counterId = counterId;
        this.timeoutMs = timeoutMs;
        this.fetch = fetchImpl;
    }

    // Errors never include the request headers, which carry the token.
    async get(path, params = {}) {
        const url = new URL(path, API);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
        const response = await this.fetch(url, {
            headers: { authorization: `OAuth ${this.token}` },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403)
            throw new MetrikaError(data.message ?? `HTTP ${response.status}`, { auth: true });
        if (!response.ok) throw new MetrikaError(data.message ?? `HTTP ${response.status}`);
        return data;
    }

    // Identifier → numeric goal id. Composite goals ("step") reuse the same
    // identifiers in their steps, so they are skipped.
    async goalIds() {
        const { goals = [] } = await this.get(`/management/v1/counter/${this.counterId}/goals`);
        const ids = new Map();
        for (const goal of goals) {
            if (goal.type === "step") continue;
            for (const condition of goal.conditions ?? []) {
                if (condition.url && !ids.has(condition.url)) ids.set(condition.url, goal.id);
            }
        }
        return ids;
    }

    // date1/date2 as the API takes them: "today", "yesterday", "6daysAgo" or YYYY-MM-DD,
    // in the counter's time zone.
    async funnel(date1, date2) {
        const ids = await this.goalIds();
        const steps = FUNNEL.map(([goal, label]) => ({ goal, label, id: ids.get(goal) }));
        const failedId = ids.get(LAYOUT_FAILED);
        const metrics = [
            "ym:s:visits",
            "ym:s:users",
            ...steps.filter((step) => step.id).map((step) => `ym:s:goal${step.id}users`),
            ...(failedId ? [`ym:s:goal${failedId}reaches`] : []),
        ];
        const { totals = [] } = await this.get("/stat/v1/data", {
            ids: this.counterId,
            metrics: metrics.join(","),
            date1,
            date2,
            accuracy: "full",
        });

        let index = 0;
        const next = () => Math.round(totals[index++] ?? 0);
        const visits = next();
        const users = next();
        return {
            visits,
            users,
            steps: steps.map(({ goal, label, id }) => ({ goal, label, users: id ? next() : null })),
            failed: failedId ? next() : null,
        };
    }
}

export function formatFunnel(title, { visits, users, steps, failed }) {
    const lines = [`📈 Метрика: ${title}`, `Визиты: ${visits}, посетители: ${users}`];
    const counted = steps.filter((step) => step.users !== null);
    if (counted.length) {
        lines.push("", "Воронка (посетители):");
        counted.forEach((step, index) => {
            const previous = counted[index - 1]?.users;
            const share = previous ? ` · ${Math.round((step.users / previous) * 100)}%` : "";
            lines.push(`• ${step.label}: ${step.users}${index === 0 ? "" : share}`);
        });
        const first = counted[0];
        const last = counted.at(-1);
        if (counted.length > 1 && first.users > 0) {
            const total = Math.round((last.users / first.users) * 100);
            lines.push(`От «${first.label}» до «${last.label}»: ${total}%`);
        }
    }
    if (failed !== null) lines.push(`Расстановка не удалась: ${failed} раз`);

    const missing = steps.filter((step) => step.users === null).map((step) => step.goal);
    if (failed === null) missing.push(LAYOUT_FAILED);
    if (missing.length) lines.push("", `Нет целей в Метрике: ${missing.join(", ")}`);
    return lines.join("\n");
}

export function formatMetrikaError(error) {
    if (error.auth) {
        return [
            "⚠️ Метрика не приняла токен. Скорее всего, он истёк (токен живёт год).",
            "Выпусти новый на oauth.yandex.ru и замени METRIKA_TOKEN в .env бота.",
        ].join("\n");
    }
    return `⚠️ Метрика: не удалось получить данные: ${error.message}`;
}
