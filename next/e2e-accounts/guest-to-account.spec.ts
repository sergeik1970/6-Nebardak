import { continueThroughRoomStep } from "../e2e/project-flow";
import { expect, expectSaved, loginByUi, projectBar, registerByUi, test } from "./support";

test("a guest's finished project moves into the new account and opens on another device", async ({
    page,
    browser,
}) => {
    // Test → questionnaire → room → layout, all as a guest.
    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    await expect(projectBar(page)).toContainText("Хранится только в этом браузере");
    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await page.getByRole("checkbox", { name: /Книжный шкаф/ }).check();
    await continueThroughRoomStep(page, "5", "4");
    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });

    // Signing up takes the draft along and continues inside the new project.
    const account = await registerByUi(page);
    await expect(page).toHaveURL(/[?&]project=[0-9a-f-]{36}/, { timeout: 30_000 });
    await expectSaved(page);
    await expect(projectBar(page)).toContainText("Проект 1");
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible();
    expect(
        await page.evaluate(() => localStorage.getItem("stylefinder:project-draft:v4")),
    ).toBeNull();

    await page.goto("/projects", { waitUntil: "networkidle" });
    const card = page.locator("[data-project-card]");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Есть расстановка");
    await expect(card).toContainText("20 м²");

    // Another device: sign in, open the project, everything is there.
    const otherDevice = await browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": "10.250.0.1" },
    });
    const other = await otherDevice.newPage();
    await other.goto("/projects", { waitUntil: "networkidle" });
    await loginByUi(other, account);
    await other.locator("[data-project-card] h2 a").click();
    // It opens in the apartment planner: the walls with the layout's furniture on them.
    await expect(other).toHaveURL(/\/planner\?project=/);
    await expectSaved(other);
    await expect(other.locator("[data-draw-room-preview='true']")).toBeVisible();
    await expect(other.locator("[data-draw-room-status='contour']")).toContainText("5 м × 4 м");
    await expect(other.locator("[data-draw-furniture^='furniture-']")).toHaveCount(2);
    await otherDevice.close();
});
