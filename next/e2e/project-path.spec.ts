import { expect, test } from "@playwright/test";
import { buildRectRoom, continueThroughRoomStep, readRoomSize } from "./project-flow";

test.describe.configure({ timeout: 120_000 });

test("the steps unlock the layout only once there is furniture and a room", async ({ page }) => {
    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    const steps = page.getByRole("navigation", { name: "Шаги проекта" });
    const step = (id: string) => steps.locator(`[data-step="${id}"]`);

    await expect(step("questionnaire")).toHaveAttribute("data-status", "current");
    await expect(step("layout")).toHaveAttribute("data-status", "locked");
    await expect(step("layout").locator("[aria-disabled='true']")).toHaveAttribute(
        "title",
        "Сначала выберите мебель и нарисуйте комнату",
    );

    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await expect(step("layout").locator("[aria-disabled='true']")).toHaveAttribute(
        "title",
        "Сначала нарисуйте комнату",
    );

    await step("room").getByRole("link").click();
    await expect(page).toHaveURL(/\/planner\/draw$/);
    await expect(step("questionnaire")).toHaveAttribute("data-status", "done");
    await expect(step("room")).toHaveAttribute("data-status", "current");
    await buildRectRoom(page, "4,2", "3,4");
    await expect(step("room")).toHaveAttribute("data-status", "current");
    await expect(step("layout")).toHaveAttribute("data-status", "open");

    await step("layout").getByRole("link").click();
    await expect(page).toHaveURL(/\/planner$/);
    await expect(step("layout")).toHaveAttribute("data-status", "current");
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

test("project list explains itself when accounts are off", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Мои проекты" })).toBeVisible();
    await expect(page.getByText("Аккаунты сейчас отключены.", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "открыть черновик" }).click();
    await expect(page).toHaveURL(/\/questionnaire$/);
});
