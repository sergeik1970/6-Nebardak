import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, registerByApi, test } from "./support";

/**
 * Furnishes a flat rebuilt from a designer's measured plan the way the
 * designer used its rooms, for comparing with the designer's own furniture
 * plan. Runs only with DESIGNER_COMPARE=<plan>, e.g. remplanner-ryazansky:
 * the room purposes and family come from ~/stylefinder-plans/designer/<plan>.json
 * and the model's reading of the plan from the last measurement run. Writes
 * the drawing, a picture and each room's outcome to test-results/designer/<plan>.
 */
const PLAN = process.env.DESIGNER_COMPARE;
const DESIGNER = path.join(os.homedir(), "stylefinder-plans", "designer", `${PLAN}.json`);
const READINGS =
    "test-results/plan-recognition/apartments/openai_gpt-6.1-terra/layout/results.json";
const OUTPUT = path.join("test-results", "designer", PLAN ?? "none");

interface DesignerPlan {
    brief: { adults: number; children: number };
    rooms: { ours: string; kind: string }[];
}

test("a rebuilt flat furnished as the designer used its rooms", async ({ page }) => {
    test.skip(!PLAN, "DESIGNER_COMPARE=<plan> compares with a designer's plan");
    test.setTimeout(900_000);
    const designer = JSON.parse(fs.readFileSync(DESIGNER, "utf8")) as DesignerPlan;
    const reading = (
        JSON.parse(fs.readFileSync(READINGS, "utf8")) as { name: string; answer: string }[]
    ).find((result) => result.name === PLAN);
    if (!reading) throw new Error(`No model reading of ${PLAN} in ${READINGS}`);
    const answer = JSON.parse(reading.answer.replace(/^```(?:json)?\s*|```\s*$/g, ""));

    await registerByApi(page);
    await page.route("**/api/plan-recognition", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ answer, model: "saved", ms: 1 }),
        }),
    );
    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.getByText("Проект", { exact: true }).click();
    await page.getByRole("button", { name: "Загрузить план квартиры" }).click();
    const dialog = page.getByRole("dialog", { name: "Загрузить план" });
    await dialog.getByRole("checkbox").check();
    const picture = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#ffffff" },
    })
        .png()
        .toBuffer();
    await dialog
        .getByLabel("Файл плана")
        .setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: picture });
    await expect(dialog.getByRole("radio", { name: /Вся квартира/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Открыть в редакторе" }).click();
    await expect(dialog).toBeHidden();

    // The rooms are used as the designer used them.
    await page.locator("[data-draw-room-step='rooms']").click();
    for (const item of await page.locator("[data-draw-room-region-item]").all()) {
        const name = await item.locator("input").inputValue();
        const room = designer.rooms.find((candidate) => candidate.ours === name);
        if (!room) continue;
        await item.locator("select").selectOption(room.kind);
        // Bathrooms are kept on the plan but not designed yet; the notice says so once.
        const notice = page.getByRole("dialog", { name: "Кухня и ванная пока недоступны" });
        if (await notice.isVisible()) await notice.getByRole("button", { name: "Понятно" }).click();
    }

    await page.locator("[data-draw-room-step='furniture']").click();
    await page.locator("[data-furniture-auto-layout]").click();
    const apartment = page.locator("[data-apartment-furnish='true']");
    await apartment.getByRole("button", { name: "Обставить квартиру" }).click();
    const brief = page.getByRole("dialog", { name: "Расскажите о семье" });
    await brief.getByLabel("Взрослых спит постоянно").fill(String(designer.brief.adults));
    await brief.getByLabel("Детей от 3 лет").fill(String(designer.brief.children));
    await brief.getByRole("button", { name: "Сохранить и обставить" }).click();
    await expect(apartment.getByRole("status").first()).toContainText("Обставлено комнат", {
        timeout: 800_000,
    });

    fs.mkdirSync(OUTPUT, { recursive: true });
    const outcomes = [await apartment.getByRole("status").first().textContent()];
    for (const outcome of await apartment.locator("[data-apartment-furnish-outcome]").all())
        outcomes.push(
            `[${await outcome.getAttribute("data-apartment-furnish-outcome")}] ${(await outcome.textContent())?.replace(/\s+/g, " ")}`,
        );
    fs.writeFileSync(path.join(OUTPUT, "outcomes.txt"), `${outcomes.join("\n")}\n`);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Вместить" }).click();
    await page.screenshot({ path: path.join(OUTPUT, "ours.png") });

    await page.getByText("Проект", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать чертёж" }).click();
    await (await download).saveAs(path.join(OUTPUT, "drawing.json"));
});
