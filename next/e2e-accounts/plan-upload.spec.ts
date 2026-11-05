import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, registerByApi, test } from "./support";

/** Any small picture will do: the model's answer is stubbed. */
const planPicture = () =>
    sharp({ create: { width: 64, height: 48, channels: 3, background: "#ffffff" } })
        .png()
        .toBuffer();

const ANSWER = {
    units_on_drawing: "mm",
    rooms: [
        {
            name: "Спальня",
            estimated: false,
            contour: [
                { x: 0, y: 0 },
                { x: 4000, y: 0 },
                { x: 4000, y: 3000 },
                { x: 0, y: 3000 },
            ],
            openings: [
                { kind: "window", wall: 0, offset: 1200, width: 1500 },
                { kind: "door", wall: 2, offset: 300, width: 800 },
            ],
        },
        { name: "Туалет", estimated: true, contour: [], openings: [] },
    ],
};

test("a signed-in person opens one room of an uploaded plan in the editor", async ({ page }) => {
    await registerByApi(page);
    let sent: { mimeType?: string; image?: string } = {};
    await page.route("**/api/plan-recognition", async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ answer: ANSWER, model: "stub", ms: 10 }),
        });
    });
    await page.goto("/planner", { waitUntil: "networkidle" });

    await page.getByText("Проект", { exact: true }).click();
    await page.getByRole("button", { name: "Загрузить план квартиры" }).click();
    const dialog = page.getByRole("dialog", { name: "Загрузить план" });
    const choose = dialog.getByRole("button", { name: "Выбрать файл плана" });
    await expect(choose).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(choose).toBeEnabled();

    await dialog
        .getByLabel("Файл плана")
        .setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: await planPicture() });

    // The browser re-encodes the picture before sending it.
    await expect(dialog.getByRole("radio", { name: /Спальня/ })).toBeChecked();
    expect(sent.mimeType).toBe("image/jpeg");
    expect(sent.image?.length).toBeGreaterThan(100);
    await expect(dialog.getByText("12 м²")).toBeVisible();
    await expect(dialog.getByText("· Спальня")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /Туалет/ })).toBeDisabled();
    await expect(dialog.getByText("На плане нет размеров этой комнаты.")).toBeVisible();

    await dialog.getByRole("button", { name: "Открыть в редакторе" }).click();
    await expect(dialog).toBeHidden();
    await page.getByText("Проект", { exact: true }).click();
    await expect(page.getByText("Комната «Спальня» открыта с плана.")).toBeVisible();

    await page.locator("[data-draw-room-step='rooms']").click();
    const region = page.locator("[data-draw-room-region-item]");
    await expect(region).toHaveCount(1);
    // The sheet's name and the kind it implies come along.
    await expect(region.locator("input")).toHaveValue("Спальня");
    await expect(region.locator("select")).toHaveValue("bedroom");
});

test("a signed-in person opens the whole apartment of an uploaded plan", async ({ page }) => {
    await registerByApi(page);
    await page.route("**/api/plan-recognition", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                model: "stub",
                ms: 10,
                answer: {
                    rooms: [
                        {
                            name: "Спальня",
                            contour: [
                                { x: 0, y: 0 },
                                { x: 4000, y: 0 },
                                { x: 4000, y: 3000 },
                                { x: 0, y: 3000 },
                            ],
                            openings: [
                                { kind: "window", wall: 0, offset: 1200, width: 1500 },
                                { kind: "door", wall: 1, offset: 1000, width: 800 },
                            ],
                        },
                        {
                            name: "Гостиная",
                            contour: [
                                { x: 4150, y: 0 },
                                { x: 9150, y: 0 },
                                { x: 9150, y: 3000 },
                                { x: 4150, y: 3000 },
                            ],
                            openings: [{ kind: "window", wall: 0, offset: 1500, width: 1800 }],
                        },
                    ],
                },
            }),
        }),
    );
    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.getByText("Проект", { exact: true }).click();
    await page.getByRole("button", { name: "Загрузить план квартиры" }).click();
    const dialog = page.getByRole("dialog", { name: "Загрузить план" });
    await dialog.getByRole("checkbox").check();
    await dialog
        .getByLabel("Файл плана")
        .setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: await planPicture() });

    await expect(dialog.getByRole("radio", { name: /Вся квартира/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Открыть в редакторе" }).click();
    await expect(dialog).toBeHidden();

    await page.locator("[data-draw-room-step='rooms']").click();
    const regions = page.locator("[data-draw-room-region-item]");
    await expect(regions).toHaveCount(2);
    await expect(regions.locator("input").nth(0)).toHaveValue(/Спальня|Гостиная/);
    await expect(regions.locator("input").nth(1)).toHaveValue(/Спальня|Гостиная/);
});

test("the server refuses plan reading to guests and while it is switched off", async ({ page }) => {
    const body = { mimeType: "image/png", image: "A".repeat(200) };
    const headers = { "X-Requested-With": "stylefinder" };

    const guest = await page.request.post("/api/plan-recognition", { data: body, headers });
    expect(guest.status()).toBe(401);

    if (process.env.PLAN_UPLOAD_LIVE) return;
    await registerByApi(page);
    const off = await page.request.post("/api/plan-recognition", { data: body, headers });
    expect(off.status()).toBe(404);
});

const LIVE_PLAN = path.join(os.homedir(), "stylefinder-plans", "apartments", "bti-resog-4k.jpg");

test("a real BTI plan is read through the relay and the whole flat opens", async ({ page }) => {
    test.skip(!process.env.PLAN_UPLOAD_LIVE, "PLAN_UPLOAD_LIVE=1 asks the real model");
    test.setTimeout(400_000);
    await registerByApi(page);
    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.getByText("Проект", { exact: true }).click();
    await page.getByRole("button", { name: "Загрузить план квартиры" }).click();
    const dialog = page.getByRole("dialog", { name: "Загрузить план" });
    await dialog.getByRole("checkbox").check();
    await dialog.getByLabel("Файл плана").setInputFiles(LIVE_PLAN);

    const whole = dialog.getByRole("radio", { name: /Вся квартира/ });
    await expect(whole).toBeChecked({ timeout: 360_000 });
    expect(await dialog.getByRole("radio").count()).toBeGreaterThanOrEqual(9);
    fs.mkdirSync("test-results/plan-upload", { recursive: true });
    await dialog.screenshot({ path: "test-results/plan-upload/live-list.png" });
    await dialog.getByRole("button", { name: "Открыть в редакторе" }).click();
    await expect(dialog).toBeHidden();
    await page.locator("[data-draw-room-step='rooms']").click();
    expect(await page.locator("[data-draw-room-region-item]").count()).toBeGreaterThanOrEqual(8);
    await page.getByRole("button", { name: "Вместить" }).click();
    fs.mkdirSync("test-results/plan-upload", { recursive: true });
    await page.screenshot({ path: "test-results/plan-upload/live-room.png" });
});
