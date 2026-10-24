import { buildRectRoom } from "../e2e/project-flow";
import { expect, registerByApi, test } from "./support";

test("a signed-in person sends a solved variant to the designer review queue", async ({ page }) => {
    await registerByApi(page);
    await page.goto("/planner", { waitUntil: "networkidle" });
    await buildRectRoom(page, "5", "4");
    await page.locator("[data-draw-room-step='rooms']").click();
    await page.locator("[data-draw-room-region-item] select").first().selectOption("bedroom");
    await page.locator("[data-draw-room-step='furniture']").click();

    const auto = page.locator("[data-draw-room-auto-layout='true']");
    await auto.getByRole("button", { name: "Подобрать расстановку" }).click();
    // Each offered variant is saved for the review queue as it is solved.
    const saved = page.waitForResponse(
        (response) =>
            response.url().endsWith("/api/planner-observations") &&
            response.request().method() === "POST",
    );
    await auto.getByRole("button", { name: "Подобрать", exact: true }).click();
    expect((await saved).status()).toBe(201);
    await auto.locator("[data-auto-layout-variant='0']").click({ timeout: 60_000 });

    const review = auto.locator("[data-auto-layout-review='true']");
    await review.getByLabel("Оценка варианта").selectOption("needs-fix");
    // A multi-line note goes as one line: the review API refuses control characters.
    await review.getByLabel("Что не так или что удалось").fill("Кровать у окна.\nШкаф далеко.");
    const reviewed = page.waitForResponse(
        (response) =>
            /\/api\/planner-observations\/\d+\/review$/.test(response.url()) &&
            response.request().method() === "PATCH",
    );
    await review.getByRole("button", { name: "Отправить на разбор" }).click();
    const response = await reviewed;
    expect(response.status()).toBe(200);
    expect((await response.json()).review).toMatchObject({
        verdict: "needs-fix",
        comment: "Кровать у окна. Шкаф далеко.",
    });
    await expect(review).toContainText("Отзыв отправлен на разбор");
});
