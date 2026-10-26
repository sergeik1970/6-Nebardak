import { buildRectRoom, openAutoLayoutWithBed } from "../e2e/project-flow";
import { expect, expectSaved, loginByUi, projectBar, registerByUi, test } from "./support";

test("a guest's finished project moves into the new account and opens on another device", async ({
    page,
    browser,
}) => {
    // A room drawn and furnished in the planner, all as a guest: a bed put in
    // by hand, then arranged automatically.
    await page.goto("/planner", { waitUntil: "networkidle" });
    await expect(projectBar(page)).toContainText("Хранится только в этом браузере");
    await buildRectRoom(page, "5", "4");
    await page.locator("[data-draw-room-step='rooms']").click();
    await page.locator("[data-draw-room-region-item] select").first().selectOption("bedroom");
    await page.locator("[data-draw-room-step='furniture']").click();
    const auto = await openAutoLayoutWithBed(page);
    await auto.getByRole("button", { name: "Подобрать", exact: true }).click();
    await auto.locator("[data-auto-layout-variant='0']").click({ timeout: 60_000 });
    const pieces = page.locator("[data-draw-furniture^='furniture-']");
    await expect(pieces).not.toHaveCount(0);
    const placed = await pieces.count();

    // Signing up (from a page with the site header) takes the draft along
    // and continues inside the new project.
    await page.goto("/test", { waitUntil: "networkidle" });
    const account = await registerByUi(page);
    await expect(page).toHaveURL(/[?&]project=[0-9a-f-]{36}/, { timeout: 30_000 });
    await expectSaved(page);
    await expect(projectBar(page)).toContainText("Проект 1");
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
    await expect(other.locator("[data-draw-furniture^='furniture-']")).toHaveCount(placed);
    await otherDevice.close();
});
