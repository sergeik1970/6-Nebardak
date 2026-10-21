import { expect, test, type Locator, type Page } from "@playwright/test";
import { continueThroughRoomStep } from "./project-flow";

const activateWithKeyboard = async (
    page: Page,
    locator: Locator,
    key: "Enter" | "Space" = "Enter",
) => {
    await locator.focus();
    await expect(locator).toBeFocused();
    await page.keyboard.press(key);
};

const swipeScrollableViewport = async (page: Page, viewport: Locator) => {
    await viewport.scrollIntoViewIfNeeded();
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const client = await page.context().newCDPSession(page);
    const y = box.y + Math.min(80, box.height / 3);
    const startX = box.x + box.width * 0.8;
    const endX = box.x + box.width * 0.2;

    try {
        await client.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: startX, y }],
        });
        for (const ratio of [0.2, 0.4, 0.6, 0.8, 1]) {
            await client.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ x: startX + (endX - startX) * ratio, y }],
            });
        }
        await client.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
        });
    } finally {
        await client.detach();
    }
};

const openSingleBedPlanner = async (page: Page) => {
    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await continueThroughRoomStep(page);
};

test("planner change-answers round trip keeps the questionnaire prefilled", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop round trip runs once");

    await page.goto(
        "/questionnaire?style=provence&styleLabel=%D0%9F%D1%80%D0%BE%D0%B2%D0%B0%D0%BD%D1%81",
        { waitUntil: "networkidle" },
    );
    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await page.getByRole("checkbox", { name: /Книжный шкаф/ }).check();
    await continueThroughRoomStep(page);

    await expect(page.getByText(/Набор получен из анкеты/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Книжный шкаф/ })).toBeChecked();
    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return draft?.planner?.layout?.placements?.length ?? 0;
            }),
        )
        .toBeGreaterThan(0);

    await Promise.all([
        page.waitForURL(/\/questionnaire\?.*restore=1/, {
            timeout: 60_000,
            waitUntil: "commit",
        }),
        page.getByRole("link", { name: "Изменить ответы" }).click(),
    ]);
    await expect(page.getByRole("radio", { name: "Односпальная", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Книжный шкаф/ })).toBeChecked();
    await expect(page.getByText(/Контекст стиля:/)).toContainText("Прованс");
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return draft?.planner?.layout?.placements?.length ?? 0;
            }),
        )
        .toBeGreaterThan(0);

    await Promise.all([
        page.waitForURL(/\/planner\?handoff=/, { timeout: 60_000, waitUntil: "commit" }),
        page.getByRole("button", { name: "Перейти к расстановке" }).click(),
    ]);
    await expect(page.getByText(/2 предмета в наборе/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Книжный шкаф/ })).toBeChecked();
});

