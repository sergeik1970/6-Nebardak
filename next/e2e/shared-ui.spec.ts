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
    await page.goto("/planner", { waitUntil: "networkidle" });

    await expect(page.getByLabel("Бета-версия сайта")).toHaveText("Бета");
    const transitionDuration = await page
        .getByRole("button", { name: "Открыть меню" })
        .locator("span")
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("questionnaire keeps hierarchy, readable text and touch targets at key widths", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Viewport matrix runs once");

    for (const width of [320, 375, 768, 900, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/questionnaire", { waitUntil: "networkidle" });
        await page.getByRole("radio", { name: "Односпальная", exact: true }).check();

        const audit = await page.evaluate(() => {
            const isVisible = (element: Element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0;
            };
            const textTooSmall = Array.from(document.querySelectorAll("main *"))
                .filter(
                    (element) =>
                        isVisible(element) &&
                        element.children.length === 0 &&
                        (element.textContent?.trim().length ?? 0) > 0 &&
                        Number.parseFloat(getComputedStyle(element).fontSize) < 12,
                )
                .map((element) => ({
                    text: element.textContent?.trim().slice(0, 60),
                    size: getComputedStyle(element).fontSize,
                }));
            const smallTargets = Array.from(
                document.querySelectorAll<HTMLElement>(
                    "main button:not([disabled]), main a[href], main select",
                ),
            )
                .filter(isVisible)
                .filter((element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.width < 44 || rect.height < 44;
                })
                .map((element) => ({
                    text: element.textContent?.trim().slice(0, 60),
                    rect: element.getBoundingClientRect().toJSON(),
                }));
            const sectionAir = Array.from(document.querySelectorAll("form > fieldset"))
                .slice(0, 3)
                .map((fieldset) => {
                    const legend = fieldset.querySelector("legend");
                    const choices = fieldset.querySelector(
                        '[class*="choiceGrid"], [class*="wardrobeGrid"]',
                    );
                    if (!legend || !choices) return 0;
                    return (
                        choices.getBoundingClientRect().top - legend.getBoundingClientRect().bottom
                    );
                });

            const form = document.querySelector("main form")?.getBoundingClientRect();
            const summary = document
                .querySelector('main aside[aria-label="Выбранный комплект комнаты"]')
                ?.getBoundingClientRect();

            return {
                overflow:
                    document.documentElement.scrollWidth - document.documentElement.clientWidth,
                formBottom: form?.bottom ?? 0,
                sectionAir,
                smallTargets,
                summaryTop: summary?.top ?? 0,
                textTooSmall,
            };
        });

        expect(audit.overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
        expect(audit.textTooSmall, `text below 12px at ${width}px`).toEqual([]);
        expect(audit.smallTargets, `targets below 44px at ${width}px`).toEqual([]);
        expect(
            audit.sectionAir.every((space) => space >= 16),
            `legend spacing at ${width}px: ${audit.sectionAir.join(", ")}`,
        ).toBe(true);
        if (width <= 900) {
            expect(audit.summaryTop, `summary order at ${width}px`).toBeGreaterThanOrEqual(
                audit.formBottom,
            );
        }
        if (width <= 760) {
            const compactSummary = page.getByRole("status").filter({ hasText: "Выбрано" });
            await expect(compactSummary).toBeVisible();
            await expect(compactSummary).toContainText("Выбрано");
            await expect(compactSummary).not.toContainText("Комплект комнаты");
        }
    }
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
    expect(Math.abs(boxes[0].top - boxes[1].top)).toBeLessThanOrEqual(1);
    expect(boxes.every((box) => box.width >= 150 && box.height >= 110)).toBe(true);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
    ).toBeLessThanOrEqual(1);
});
