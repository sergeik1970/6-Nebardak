import { expect, test } from "@playwright/test";

const PROJECT_ID = "3f0c2a52-9a43-4c2b-8f3e-2b1d7c9e4a10";
const DRAFT_KEY = "stylefinder:project-draft:v4";
const EDITOR_KEY = "stylefinder:draw-room-editor:v1";
const scoped = (key: string) => `stylefinder:project:${PROJECT_ID}:${key}`;

const draft = {
    version: 4,
    updatedAt: 1_750_000_000_000,
    questionnaire: {
        items: [{ definitionId: "single-bed", count: 1, priority: "required" }],
        meta: { styleKey: "provence", styleLabel: "Прованс" },
    },
    planner: {
        room: {
            width: 6200,
            depth: 4600,
            doors: [
                {
                    id: "door-main",
                    wall: "bottom",
                    offset: 500,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
            windows: [],
            radiators: [],
        },
        selection: { "single-bed": 1 },
        priorities: { "single-bed": "required" },
    },
};

const scene = {
    segments: [
        { id: "w0", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
        { id: "w1", start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } },
        { id: "w2", start: { x: 4000, y: 3000 }, end: { x: 0, y: 3000 } },
        { id: "w3", start: { x: 0, y: 3000 }, end: { x: 0, y: 0 } },
    ],
    doors: [],
    windows: [],
    wallThickness: 100,
};

test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Storage scoping runs once on desktop");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
});

test("a project link never falls back to the guest draft or another store", async ({ page }) => {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
        key: DRAFT_KEY,
        value: draft,
    });
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
        key: scoped(EDITOR_KEY),
        value: scene,
    });

    for (const path of ["/planner", "/planner/draw", "/questionnaire", "/test"]) {
        await page.goto(`${path}?project=${PROJECT_ID}`, { waitUntil: "networkidle" });
        // This build has accounts off; a saved project must not open from a local copy.
        await expect(
            page.getByRole("heading", { name: /Сохранённые проекты недоступны|Войдите/ }),
        ).toBeVisible();
        await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toHaveCount(0);
    }

    expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toContain(
        "single-bed",
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), EDITOR_KEY)).toBeNull();
});

test("a malformed project id falls back to the guest draft", async ({ page }) => {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
        key: DRAFT_KEY,
        value: draft,
    });

    await page.goto("/planner?project=..%2F..%2Fsecret", { waitUntil: "networkidle" });

    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
});
