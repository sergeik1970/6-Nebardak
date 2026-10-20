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

test("a saved project restores from its own keys and never touches the guest draft", async ({
    page,
}) => {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
        key: scoped(DRAFT_KEY),
        value: draft,
    });

    await page.goto(`/planner?project=${PROJECT_ID}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Ширина м" })).toHaveValue("6,2");

    await page.goto("/planner", { waitUntil: "networkidle" });
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).not.toBeChecked();

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain(scoped(DRAFT_KEY));
    const guestDraft = await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);
    expect(guestDraft ?? "").not.toContain("single-bed");
});

test("the room editor keeps the drawing per project and links back into it", async ({ page }) => {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
        key: scoped(EDITOR_KEY),
        value: scene,
    });

    await page.goto(`/planner/draw?project=${PROJECT_ID}`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Восстановлен сохранённый чертёж/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Назад к планировщику" })).toHaveAttribute(
        "href",
        `/planner?project=${PROJECT_ID}`,
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), EDITOR_KEY)).toBeNull();

    await page.goto("/planner/draw", { waitUntil: "networkidle" });
    await expect(page.getByText(/Восстановлен сохранённый чертёж/)).toHaveCount(0);
});

test("a malformed project id falls back to the guest draft", async ({ page }) => {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
        key: DRAFT_KEY,
        value: draft,
    });

    await page.goto("/planner?project=..%2F..%2Fsecret", { waitUntil: "networkidle" });

    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
});
