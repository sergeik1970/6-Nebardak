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

const openOpenings = async (page: Page) => {
    const summary = page.locator("summary").filter({ hasText: "Проёмы и отопление" });
    const details = page.locator("details", { has: summary });
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
        await summary.click();
    }
};

const setDoorOffset = async (page: Page, value: string) => {
    await openOpenings(page);
    const offset = page.locator('input[name="door-door-main-offset"]');
    await offset.fill(value);
    await offset.blur();
    await expect(offset).toHaveValue(value);
};

const doorOffset = (page: Page) => page.locator('input[name="door-door-main-offset"]');

const serverDoorOffset = async (page: Page, projectId: string) => {
    const response = await getProjectByApi(page, projectId);
    const { project } = (await response.json()) as {
        project: { document: { planner: { room: { doors: Array<{ offset: number }> } } } };
    };
    return project.document.planner.room.doors[0].offset;
};

test("edits made offline are kept and saved once the network returns", async ({
    page,
    context,
}) => {
    await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument(), "Офлайн");
    await page.goto(`/planner/layout?project=${project.id}`, { waitUntil: "networkidle" });
    await expectSaved(page);

    await context.setOffline(true);
    await setDoorOffset(page, "120");
    await expect(projectBar(page).getByRole("status")).toHaveText(/Нет сети/, {
        timeout: 30_000,
    });

    await context.setOffline(false);
    await expectSaved(page);
    expect(await serverDoorOffset(page, project.id)).toBe(1200);

    await page.reload({ waitUntil: "networkidle" });
    await expectSaved(page);
    await openOpenings(page);
    await expect(doorOffset(page)).toHaveValue("120");
});

test("another tab sees a newer save and picks it up", async ({ page, context }) => {
    await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument(), "Две вкладки");
    const second = await context.newPage();
    for (const tab of [page, second]) {
        await tab.goto(`/planner/layout?project=${project.id}`, { waitUntil: "networkidle" });
        await expectSaved(tab);
    }

    await setDoorOffset(page, "150");
    await expectSaved(page);

    await expect(projectBar(second).getByRole("status")).toHaveText(
        "Проект изменён в другой вкладке",
    );
    await projectBar(second).getByRole("button", { name: "Обновить" }).click();
    await expectSaved(second);
    await openOpenings(second);
    await expect(doorOffset(second)).toHaveValue("150");
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
        await device.goto(`/planner/layout?project=${project.id}`, { waitUntil: "networkidle" });
        await expectSaved(device);
    }

    // The phone saves first; the laptop still builds on the older revision.
    await setDoorOffset(page, "150");
    await expectSaved(page);
    await setDoorOffset(laptop, "250");

    const dialog = laptop.getByRole("dialog", { name: "Проект изменён в другом месте" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    expect(await serverDoorOffset(page, project.id)).toBe(1500);

    await dialog.getByRole("button", { name: "Сохранить мою версию отдельным проектом" }).click();
    await expect(laptop).not.toHaveURL(new RegExp(project.id));
    await expect(laptop).toHaveURL(/[?&]project=[0-9a-f-]{36}/);
    await expectSaved(laptop);
    await openOpenings(laptop);
    await expect(doorOffset(laptop)).toHaveValue("250");

    // Both versions exist; neither was overwritten.
    expect(await serverDoorOffset(page, project.id)).toBe(1500);
    await page.goto("/projects", { waitUntil: "networkidle" });
    await expect(page.locator("[data-project-card]")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Конфликт (моя версия)" })).toBeVisible();
    await laptopContext.close();
});
