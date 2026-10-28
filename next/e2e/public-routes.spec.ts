import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_ROUTES = [
    { path: "/", name: "главная" },
    { path: "/test", name: "тест предпочтений" },
    { path: "/planner", name: "планировщик" },
    { path: "/privacy", name: "политика обработки данных" },
    { path: "/consent", name: "согласие на обработку данных" },
    { path: "/analytics-consent", name: "согласие на веб-аналитику" },
    { path: "/account", name: "личный кабинет" },
    { path: "/auth/forgot", name: "восстановление пароля" },
] as const;

const captureRuntimeErrors = (page: Page) => {
    const errors: string[] = [];

    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    return errors;
};

for (const route of PUBLIC_ROUTES) {
    test(`${route.name}: renders without runtime, overflow or serious accessibility errors`, async ({
        page,
    }) => {
        const runtimeErrors = captureRuntimeErrors(page);
        const response = await page.goto(route.path, { waitUntil: "networkidle" });

        expect(response?.ok(), `HTTP response for ${route.path}`).toBe(true);
        await expect(page.locator("main")).toBeVisible();

        const overflows = await page.evaluate(() => {
            const root = document.documentElement;
            return {
                clientWidth: root.clientWidth,
                scrollWidth: root.scrollWidth,
            };
        });
        expect(overflows.scrollWidth).toBeLessThanOrEqual(overflows.clientWidth + 1);

        // Entrance animations fade content in; axe would measure contrast mid-fade.
        await page.evaluate(() =>
            Promise.all(
                document
                    .getAnimations()
                    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
                    .map((animation) => animation.finished),
            ),
        );

        const accessibility = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
        const blockingViolations = accessibility.violations.filter((violation) =>
            ["serious", "critical"].includes(violation.impact ?? ""),
        );

        expect(blockingViolations, JSON.stringify(blockingViolations, null, 2)).toEqual([]);
        expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
    });
}

test("unknown route has a Russian recovery path", async ({ page }) => {
    const response = await page.goto("/takoy-stranitsy-net", { waitUntil: "networkidle" });

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /страниц/i })).toBeVisible();
    await expect(
        page.getByRole("main").getByRole("link", { name: "Вернуться на главную", exact: true }),
    ).toBeVisible();
});

test("the 404 card fits a 320 px phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Narrow phone is covered once");
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/takoy-stranitsy-net", { waitUntil: "networkidle" });

    const heading = page.getByRole("heading", { name: /страниц/i });
    await expect(heading).toBeVisible();
    const fit = await heading.evaluate((element) => {
        const card = element.parentElement!.getBoundingClientRect();
        return {
            pageWidth: document.documentElement.scrollWidth,
            cardRight: card.right,
            headingOverflow: element.scrollWidth - element.clientWidth,
        };
    });
    expect(fit.pageWidth).toBeLessThanOrEqual(320);
    expect(fit.cardRight).toBeLessThanOrEqual(320);
    expect(fit.headingOverflow).toBeLessThanOrEqual(0);
});

test("home offers direct planning alongside the style-detection path", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const plannerCta = page.getByRole("link", { name: "Спланировать комнату", exact: true });
    await expect(plannerCta).toBeVisible();
    await expect(plannerCta).toHaveAttribute("href", "/planner");

    const styleCta = page.getByRole("link", { name: "Определить стиль", exact: true });
    await expect(styleCta).toBeVisible();
    await expect(styleCta).toHaveAttribute("href", "/test");
});