test("planner wardrobe choices round-trip through the questionnaire without losing counts or priorities", async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name !== "desktop-chromium",
        "Desktop wardrobe round trip runs once",
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
        const items = [
            { definitionId: "wardrobe-small", count: 1, priority: "required" },
            { definitionId: "wardrobe-large", count: 1, priority: "optional" },
        ];
        localStorage.setItem(
            "stylefinder:project-draft:v4",
            JSON.stringify({
                version: 3,
                updatedAt: Date.now(),
                questionnaire: { items },
                planner: {
                    room: {
                        width: 6000,
                        depth: 4600,
                        doors: [
                            {
                                id: "door-main",
                                wall: "bottom",
                                offset: 500,
                                width: 900,
                                clearanceDepth: 900,
                                hinge: "start",
                            },
                        ],
                        windows: [],
                        radiators: [],
                    },
                    selection: { "wardrobe-small": 1, "wardrobe-large": 1 },
                    priorities: { "wardrobe-small": "required", "wardrobe-large": "optional" },
                },
            }),
        );
    });

    await page.goto("/questionnaire?restore=1", { waitUntil: "networkidle" });

    await expect(page.getByRole("button", { name: "Малый · 700 мм: 1" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(page.getByRole("button", { name: "Большой · 2000 мм: 1" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(
        page
            .getByRole("group", { name: "Приоритет: Шкаф для одежды, малый" })
            .getByRole("button", { name: "Обязательно" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
        page
            .getByRole("group", { name: "Приоритет: Шкаф для одежды, большой" })
            .getByRole("button", { name: "Желательно" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Можно убрать" })).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    items: draft?.questionnaire?.items,
                    selection: draft?.planner?.selection,
                    priorities: draft?.planner?.priorities,
                };
            }),
        )
        .toEqual({
            items: [
                { definitionId: "wardrobe-small", count: 1, priority: "required" },
                { definitionId: "wardrobe-large", count: 1, priority: "optional" },
            ],
            selection: { "wardrobe-small": 1, "wardrobe-large": 1 },
            priorities: { "wardrobe-small": "required", "wardrobe-large": "optional" },
        });

    await page.getByRole("button", { name: "Малый · 700 мм: 0" }).click();
    await page.getByRole("button", { name: "Большой · 2000 мм: 0" }).click();
    await page.getByRole("button", { name: "Средний · 1500 мм: 2" }).click();
    await page
        .getByRole("group", { name: "Приоритет: Шкаф для одежды, средний" })
        .getByRole("button", { name: "Желательно" })
        .click();

    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    items: draft?.questionnaire?.items,
                    selection: draft?.planner?.selection,
                    priorities: draft?.planner?.priorities,
                };
            }),
        )
        .toEqual({
            items: [{ definitionId: "wardrobe-medium", count: 2, priority: "preferred" }],
            selection: { "wardrobe-medium": 2 },
            priorities: { "wardrobe-medium": "preferred" },
        });

    await Promise.all([
        page.waitForURL(/\/planner\?handoff=/, { timeout: 60_000, waitUntil: "commit" }),
        page.getByRole("button", { name: "Перейти к расстановке" }).click(),
    ]);
    await expect(page.getByRole("checkbox", { name: /Шкаф 1500 мм/ })).toBeChecked();
    await expect(page.getByText(/2 предмета в наборе/)).toBeVisible();
});

test("mobile questionnaire flow supports generation, zoom, pan, fullscreen and editing", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile editing flow runs once");

    await openSingleBedPlanner(page);
    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });

    const board = page.locator("[data-fullscreen]").first();
    const panViewport = page.getByLabel("Прокручиваемая область плана");
    await page.getByRole("button", { name: "Увеличить план" }).click();
    await expect(page.getByRole("button", { name: "Вместить план по ширине" })).toContainText(
        "125%",
    );
    await swipeScrollableViewport(page, panViewport);
    await expect
        .poll(() => panViewport.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    const scrollMetrics = await panViewport.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
    }));
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
    expect(scrollMetrics.scrollLeft).toBeGreaterThan(0);

    const enterFullscreen = page.getByRole("button", { name: "На весь экран" });
    await expect(enterFullscreen).toBeVisible();
    await enterFullscreen.click();
    await expect(board).toHaveAttribute("data-fullscreen", "true");
    await page.getByRole("button", { name: "Закрыть экран" }).click();
    await expect(board).toHaveAttribute("data-fullscreen", "false");

    const furniture = page
        .getByRole("button", { name: /^Односпальная кровать(?: · \d+)?,/ })
        .first();
    await furniture.click();
    await expect(furniture).toHaveAttribute("aria-pressed", "true");
    const initialLabel = await furniture.getAttribute("aria-label");
    const undo = page.getByRole("button", { name: /Отменить/ });
    const nudgeButtons = [
        "Сдвинуть вправо на 50 миллиметров",
        "Сдвинуть влево на 50 миллиметров",
        "Сдвинуть вниз на 50 миллиметров",
        "Сдвинуть вверх на 50 миллиметров",
    ];

    for (const name of nudgeButtons) {
        await page.getByRole("button", { name }).click();
        if (await undo.isEnabled()) break;
    }

    await expect(undo).toBeEnabled();
    await expect(furniture).not.toHaveAttribute("aria-label", initialLabel ?? "");
});

test("keyboard-only workflow generates, edits, undoes and exports without mouse activation", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Keyboard workflow runs once");

    await page.addInitScript(() => {
        const state = { mouseActivations: 0 };
        Object.defineProperty(window, "__stylefinderKeyboardE2E", {
            configurable: false,
            value: state,
        });
        window.addEventListener(
            "pointerdown",
            (event) => {
                if (event.pointerType === "mouse") state.mouseActivations += 1;
            },
            true,
        );
        window.addEventListener(
            "click",
            (event) => {
                if (event.detail > 0) state.mouseActivations += 1;
            },
            true,
        );
    });

    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    const singleBed = page.getByRole("radio", { name: "Односпальная", exact: true });
    await activateWithKeyboard(page, singleBed, "Space");
    await expect(singleBed).toBeChecked();

    const openRoomStep = page.getByRole("button", { name: "Дальше: комната" });
    await openRoomStep.focus();
    await expect(openRoomStep).toBeFocused();
    await Promise.all([
        page.waitForURL(/\/planner\/draw\?handoff=/, { timeout: 60_000, waitUntil: "commit" }),
        page.keyboard.press("Enter"),
    ]);

    // The room step by keyboard: the rectangle template and its dialog.
    await activateWithKeyboard(
        page,
        page.getByRole("button", { name: "Прямоугольная комната по размерам" }),
    );
    const template = page.getByRole("dialog", { name: "Прямоугольная комната" });
    await expect(template.getByLabel("Ширина, м")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(template).toBeHidden();
    const openPlanner = page.getByRole("button", { name: "Продолжить с комнатой" });
    await expect(openPlanner).toBeEnabled();
    await Promise.all([
        page.waitForURL(/\/planner\?(?:drawRoom=1&)?handoff=/, {
            timeout: 60_000,
            waitUntil: "commit",
        }),
        activateWithKeyboard(page, openPlanner),
    ]);

    const generate = page.getByRole("button", { name: "Уместить всё" });
    await activateWithKeyboard(page, generate);
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });

    const furniture = page
        .getByRole("button", { name: /^Односпальная кровать(?: · \d+)?,/ })
        .first();
    await activateWithKeyboard(page, furniture);
    await expect(furniture).toHaveAttribute("aria-pressed", "true");
    const initialLabel = await furniture.getAttribute("aria-label");
    const undo = page.getByRole("button", { name: /Отменить/ });

    for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"] as const) {
        await furniture.focus();
        await page.keyboard.press(key);
        if (await undo.isEnabled()) break;
    }

    await expect(undo).toBeEnabled();
    await expect(furniture).not.toHaveAttribute("aria-label", initialLabel ?? "");
    await activateWithKeyboard(page, undo);
    await expect(furniture).toHaveAttribute("aria-label", initialLabel ?? "");

    const downloadPromise = page.waitForEvent("download");
    await activateWithKeyboard(page, page.getByRole("button", { name: "Скачать PNG" }));
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/i);

    const mouseActivations = await page.evaluate(
        () =>
            (
                window as Window & {
                    __stylefinderKeyboardE2E?: { mouseActivations: number };
                }
            ).__stylefinderKeyboardE2E?.mouseActivations ?? -1,
    );
    expect(mouseActivations).toBe(0);
});

