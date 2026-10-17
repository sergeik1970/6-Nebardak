import { expect, test } from "@playwright/test";

test("planner number fields allow an empty draft and reject values above their maximum", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Detailed editor flow runs once");

    await page.goto("/planner", { waitUntil: "networkidle" });

    const width = page.locator('input[name="room-width"]');
    const depth = page.locator('input[name="room-depth"]');
    const [widthBox, depthBox] = await Promise.all([width.boundingBox(), depth.boundingBox()]);
    expect(widthBox?.width).toBeGreaterThanOrEqual(72);
    expect(depthBox?.width).toBeGreaterThanOrEqual(72);
    await page.getByRole("button", { name: "Увеличить ширину комнаты на 0,05 м" }).click();
    await expect(width).toHaveValue("6,05");
    await page.getByRole("button", { name: "Уменьшить ширину комнаты на 0,05 м" }).click();
    await expect(width).toHaveValue("6");
    await width.fill("");
    await expect(width).toHaveValue("");
    await width.fill("0");
    await expect(width).toHaveValue("0");

    await width.fill("10,1");
    await expect(width).toHaveValue("0");
    await width.fill("7,25");
    await width.blur();
    await expect(width).toHaveValue("7,25");

    await page.locator("summary").filter({ hasText: "Проёмы и отопление" }).click();
    const doorOffset = page.locator('input[name="door-offset"]');
    await doorOffset.fill("");
    await expect(doorOffset).toHaveValue("");
    await doorOffset.fill("0");
    await expect(doorOffset).toHaveValue("0");
    await doorOffset.fill("9999");
    await expect(doorOffset).toHaveValue("0");
    await doorOffset.blur();
    await expect(doorOffset).toHaveValue("0");

    const room = page.getByRole("group", { name: /План комнаты/ });
    const swing = room.locator('[class*="doorSwing"]');
    await expect(swing).toHaveAttribute("data-wall", "bottom");
    await expect(swing).toHaveAttribute("data-hinge", "start");
    await expect(room.locator('[data-room-wall="bottom"]')).toBeVisible();
    await expect(room.locator('[data-room-opening="door"]')).toHaveAttribute("data-wall", "bottom");
    await expect(room.locator('[data-room-opening="window"]')).toHaveAttribute("data-wall", "top");
    const swingBox = await swing.boundingBox();
    expect(swingBox?.width).toBeGreaterThan(20);
    expect(swingBox?.height).toBeGreaterThan(20);
});

test("shrinking a room keeps an oversized opening visible and offers an explicit repair", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Detailed editor flow runs once");

    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.locator("summary").filter({ hasText: "Проёмы и отопление" }).click();

    const doorWidth = page.locator('input[name="door-width"]');
    await doorWidth.fill("400");
    await doorWidth.blur();
    await expect(doorWidth).toHaveValue("400");

    const roomDepth = page.locator('input[name="room-depth"]');
    await roomDepth.fill("2,4");
    await roomDepth.blur();

    await expect(page.getByText(/Дверь шире доступной глубины комнаты/)).toBeVisible();
    await expect(doorWidth).toHaveValue("400");

    await page.getByRole("button", { name: "Исправить по размеру комнаты" }).click();
    await expect(page.getByText(/Дверь шире доступной глубины комнаты/)).toHaveCount(0);
    await expect(doorWidth).toHaveValue("240");
});

