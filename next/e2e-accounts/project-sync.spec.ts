import type { Page } from "@playwright/test";
import {
    createProjectByApi,
    expect,
    expectSaved,
    getProjectByApi,
    loginByApi,
    projectBar,
    projectDocument,
    registerByApi,
    test,
} from "./support";

// The planner's own edit for these checks: the room's name on the rooms step.
const roomName = (page: Page) => page.locator("[data-draw-room-region-item] input").first();

const openRooms = async (page: Page) => {
    await page.locator("[data-draw-room-step='rooms']").click();
    await expect(roomName(page)).toBeVisible();
};

const renameRoom = async (page: Page, name: string) => {
    await openRooms(page);
    await roomName(page).fill(name);
    await roomName(page).blur();
    await expect(roomName(page)).toHaveValue(name);
};

const serverRoomName = async (page: Page, projectId: string) => {
    const response = await getProjectByApi(page, projectId);
    const { project } = (await response.json()) as {
        project: { document: { drawing?: { regions?: { items: Array<{ name: string }> } } } };
    };
    return project.document.drawing?.regions?.items[0]?.name ?? null;
};

test("edits made offline are kept and saved once the network returns", async ({
    page,
    context,
}) => {
    await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument(), "Офлайн");
    await page.goto(`/planner?project=${project.id}`, { waitUntil: "networkidle" });
    await expectSaved(page);

    await context.setOffline(true);
    await renameRoom(page, "Спальня у окна");
    await expect(projectBar(page).getByRole("status")).toHaveText(/Нет сети/, {
        timeout: 30_000,
    });

    await context.setOffline(false);
    await expectSaved(page);
    expect(await serverRoomName(page, project.id)).toBe("Спальня у окна");

    await page.reload({ waitUntil: "networkidle" });
    await expectSaved(page);
    await openRooms(page);
    await expect(roomName(page)).toHaveValue("Спальня у окна");
});

test("another tab sees a newer save and picks it up", async ({ page, context }) => {
    await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument(), "Две вкладки");
    const second = await context.newPage();
    for (const tab of [page, second]) {
        await tab.goto(`/planner?project=${project.id}`, { waitUntil: "networkidle" });
        await expectSaved(tab);
    }

    await renameRoom(page, "Гостиная");
    await expectSaved(page);

    await expect(projectBar(second).getByRole("status")).toHaveText(
        "Проект изменён в другой вкладке",
    );
    await projectBar(second).getByRole("button", { name: "Обновить" }).click();
    await expectSaved(second);
    await openRooms(second);
    await expect(roomName(second)).toHaveValue("Гостиная");
});

test("simultaneous edits on two devices ask what to keep instead of overwriting", async ({
    page,
    browser,
}) => {
    const account = await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument(), "Конфликт");

    const laptopContext = await browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": "10.252.0.1" },
    });
    const laptop = await laptopContext.newPage();
    expect((await loginByApi(laptop.request, account)).status()).toBe(200);

    for (const device of [page, laptop]) {
        await device.goto(`/planner?project=${project.id}`, { waitUntil: "networkidle" });
        await expectSaved(device);
    }

    // The phone saves first; the laptop still builds on the older revision.
    await renameRoom(page, "Кабинет");
    await expectSaved(page);
    await renameRoom(laptop, "Детская");

    const dialog = laptop.getByRole("dialog", { name: "Проект изменён в другом месте" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    expect(await serverRoomName(page, project.id)).toBe("Кабинет");

    await dialog.getByRole("button", { name: "Сохранить мою версию отдельным проектом" }).click();
    await expect(laptop).not.toHaveURL(new RegExp(project.id));
    await expect(laptop).toHaveURL(/[?&]project=[0-9a-f-]{36}/);
    await expectSaved(laptop);
    await openRooms(laptop);
    await expect(roomName(laptop)).toHaveValue("Детская");

    // Both versions exist; neither was overwritten.
    expect(await serverRoomName(page, project.id)).toBe("Кабинет");
    await page.goto("/projects", { waitUntil: "networkidle" });
    await expect(page.locator("[data-project-card]")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Конфликт (моя версия)" })).toBeVisible();
    await laptopContext.close();
});