test("manual removal is confirmed, undoable, redoable and restored after reload", async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop removal flow runs once");

    await page.goto("/questionnaire", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Односпальная", exact: true }).check();
    await page.getByRole("checkbox", { name: /Книжный шкаф/ }).check();
    await continueThroughRoomStep(page);

    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });

    const bookcase = page.getByRole("button", { name: /^Книжный шкаф(?: · \d+)?,/ }).first();
    await bookcase.click();
    await expect(bookcase).toHaveAttribute("aria-pressed", "true");

    const removeFromInspector = page.getByRole("button", { name: "Убрать предмет", exact: true });
    await removeFromInspector.click();
    const dialog = page.getByRole("dialog", { name: "Убрать предмет из планировки?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Книжный шкаф/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(dialog).toBeHidden();
    await expect(removeFromInspector).toBeFocused();

    await removeFromInspector.click();
    await dialog.getByRole("button", { name: "Убрать предмет", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Книжный шкаф убран из проекта/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Удалено из проекта" })).toBeVisible();

    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    active: draft?.planner?.removedItems?.length ?? 0,
                    archived: draft?.planner?.removalArchive?.length ?? 0,
                    placements: draft?.planner?.layout?.placements?.length ?? 0,
                };
            }),
        )
        .toEqual({ active: 1, archived: 1, placements: 1 });

    const undo = page.getByRole("button", { name: /Отменить/ });
    const redo = page.getByRole("button", { name: /Вернуть/ });
    await undo.click();
    await expect(page.getByRole("button", { name: /^Книжный шкаф(?: · \d+)?,/ })).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    active: draft?.planner?.removedItems?.length ?? 0,
                    archived: draft?.planner?.removalArchive?.length ?? 0,
                };
            }),
        )
        .toEqual({ active: 0, archived: 1 });

    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(page.getByRole("heading", { name: "Удалено из проекта" })).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return draft?.planner?.removedItems?.length ?? 0;
            }),
        )
        .toBe(1);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Удалено из проекта" })).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByRole("checkbox", { name: /Книжный шкаф/ })).not.toBeChecked();
    await expect(page.getByText("Книжный шкаф", { exact: true }).last()).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    active: draft?.planner?.removedItems?.length ?? 0,
                    archived: draft?.planner?.removalArchive?.length ?? 0,
                    placements: draft?.planner?.layout?.placements?.length ?? 0,
                };
            }),
        )
        .toEqual({ active: 1, archived: 1, placements: 1 });

    await page.getByRole("button", { name: "Увеличить количество: Книжный шкаф" }).click();
    await expect(page.getByRole("checkbox", { name: /Книжный шкаф/ })).toBeChecked();
    await expect(page.getByRole("button", { name: /Отменить/ })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Скачать PNG" })).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    count: draft?.planner?.selection?.bookcase,
                    active: draft?.planner?.removedItems?.length ?? 0,
                    archived: draft?.planner?.removalArchive?.length ?? 0,
                    hasLayout: Boolean(draft?.planner?.layout),
                };
            }),
        )
        .toEqual({ count: 1, active: 0, archived: 1, hasLayout: false });

    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(page.getByRole("heading", { name: "Итоговая спецификация" })).toBeVisible({
        timeout: 60_000,
    });
    await expect(page.getByRole("button", { name: /^Книжный шкаф(?: · \d+)?,/ })).toBeVisible();
});