test("planner edits room items directly and Escape restores an unfinished gesture", async ({
    page,
}) => {
    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.locator("summary").filter({ hasText: "Проёмы и отопление" }).click();

    const radiatorsEditor = page.locator("section").filter({ hasText: /^Радиаторы/ });
    await radiatorsEditor.getByRole("button", { name: "+ Добавить" }).click();
    const radiatorWall = page.locator('select[name^="radiator-"][name$="-wall"]').first();
    await radiatorWall.selectOption("left");
    const windowsEditor = page.locator("section").filter({ hasText: /^Окна/ });
    await windowsEditor.getByRole("button", { name: "+ Добавить" }).click();

    const room = page.getByRole("group", { name: /План комнаты/ });
    const windowOpening = room.locator('[data-room-opening="window"]').first();
    const rightWindowOpening = room.locator('[data-room-opening="window"]').nth(1);
    const doorOpening = room.locator('[data-room-opening="door"]').first();
    const windowOffset = page.locator('input[name^="window-"][name$="-offset"]').first();
    const rightWindowOffset = page.locator('input[name^="window-"][name$="-offset"]').nth(1);
    const doorOffset = page.locator('input[name="door-offset"]');
    const radiator = room.locator('[data-room-obstacle="radiator"]').first();
    const radiatorOffset = page.locator('input[name^="radiator-"][name$="-offset"]').first();
    const initialOffset = await windowOffset.inputValue();
    const initialRightWindowOffset = await rightWindowOffset.inputValue();
    const initialDoorOffset = await doorOffset.inputValue();
    const initialRadiatorOffset = await radiatorOffset.inputValue();

    await page.getByRole("button", { name: "Править комнату", exact: true }).click();
    await expect(room).toHaveAttribute("data-room-editing", "true");
    await expect(windowOpening).toHaveAttribute("tabindex", "0");
    await expect(rightWindowOpening).toHaveAttribute("data-wall", "right");
    await expect(doorOpening).toHaveAttribute("data-wall", "bottom");
    await expect(radiator).toHaveAttribute("tabindex", "0");

    await windowOpening.scrollIntoViewIfNeeded();

    const openingBox = await windowOpening.boundingBox();
    expect(openingBox).not.toBeNull();
    if (!openingBox) throw new Error("Window opening is not visible on the plan");

    await page.mouse.move(
        openingBox.x + openingBox.width / 2,
        openingBox.y + openingBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        openingBox.x + openingBox.width / 2 + 90,
        openingBox.y + openingBox.height / 2,
        {
            steps: 4,
        },
    );
    await page.mouse.up();
    await expect(windowOffset).not.toHaveValue(initialOffset);
    const committedOffset = await windowOffset.inputValue();

    const movedBox = await windowOpening.boundingBox();
    expect(movedBox).not.toBeNull();
    if (!movedBox) throw new Error("Moved window opening is not visible on the plan");

    await page.mouse.move(movedBox.x + movedBox.width / 2, movedBox.y + movedBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(movedBox.x + movedBox.width / 2 - 60, movedBox.y + movedBox.height / 2, {
        steps: 3,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();

    await expect(windowOffset).toHaveValue(committedOffset);

    await rightWindowOpening.scrollIntoViewIfNeeded();
    const rightWindowBox = await rightWindowOpening.boundingBox();
    expect(rightWindowBox).not.toBeNull();
    if (!rightWindowBox) throw new Error("Right wall window is not visible on the plan");

    await page.mouse.move(
        rightWindowBox.x + rightWindowBox.width / 2,
        rightWindowBox.y + rightWindowBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        rightWindowBox.x + rightWindowBox.width / 2,
        rightWindowBox.y + rightWindowBox.height / 2 + 90,
        { steps: 4 },
    );
    await page.mouse.up();
    await expect(rightWindowOffset).not.toHaveValue(initialRightWindowOffset);

    await doorOpening.press("ArrowRight");
    await expect(doorOffset).not.toHaveValue(initialDoorOffset);

    await radiator.scrollIntoViewIfNeeded();
    const radiatorBox = await radiator.boundingBox();
    expect(radiatorBox).not.toBeNull();
    if (!radiatorBox) throw new Error("Radiator is not visible on the plan");

    await page.mouse.move(
        radiatorBox.x + radiatorBox.width / 2,
        radiatorBox.y + radiatorBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        radiatorBox.x + radiatorBox.width / 2,
        radiatorBox.y + radiatorBox.height / 2 + 90,
        { steps: 4 },
    );
    await page.mouse.up();
    await expect(radiatorOffset).not.toHaveValue(initialRadiatorOffset);

    const roomWidth = page.locator('input[name="room-width"]');
    const initialWidth = await roomWidth.inputValue();
    const widthHandle = room.getByRole("button", { name: /Изменить ширину комнаты/ });
    await widthHandle.scrollIntoViewIfNeeded();
    const handleBox = await widthHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) throw new Error("Room width handle is not visible on the plan");

    await widthHandle.press("ArrowRight");
    await expect(roomWidth).not.toHaveValue(initialWidth);
    const keyboardWidth = await roomWidth.inputValue();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + handleBox.width / 2 + 90,
        handleBox.y + handleBox.height / 2,
        {
            steps: 4,
        },
    );
    await page.mouse.up();
    await expect(roomWidth).not.toHaveValue(keyboardWidth);
    const committedWidth = await roomWidth.inputValue();

    const resizedHandleBox = await widthHandle.boundingBox();
    expect(resizedHandleBox).not.toBeNull();
    if (!resizedHandleBox) throw new Error("Resized room width handle is not visible on the plan");

    await page.mouse.move(
        resizedHandleBox.x + resizedHandleBox.width / 2,
        resizedHandleBox.y + resizedHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        resizedHandleBox.x + resizedHandleBox.width / 2 - 60,
        resizedHandleBox.y + resizedHandleBox.height / 2,
        { steps: 3 },
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();

    await expect(roomWidth).toHaveValue(committedWidth);
});
