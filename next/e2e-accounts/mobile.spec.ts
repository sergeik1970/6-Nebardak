import type { Page } from "@playwright/test";
import {
    createProjectByApi,
    expect,
    expectSaved,
    newAccount,
    projectBar,
    projectDocument,
    test,
} from "./support";

const horizontalOverflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("@mobile account pages and every project step fit a phone", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "networkidle" });
    // The sign-up dialog works from the phone menu's page too.
    await page.getByRole("main").getByRole("button", { name: "Войти" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Зарегистрироваться" }).click();
    const account = newAccount("Телефон");
    await dialog.getByPlaceholder("Введите ваше имя").fill(account.name);
    await dialog.getByPlaceholder("name@example.com").fill(account.email);
    await dialog.getByPlaceholder("Введите пароль").fill(account.password);
    await dialog.getByText("Я даю согласие на обработку моих персональных данных").click();
    await dialog.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "Проектов пока нет" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const project = await createProjectByApi(page, projectDocument(), "Телефон");
    for (const path of ["/test", "/planner/draw", "/planner"]) {
        await page.goto(`${path}?project=${project.id}`, { waitUntil: "networkidle" });
        await expectSaved(page);
        const bar = projectBar(page);
        await expect(bar.getByRole("navigation", { name: "Шаги проекта" })).toBeVisible();
        expect(await horizontalOverflow(page), `${path} overflows`).toBeLessThanOrEqual(0);
        const box = await bar.boundingBox();
        expect(box?.height ?? 0, `${path} bar height`).toBeLessThanOrEqual(110);
    }

    // The room editor stays a full-screen tool under the bar.
    await page.goto(`/planner/draw?project=${project.id}`, { waitUntil: "networkidle" });
    await expectSaved(page);
    expect(
        await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(1);

    for (const path of ["/projects", "/account"]) {
        await page.goto(path, { waitUntil: "networkidle" });
        expect(await horizontalOverflow(page), `${path} overflows`).toBeLessThanOrEqual(0);
    }
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await expect(
        page.getByRole("dialog", { name: "Меню сайта" }).getByRole("link", { name: "Мои проекты" }),
    ).toBeVisible();
});
