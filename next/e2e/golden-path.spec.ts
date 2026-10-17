import { expect, test } from "@playwright/test";

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

    await page.getByRole("link", { name: "Перейти к мебели" }).click();

    await expect(page).toHaveURL(/\/questionnaire\?/);
    await page.getByLabel("Односпальная").check();
    await page.getByRole("checkbox", { name: /Книжный шкаф/ }).check();
    await Promise.all([
        page.waitForURL(/\/planner\?handoff=/, { timeout: 60_000, waitUntil: "commit" }),
        page.getByRole("button", { name: "Перейти к расстановке" }).click(),
    ]);
    await expect(page.getByText(/Набор получен из анкеты/)).toBeVisible();
    await page.getByRole("button", { name: "Уместить всё" }).click();

    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });

    const furniture = page
        .getByRole("button", { name: /^Односпальная кровать(?: · \d+)?,/ })
        .first();
    await furniture.click();
    await page.getByRole("button", { name: "Повернуть на 90°" }).click();
    const undo = page.getByRole("button", { name: /Отменить/ });
    await expect(undo).toBeEnabled();
    await undo.click();

    const bookcase = page.getByRole("button", { name: /^Книжный шкаф(?: · \d+)?,/ }).first();
    await bookcase.click();
    await page.getByRole("button", { name: "Убрать предмет", exact: true }).click();
    const removalDialog = page.getByRole("dialog", { name: "Убрать предмет из планировки?" });
    await removalDialog.getByRole("button", { name: "Убрать предмет", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Удалено из проекта" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать PNG" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/i);

    await page.evaluate(() => {
        window.print = () => {
            document.body.dataset.printCalled = "true";
        };
    });
    await page.getByRole("button", { name: "Печать / сохранить PDF" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-print-called", "true");

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("group", { name: /План комнаты \d+/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Удалено из проекта" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Проверено алгоритмом" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ограничения и допущения" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Печать / сохранить PDF" })).toBeHidden();
    const pdf = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
    });
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    await testInfo.attach("stylefinder-golden-plan.pdf", {
        body: pdf,
        contentType: "application/pdf",
    });
    await page.emulateMedia({ media: "screen" });

    await page.reload();
    await expect(
        page.getByRole("button", { name: /^Односпальная кровать(?: · \d+)?,/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Отменить/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Вернуть/ })).toBeDisabled();
});
