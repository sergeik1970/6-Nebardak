import { expect, test } from "@playwright/test";
import { buildRectRoom, continueThroughRoomStep, readRoomSize } from "./project-flow";

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

test("a room change marks the layout stale instead of erasing it silently", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Room round trip runs once");

    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await continueThroughRoomStep(page);
    expect(await readRoomSize(page)).toEqual({ width: 6000, depth: 4600 });

    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });

    // Visiting the room step without changing the walls keeps the layout.
    await page.getByRole("link", { name: "Изменить комнату в чертеже" }).click();
    await expect(page).toHaveURL(/\/planner\/draw$/);
    await page.getByRole("button", { name: "Продолжить с комнатой" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible();

    // New walls keep the furniture but hide the old layout and say why.
    await page.getByRole("link", { name: "Изменить комнату в чертеже" }).click();
    await buildRectRoom(page, "5", "4");
    await page.getByRole("button", { name: "Продолжить с комнатой" }).click();
    await expect(page.locator("[data-room-summary]")).toBeVisible();
    expect(await readRoomSize(page)).toEqual({ width: 5000, depth: 4000 });
    await expect(page.getByText(/Комната изменилась — прежняя расстановка устарела/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();

    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });
});

test("door changes on the layout step survive a trip through the drawing", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Opening sync runs once");

    await page.goto("/planner/draw", { waitUntil: "networkidle" });
    await buildRectRoom(page);
    await page.getByRole("button", { name: "Продолжить с комнатой" }).click();
    await expect(page.locator("[data-room-summary]")).toBeVisible();

    await page.locator("summary").filter({ hasText: "Проёмы и отопление" }).click();
    const doorOffset = page.locator('input[name="door-door-main-offset"]');
    await doorOffset.fill("120");
    await doorOffset.blur();
    await expect(doorOffset).toHaveValue("120");

    await page.getByRole("link", { name: "Изменить комнату в чертеже" }).click();
    await expect(page).toHaveURL(/\/planner\/draw$/);
    await page.getByRole("button", { name: "Продолжить с комнатой" }).click();
    await page.locator("summary").filter({ hasText: "Проёмы и отопление" }).click();
    await expect(page.locator('input[name="door-door-main-offset"]')).toHaveValue("120");
});

test("an older project's room and layout open in the planner as a drawing", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "The migration runs once");

    // A layout made on the former layout step, before the drawing held furniture.
    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await continueThroughRoomStep(page);
    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });
    // The usual case: the drawing has the walls, the layout step had the furniture.
    await page.goto("/planner", { waitUntil: "networkidle" });
    await expect(page.locator("[data-draw-room-preview='true']")).toBeVisible();
    const pieces = page.locator("[data-draw-furniture^='furniture-']");
    await expect(pieces).toHaveCount(1);

    // A project from before the drawing existed: the room comes with its furniture.
    await page.evaluate(() => localStorage.removeItem("stylefinder:draw-room-editor:v1"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("[data-draw-room-preview='true']")).toBeVisible();
    await expect(pieces).toHaveCount(1);
    await expect(page.locator("[data-draw-room-notice='true']")).toContainText(
        "Комната и расстановка перенесены в планировщик",
    );
});

test("project list explains itself when accounts are off", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Мои проекты" })).toBeVisible();
    await expect(page.getByText("Аккаунты сейчас отключены.", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "открыть черновик" }).click();
    await expect(page).toHaveURL(/\/questionnaire$/);
});
