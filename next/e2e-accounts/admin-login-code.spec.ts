import { expect, grantAdmin, loginByApi, loginCodeFromMail, registerByApi, test } from "./support";

const openLoginDialog = async (page: import("@playwright/test").Page) => {
    await page
        .getByRole("navigation", { name: "Основная навигация" })
        .getByRole("button", { name: /Войти/ })
        .first()
        .click();
    return page.getByRole("dialog");
};

test("an administrator signs in only with the emailed code", async ({ page, browser }) => {
    const account = await registerByApi(page);
    grantAdmin(account.email);

    // Elevation ends the sessions that never passed the code.
    await page.goto("/admin/planner-observations", { waitUntil: "networkidle" });
    await expect(page.getByText("Доступ ограничен")).toBeVisible();

    // The password alone opens no session.
    const passwordOnly = await loginByApi(page.request, account);
    expect(passwordOnly.status()).toBe(200);
    expect(passwordOnly.headers()["set-cookie"]).toBeUndefined();
    expect((await passwordOnly.json()).user).toBeNull();
    const staleCode = await loginCodeFromMail(account.email);

    const dialog = await openLoginDialog(page);
    await dialog.getByPlaceholder("name@example.com").fill(account.email);
    await dialog.getByPlaceholder("Введите пароль").fill(account.password);
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog.getByRole("heading", { name: "Код из письма" })).toBeVisible();
    const firstCode = await loginCodeFromMail(account.email, staleCode);

    // The API-started code was replaced by this sign-in.
    const codeField = dialog.getByLabel("Код подтверждения");
    await codeField.fill(firstCode === "000000" ? "111111" : "000000");
    await dialog.getByRole("button", { name: "Подтвердить" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/Неверный код. Осталось попыток: 4/);

    // A fresh code invalidates the first one.
    await dialog.getByRole("button", { name: "Отправить новый код" }).click();
    await expect(dialog.getByText("Отправили новый код")).toBeVisible();
    const secondCode = await loginCodeFromMail(account.email, firstCode);

    await codeField.fill(secondCode);
    await dialog.getByRole("button", { name: "Подтвердить" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/admin/planner-observations", { waitUntil: "networkidle" });
    await expect(page.getByText("в текущей выборке")).toBeVisible();
    await expect(page.getByText("Доступ ограничен")).toHaveCount(0);
    expect((await page.request.get("/api/admin/planner-observations")).status()).toBe(200);

    // A spent code does not open a second browser.
    const other = await browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": "10.252.0.1" },
    });
    const otherPage = await other.newPage();
    await otherPage.goto("/", { waitUntil: "networkidle" });
    const otherDialog = await openLoginDialog(otherPage);
    await otherDialog.getByPlaceholder("name@example.com").fill(account.email);
    await otherDialog.getByPlaceholder("Введите пароль").fill(account.password);
    await otherDialog.locator('button[type="submit"]').click();
    await expect(otherDialog.getByRole("heading", { name: "Код из письма" })).toBeVisible();
    await otherDialog.getByLabel("Код подтверждения").fill(secondCode);
    await otherDialog.getByRole("button", { name: "Подтвердить" }).click();
    await expect(otherDialog.getByRole("alert")).toHaveText(/Неверный код/);
    await other.close();
});
