import { expect, test } from "@playwright/test";
import { buildRectRoom, openAutoLayoutWithBed } from "./project-flow";

test("preference first screen keeps its image preload budget", async ({ page }) => {
    await page.goto("/test", { waitUntil: "networkidle" });

    const imageBudget = await page.evaluate(() => {
        const resources = performance
            .getEntriesByType("resource")
            .filter((entry) =>
                entry.name.includes("/test-images.20260716-v1/"),
            ) as PerformanceResourceTiming[];

        return {
            count: new Set(resources.map((entry) => entry.name)).size,
            encodedBytes: resources.reduce((total, entry) => total + entry.encodedBodySize, 0),
        };
    });

    expect(imageBudget.count).toBeLessThanOrEqual(6);
    expect(imageBudget.encodedBytes).toBeLessThanOrEqual(1_600_000);
});

test("preference progress, neutral choices and back survive reload", async ({ page }) => {
    await page.goto("/test", { waitUntil: "networkidle" });

    await expect(page.getByText(/Сравнение 1 из 18/)).toBeVisible();
    await page.getByRole("button", { name: "Нравятся оба" }).click();
    await expect(page.getByText(/Сравнение 2 из 18/)).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(/Сравнение 2 из 18/)).toBeVisible();

    await page.keyboard.press("Backspace");
    await expect(page.getByText(/Сравнение 1 из 18/)).toBeVisible();
    await page.getByRole("button", { name: "Не нравится ни один" }).click();
    await expect(page.getByText(/Сравнение 2 из 18/)).toBeVisible();
});

test("desktop golden path reaches an editable and exportable plan", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop-chromium", "Full flow runs once on desktop");

    await page.goto("/test", { waitUntil: "networkidle" });

    for (let step = 1; step <= 18; step += 1) {
        await expect(page.getByText(new RegExp(`Сравнение ${step} из 18`))).toBeVisible();
        await page.getByRole("button", { name: "Выбрать левое изображение" }).click();
    }

    await expect(page.getByRole("heading", { name: /Основное направление/i })).toHaveCount(0);
    await expect(page.getByText("Основное направление", { exact: true })).toBeVisible();

    await expect(page.getByText("ОПИСАНИЕ СТИЛЯ", { exact: true })).toBeVisible();
    const resultGallery = page.locator('[aria-roledescription="карусель"]');
    await expect(resultGallery).toBeVisible();
    await expect(resultGallery.locator("figcaption strong")).toHaveText("Гостиная");
    await expect(resultGallery.locator("img")).toHaveAttribute("alt", /Гостиная/i);

    await resultGallery.getByRole("button", { name: "Показать следующую визуализацию" }).click();
    await expect(resultGallery.locator("figcaption strong")).toHaveText("Спальня");

    await resultGallery.focus();
    await page.keyboard.press("ArrowRight");
    await expect(resultGallery.locator("figcaption strong")).toHaveText("Детская");

    // Straight from the style to the apartment planner: no questionnaire on the way.
    await page.getByRole("link", { name: "Перейти к планировке" }).click();
    await expect(page).toHaveURL(/\/planner(\?|$)/);
    const steps = page.getByRole("navigation", { name: "Шаги проекта" });
    await expect(steps.locator('[data-step="style"]')).toHaveAttribute("data-status", "done");
    await expect(steps.locator('[data-step="plan"]')).toHaveAttribute("data-status", "current");
    await expect(steps.locator('[data-step="result"]')).toHaveAttribute("data-status", "locked");

    await buildRectRoom(page);
    await page.locator("[data-draw-room-step='rooms']").click();
    await page.locator("[data-draw-room-region-item] select").first().selectOption("bedroom");

    // A bed is put in by hand, then «Авторасстановка» finds it a better place.
    await page.locator("[data-draw-room-step='furniture']").click();
    const auto = await openAutoLayoutWithBed(page);
    await auto.getByRole("button", { name: "Подобрать", exact: true }).click();
    await auto.locator("[data-auto-layout-variant='0']").click({ timeout: 60_000 });
    const pieces = page.locator("[data-draw-furniture^='furniture-']");
    await expect(pieces).not.toHaveCount(0);
    await expect(steps.locator('[data-step="result"]')).toHaveAttribute("data-status", "done");

    await page.locator("[data-draw-room-step='result']").click();
    const result = page.locator("[data-draw-room-result='true']");
    await expect(result).toContainText("Двуспальная кровать");
    const downloadPromise = page.waitForEvent("download");
    await result.getByRole("button", { name: "Скачать PNG" }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.png$/i);

    await page.evaluate(() => {
        window.print = () => {
            document.body.dataset.printCalled = "true";
        };
    });
    await result.getByRole("button", { name: "Печать" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-print-called", "true", {
        timeout: 20_000,
    });

    // The plan, with its furniture, is still there after a reload.
    const placed = await pieces.count();
    await page.reload({ waitUntil: "networkidle" });
    await expect(pieces).toHaveCount(placed);
});
