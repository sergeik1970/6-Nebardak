import { expect, test } from "@playwright/test";

test("mobile menu traps focus, closes safely and restores the page", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile navigation runs once");

    await page.goto("/", { waitUntil: "networkidle" });
    const trigger = page.locator('button[aria-controls="mobile-navigation"]');
    await expect(trigger).toHaveAccessibleName("Открыть меню");
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Меню сайта" });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveCSS("visibility", "hidden");
    await expect(dialog.getByRole("button", { name: "Закрыть меню" })).toHaveCount(1);
    await expect(dialog.getByText("×", { exact: true })).toHaveCount(1);
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("main")).toHaveAttribute("inert", "");

    const first = dialog.getByRole("link", { name: "StyleFinder" });
    const last = dialog.getByRole("link", { name: "Тест" });
    await expect(first).toBeFocused();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator("main")).not.toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

    await trigger.click();
    await page.locator('[data-mobile-menu-backdrop="true"]').dispatchEvent("pointerdown");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
});

test("auth-off clears a legacy local session without making auth requests", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Auth-off contract runs once");

    const authRequests: string[] = [];
    page.on("request", (request) => {
        if (/\/api\/auth(?:\/|$)/.test(request.url())) authRequests.push(request.url());
    });
    await page.addInitScript(() => {
        localStorage.setItem("token", "legacy-token");
        localStorage.setItem("user", JSON.stringify({ id: 1, name: "Legacy", email: "old@test" }));
    });

    await page.goto("/", { waitUntil: "networkidle" });

    const authControlVisible =
        (await page.getByRole("button", { name: /войти|регистрац/i }).count()) > 0;
    test.skip(authControlVisible, "Auth-off contract does not apply to an auth-enabled build.");

    await expect
        .poll(() =>
            page.evaluate(() => ({
                token: localStorage.getItem("token"),
                user: localStorage.getItem("user"),
            })),
        )
        .toEqual({ token: null, user: null });
    expect(authRequests).toEqual([]);
    await expect(page.getByRole("button", { name: /войти|регистрац/i })).toHaveCount(0);
});

test("beta status is honest and reduced-motion removes navigation animation", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Status UI runs once on mobile");

    await page.emulateMedia({ reducedMotion: "reduce" });
    // A page with the site header; the full-screen planner has its own bar.
    await page.goto("/test", { waitUntil: "networkidle" });

    await expect(page.getByLabel("Бета-версия сайта")).toHaveText("Бета");
    const transitionDuration = await page
        .getByRole("button", { name: "Открыть меню" })
        .locator("span")
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("home exposes one product heading and mobile test keeps the visual pair together", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile semantic UI runs once");

    await page.goto("/", { waitUntil: "networkidle" });
    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText("Подбор стиля, мебели и планировки комнаты");

    await page.goto("/test", { waitUntil: "networkidle" });
    const choices = page.getByRole("button", { name: /Выбрать (левое|правое) изображение/ });
    await expect(choices).toHaveCount(2);
    const boxes = await choices.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().toJSON()),
    );
    // One above the other, large enough to judge, and both on one screen.
    expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
    expect(Math.abs(boxes[0].left - boxes[1].left)).toBeLessThanOrEqual(1);
    expect(boxes.every((box) => box.width >= 220 && box.width === box.height)).toBe(true);
    expect(boxes[1].bottom - boxes[0].top).toBeLessThanOrEqual(
        page.viewportSize()?.height ?? Infinity,
    );
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
    ).toBeLessThanOrEqual(1);
});
