import { expect, test } from "@playwright/test";

const PROJECT_DRAFT_KEY = "stylefinder:project-draft:v4";

test("designer observations are not kept as local comments when database access is unavailable", async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop-chromium", "Runs once on desktop");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate((key) => localStorage.removeItem(key), PROJECT_DRAFT_KEY);

    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("button", { name: "Уместить всё" })).toBeEnabled({
        timeout: 60_000,
    });

    await expect(
        page.getByText("Войдите, чтобы результаты сохранялись в базе для разбора."),
    ).toBeVisible();
    await expect(page.getByText("Один общий комментарий дизайнера", { exact: true })).toBeVisible();
    await expect(
        page.evaluate(
            (key) =>
                JSON.parse(localStorage.getItem(key) ?? "null")?.planner?.designLab?.feedback ?? [],
            PROJECT_DRAFT_KEY,
        ),
    ).resolves.toEqual([]);
});
