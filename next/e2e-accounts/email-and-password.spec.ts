import { PASSWORD, expect, linkFromMail, loginByApi, registerByApi, test } from "./support";

test("the verification letter confirms the address", async ({ page }) => {
    const account = await registerByApi(page);
    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByText(/Подтвердите почту: мы отправили ссылку/)).toBeVisible();

    await page.goto(await linkFromMail(account.email, "/auth/verify"));
    await expect(page.getByText(/Почта подтверждена/)).toBeVisible();
    // The token is taken out of the address bar once read.
    await expect(page).toHaveURL(/\/auth\/verify$/);

    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByText(/Подтвердите почту: мы отправили ссылку/)).toHaveCount(0);

    // A used link does not work twice.
    await page.goto(await linkFromMail(account.email, "/auth/verify"));
    await expect(
        page.getByText("Ссылка недействительна или устарела.", { exact: false }),
    ).toBeVisible();
});

test("a password reset signs out every other device and replaces the old password", async ({
    page,
    browser,
}) => {
    const account = await registerByApi(page);
    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Личный кабинет" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Вы не вошли" })).toHaveCount(0);

    // Someone who forgot the password, on another device.
    const otherDevice = await browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": "10.251.0.1" },
    });
    const other = await otherDevice.newPage();
    await other.goto("/auth/forgot", { waitUntil: "networkidle" });
    await other.getByLabel("Email").fill(account.email);
    await other.getByRole("button", { name: "Получить ссылку" }).click();
    await expect(other.getByText(/Если аккаунт с адресом .* существует/)).toBeVisible();

    // An unknown address gets exactly the same answer.
    await other.getByRole("button", { name: "Отправить ещё раз" }).click();
    await other.getByLabel("Email").fill("nobody-here@example.test");
    await other.getByRole("button", { name: "Получить ссылку" }).click();
    await expect(other.getByText(/Если аккаунт с адресом .* существует/)).toBeVisible();

    const newPassword = "brand-new-password-7";
    await other.goto(await linkFromMail(account.email, "/auth/reset"));
    await other.getByRole("textbox", { name: "Новый пароль" }).fill(newPassword);
    await other.getByLabel("Повторите пароль").fill(newPassword);
    await other.getByRole("button", { name: "Сохранить пароль" }).click();
    await expect(other.getByText(/Пароль изменён, вы вошли в аккаунт/)).toBeVisible();
    await otherDevice.close();

    // The first device's session is gone.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Вы не вошли" })).toBeVisible();

    expect((await loginByApi(page.request, { ...account, password: PASSWORD })).status()).toBe(401);
    expect((await loginByApi(page.request, { ...account, password: newPassword })).status()).toBe(
        200,
    );
});
