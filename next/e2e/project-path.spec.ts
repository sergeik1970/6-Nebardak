import { expect, test } from "@playwright/test";
import { buildRectRoom } from "./project-flow";

test.describe.configure({ timeout: 120_000 });

test("the steps go from the style test to the planner and open the result once walls close", async ({
    page,
}) => {
    await page.goto("/planner", { waitUntil: "networkidle" });
    const steps = page.getByRole("navigation", { name: "Шаги проекта" });
    const step = (id: string) => steps.locator(`[data-step="${id}"]`);

    await expect(steps.locator("[data-step]")).toHaveCount(3);
    await expect(step("style")).toHaveAttribute("data-status", "open");
    await expect(step("plan")).toHaveAttribute("data-status", "current");
    await expect(step("result")).toHaveAttribute("data-status", "locked");
    await expect(step("result").locator("[aria-disabled='true']")).toHaveAttribute(
        "title",
        "Итог появится, когда стены квартиры замкнутся",
    );

    // No questionnaire stands in the way: a closed room opens the result.
    await buildRectRoom(page, "4,2", "3,4");
    await expect(step("plan")).toHaveAttribute("data-status", "current");
    await expect(step("result")).toHaveAttribute("data-status", "open");

    await step("result").getByRole("link").click();
    await expect(page).toHaveURL(/\/planner\?step=result$/);
    await expect(page.locator("[data-draw-room-result='true']")).toBeVisible();

    await step("style").getByRole("link").click();
    await expect(page).toHaveURL(/\/test$/);
});

test("an older project's room and layout open in the planner as a drawing", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "The migration runs once");

    // A layout saved by the former layout step, before the drawing held furniture.
    const draft = {
        version: 3,
        updatedAt: 1_750_000_000_000,
        questionnaire: { items: [{ definitionId: "single-bed", count: 1, priority: "required" }] },
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
            layout: {
                variants: [],
                activeVariantId: null,
                editedVariantIds: [],
                placements: [
                    {
                        instanceId: "single-bed-1",
                        definitionId: "single-bed",
                        // In the corner: a bed stands against a wall.
                        x: 0,
                        y: 0,
                        rotation: 0,
                    },
                ],
                exploredNodes: 12,
                score: 100,
                notes: [],
                generatedAt: "2026-07-17T07:00:00.000Z",
            },
        },
    };
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(
        (value) => localStorage.setItem("stylefinder:project-draft:v3", JSON.stringify(value)),
        draft,
    );

    // Before the drawing existed: the room comes with its furniture.
    await page.goto("/planner", { waitUntil: "networkidle" });
    await expect(page.locator("[data-draw-room-preview='true']")).toBeVisible();
    const pieces = page.locator("[data-draw-furniture^='furniture-']");
    await expect(pieces).toHaveCount(1);
    await expect(page.locator("[data-draw-room-notice='true']")).toContainText(
        "Комната и расстановка перенесены в планировщик",
    );

    // The usual case: walls in the drawing, furniture only in the saved layout.
    await page.evaluate(() => {
        const key = "stylefinder:draw-room-editor:v1";
        const scene = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(key, JSON.stringify({ ...scene, furniture: [] }));
    });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("[data-draw-room-preview='true']")).toBeVisible();
    await expect(pieces).toHaveCount(1);
});

test("project list explains itself when accounts are off", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Мои проекты" })).toBeVisible();
    await expect(page.getByText("Аккаунты сейчас отключены.", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "открыть черновик" }).click();
    await expect(page).toHaveURL(/\/planner$/);
});
