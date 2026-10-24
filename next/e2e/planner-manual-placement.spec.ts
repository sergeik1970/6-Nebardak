import { expect, test, type Locator, type Page } from "@playwright/test";

const dragUnplacedItemToRoom = async (
    page: Page,
    source: Locator,
    room: Locator,
    horizontalPosition: number,
) => {
    await source.scrollIntoViewIfNeeded();
    await source.hover();
    const sourceBox = await source.boundingBox();
    const roomBox = await room.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(roomBox).not.toBeNull();
    if (!sourceBox || !roomBox) return;

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    const visibleTop = Math.max(roomBox.y + 20, 20);
    const visibleBottom = Math.min(roomBox.y + roomBox.height - 20, viewport.height - 20);
    expect(visibleBottom).toBeGreaterThan(visibleTop);
    const target = {
        x: roomBox.x + roomBox.width * horizontalPosition,
        y: (visibleTop + visibleBottom) / 2,
    };
    const targetIsInsideRoom = await page.evaluate(
        ({ x, y }) =>
            Boolean(document.elementFromPoint(x, y)?.closest('[data-manual-drop-room="true"]')),
        target,
    );
    expect(targetIsInsideRoom, "The visible drag target must be inside the room").toBe(true);

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
};

test("manual placement keeps the first item after a second item is dragged onto the room", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop drag scenario runs once");

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/planner/layout", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Начать вручную" }).click();

    const room = page.locator('[data-manual-drop-room="true"]');
    const placedFurniture = room.locator("[data-visual]");
    const unplacedItems = page.locator('[data-manual-drag-source="true"]');

    await expect(placedFurniture).toHaveCount(0);
    await dragUnplacedItemToRoom(page, unplacedItems.nth(0), room, 0.25);
    await expect(placedFurniture).toHaveCount(1);

    await dragUnplacedItemToRoom(page, unplacedItems.nth(0), room, 0.72);
    await expect(placedFurniture).toHaveCount(2);
    await expect(unplacedItems).toHaveCount(2);
});

test("generated plan stays on the room while a newly selected item is added", async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name !== "desktop-chromium",
        "Desktop generation scenario runs once",
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    for (const selector of [
        "#furniture-double-bed",
        "#furniture-wardrobe-medium",
        "#furniture-bedside-table",
        "#furniture-desk",
    ]) {
        await page.locator(selector).uncheck({ force: true });
    }
    await page.locator("#furniture-single-bed").check({ force: true });

    const room = page.locator('[data-manual-drop-room="true"]');
    const placedFurniture = room.locator("[data-visual]");
    await page.getByRole("button", { name: "Уместить всё" }).click();
    await expect(placedFurniture).toHaveCount(1, { timeout: 60_000 });

    await page.locator("#furniture-bookcase").check({ force: true });
    await expect(placedFurniture).toHaveCount(1);

    const unplacedItem = page.locator('[data-manual-drag-source="true"]');
    await expect(unplacedItem).toHaveCount(1);
    await dragUnplacedItemToRoom(page, unplacedItem, room, 0.03);
    await expect(placedFurniture).toHaveCount(2);
});
