import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

test("planner edits and restores an L-room boundary on desktop and mobile", async ({ page }) => {
    await page.goto("/planner");

    await page.getByRole("button", { name: "Г справа", exact: true }).click();
    const room = page.getByRole("group", { name: /План комнаты/ });
    await expect(room).toHaveAttribute("data-room-shape", "orthogonal");
    await expect(room).toHaveAttribute("data-room-editing", "true");
    await expect(room.locator("[data-room-segment]")).toHaveCount(6);
    await expect(room.locator("[data-wall-dimension]")).toHaveCount(6);
    await expect(room.locator("[data-room-vertex]")).toHaveCount(6);
    await expect(room.locator("[data-room-segment-handle]")).toHaveCount(6);

    const notch = room.getByRole("button", { name: /Внутренний угол комнаты/ });
    await expect(notch).toBeVisible();
    const initialLabel = await notch.getAttribute("aria-label");
    await notch.press("ArrowDown");
    await expect(notch).not.toHaveAttribute("aria-label", initialLabel ?? "");
    const committedLabel = await notch.getAttribute("aria-label");

    const notchBox = await notch.boundingBox();
    expect(notchBox).not.toBeNull();
    if (!notchBox) throw new Error("L-room notch handle is not visible");
    await page.mouse.move(notchBox.x + notchBox.width / 2, notchBox.y + notchBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(notchBox.x + notchBox.width / 2, notchBox.y + 70, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(notch).toHaveAttribute("aria-label", committedLabel ?? "");

    await page.locator("summary").filter({ hasText: "Проёмы и отопление" }).click();
    const doorSegment = page.locator('select[name="door-wall"]');
    await expect(doorSegment).toHaveValue(/segment-/);
    await expect(doorSegment.locator("option")).toHaveCount(6);
    await expect(room.locator('[data-room-opening="door"]')).toBeVisible();
    const windowsEditor = page.locator("section").filter({ hasText: /^Окна/ });
    await windowsEditor.getByRole("button", { name: "+ Добавить" }).click();
    await expect(room.locator('[data-room-opening="window"]')).toHaveCount(2);
    await expect(page.locator('select[name^="window-"][name$="-wall"]').nth(1)).toHaveValue(
        /segment-/,
    );
    const radiatorsEditor = page.locator("section").filter({ hasText: /^Радиаторы/ });
    await radiatorsEditor.getByRole("button", { name: "+ Добавить" }).click();
    await expect(room.locator('[data-room-obstacle="radiator"]')).toHaveCount(1);
    await expect(page.locator('select[name^="radiator-"][name$="-wall"]').first()).toHaveValue(
        /segment-/,
    );

    await expect
        .poll(() =>
            page.evaluate(() => {
                const draft = JSON.parse(
                    localStorage.getItem("stylefinder:project-draft:v4") ?? "null",
                );
                return {
                    version: draft?.version,
                    kind: draft?.planner?.room?.geometry?.kind,
                    vertices: draft?.planner?.room?.geometry?.vertices?.length,
                    doorSegmentId: draft?.planner?.room?.doors?.[0]?.segmentId,
                };
            }),
        )
        .toMatchObject({
            version: 4,
            kind: "orthogonal",
            vertices: 6,
            doorSegmentId: expect.stringMatching(/^segment-/),
        });

    await page.reload();
    await expect(page.getByRole("group", { name: /План комнаты/ })).toHaveAttribute(
        "data-room-shape",
        "orthogonal",
    );
});

test("planner keeps a custom boundary when dimensions change and grows a free wall by handles", async ({
    page,
}) => {
    await page.goto("/planner");
    await page.getByRole("button", { name: "Г справа", exact: true }).click();
    const room = page.getByRole("group", { name: /План комнаты/ });
    await expect(room).toHaveAttribute("data-room-shape", "orthogonal");
    await expect(room).toHaveAttribute("data-room-editing", "true");

    const width = page.locator('input[name="room-width"]');
    await expect(width).toHaveValue("6");
    await page.getByRole("button", { name: "Увеличить ширину комнаты на 0,05 м" }).click();
    await expect(width).toHaveValue("6,05");
    await expect(room).toHaveAttribute("data-room-shape", "orthogonal");
    await expect(room.locator("[data-room-segment]")).toHaveCount(6);

    const splitHandle = room.locator('[data-room-segment-handle="segment-v6"]');
    await expect(splitHandle).toHaveAttribute("data-blocked", "false");
    await splitHandle.scrollIntoViewIfNeeded();
    await splitHandle.hover();
    const handleBox = await splitHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) throw new Error("Free wall midpoint handle is not visible");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + handleBox.width / 2 + 60,
        handleBox.y + handleBox.height / 2,
        {
            steps: 4,
        },
    );
    await page.mouse.up();

    await expect(room.locator("[data-room-segment]")).toHaveCount(10);
    await expect(room.locator("[data-wall-dimension]")).toHaveCount(10);
    await expect(room.locator("[data-room-vertex]")).toHaveCount(10);
    await expect(page.getByText(/Добавлен ортогональный уступ/)).toBeVisible();

    await page.reload();
    await expect(
        page.getByRole("group", { name: /План комнаты/ }).locator("[data-room-segment]"),
    ).toHaveCount(10);
});

test("planner differentiates brown doors and blue windows in edit mode", async ({ page }) => {
    await page.goto("/planner");
    await page.getByRole("button", { name: "Править комнату", exact: true }).click();
    const room = page.getByRole("group", { name: /План комнаты/ });
    const colors = await room.evaluate(() => {
        const door = document.querySelector('[data-room-opening="door"]');
        const window = document.querySelector('[data-room-opening="window"]');
        return {
            door: door ? getComputedStyle(door).backgroundColor : "",
            window: window ? getComputedStyle(window).backgroundColor : "",
        };
    });

    expect(colors.door).toBe("rgba(126, 74, 43, 0.2)");
    expect(colors.window).toBe("rgba(91, 163, 207, 0.24)");
    await expect(room.locator("[data-wall-dimension]")).toHaveCount(4);
});

test("rectangle corner moves its own boundary and Escape restores the exact drag snapshot", async ({
    page,
}) => {
    await page.goto("/planner");
    await page.getByRole("button", { name: "Править комнату", exact: true }).click();

    const room = page.getByRole("group", { name: /План комнаты/ });
    const width = page.locator('input[name="room-width"]');
    const topLeft = room.locator('[data-room-vertex="rect-top-left"]');
    const [beforeKey, beforeRoom] = await Promise.all([topLeft.boundingBox(), room.boundingBox()]);
    expect(beforeKey).not.toBeNull();
    expect(beforeRoom).not.toBeNull();
    if (!beforeKey || !beforeRoom) throw new Error("Top-left rectangle handle is not visible");

    await topLeft.press("ArrowRight");
    await expect(width).toHaveValue("5,95");
    const [afterKey, afterRoom] = await Promise.all([topLeft.boundingBox(), room.boundingBox()]);
    expect(afterKey).not.toBeNull();
    expect(afterRoom).not.toBeNull();
    if (!afterKey || !afterRoom) throw new Error("Moved top-left rectangle handle is not visible");
    expect(afterKey.x).toBeGreaterThan(beforeKey.x);
    expect(
        Math.abs(afterRoom.x + afterRoom.width - (beforeRoom.x + beforeRoom.width)),
    ).toBeLessThanOrEqual(1);

    const dragSnapshot = await topLeft.boundingBox();
    expect(dragSnapshot).not.toBeNull();
    if (!dragSnapshot) throw new Error("Rectangle corner snapshot is unavailable");
    await page.mouse.move(
        dragSnapshot.x + dragSnapshot.width / 2,
        dragSnapshot.y + dragSnapshot.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        dragSnapshot.x + dragSnapshot.width / 2 + 55,
        dragSnapshot.y + dragSnapshot.height / 2 + 35,
        { steps: 3 },
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();

    await expect(width).toHaveValue("5,95");
    const restored = await topLeft.boundingBox();
    expect(restored).not.toBeNull();
    if (!restored) throw new Error("Restored rectangle corner is not visible");
    expect(Math.abs(restored.x - dragSnapshot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - dragSnapshot.y)).toBeLessThanOrEqual(1);
});

test("occupied wall explains a blocked midpoint without covering its opening", async ({ page }) => {
    await page.goto("/planner");
    await page.getByRole("button", { name: "Править комнату", exact: true }).click();

    const room = page.getByRole("group", { name: /План комнаты/ });
    const window = room.locator('[data-room-opening="window"]');
    const topHandle = room.locator('[data-room-segment-handle="rect-top"]');
    await expect(topHandle).toHaveAttribute("data-blocked", "true");
    await expect(topHandle).toHaveAccessibleName(/На стене окно/);
    await expect(page.locator("#room-editor-blocked-summary")).toBeVisible();
    await expect(page.locator("#room-editor-blocked-summary")).toContainText(
        /Уступ на стене с проёмом временно недоступен/,
    );

    const [windowBox, handleBox] = await Promise.all([
        window.boundingBox(),
        topHandle.boundingBox(),
    ]);
    expect(windowBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    if (!windowBox || !handleBox) throw new Error("Opening controls are not visible");
    expect(handleBox.width).toBeGreaterThanOrEqual(44);
    expect(handleBox.height).toBeGreaterThanOrEqual(44);
    const overlapsWindow = !(
        handleBox.x + handleBox.width <= windowBox.x ||
        windowBox.x + windowBox.width <= handleBox.x ||
        handleBox.y + handleBox.height <= windowBox.y ||
        windowBox.y + windowBox.height <= handleBox.y
    );
    expect(overlapsWindow).toBe(false);

    await topHandle.focus();
    await expect(topHandle).toBeFocused();
});

test("mobile fit recovers a lower long-page board and keeps a 10m custom room visible", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile fit is covered once");
    await page.goto("/planner");

    const width = page.locator('input[name="room-width"]');
    const depth = page.locator('input[name="room-depth"]');
    await width.fill("10");
    await width.blur();
    await depth.fill("10");
    await depth.blur();

    // The furniture catalogue makes the planner a long document on a phone.
    // Start from its lower page position, then enter editing from the room
    // controls. The editor must position the plan itself before fitting; this
    // test deliberately does not scroll the canvas into view for it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole("button", { name: "Г справа", exact: true }).click();

    const viewport = page.getByLabel("Прокручиваемая область плана");
    const room = page.getByRole("group", { name: /План комнаты/ });
    await expect(viewport).toHaveAttribute("data-plan-zoom", "fit");
    await expect(room).toHaveAttribute("data-room-shape", "orthogonal");
    await expect(room.locator('[data-room-segment-handle][data-blocked="true"]')).toHaveCount(2);
    await expect(page.locator("#room-editor-blocked-summary")).toBeVisible();

    await expect
        .poll(() =>
            room.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const openings = Array.from(
                    element.querySelectorAll<HTMLElement>("[data-room-opening]"),
                ).map((opening) => {
                    const openingRect = opening.getBoundingClientRect();
                    return Math.max(openingRect.width, openingRect.height);
                });
                const vertices = Array.from(
                    element.querySelectorAll<HTMLElement>("[data-room-vertex]"),
                ).map((vertex) => {
                    const vertexRect = vertex.getBoundingClientRect();
                    return `${Math.round(vertexRect.x)}:${Math.round(vertexRect.y)}`;
                });

                return {
                    hasRoom: rect.width > 120 && rect.height > 120,
                    visibleOpenings: openings.every((size) => size > 8),
                    distinctVertices: new Set(vertices).size,
                };
            }),
        )
        .toEqual({ hasRoom: true, visibleOpenings: true, distinctVertices: 6 });

    await expect
        .poll(() =>
            page.evaluate(() => {
                const element = document.querySelector<HTMLElement>(
                    "[aria-label='Прокручиваемая область плана']",
                );
                if (!element) return Number.POSITIVE_INFINITY;
                return Math.max(
                    element.scrollWidth - element.clientWidth,
                    element.scrollHeight - element.clientHeight,
                );
            }),
        )
        .toBe(0);
});

test("planner draws and applies a custom orthogonal contour", async ({ page }, testInfo) => {
    await page.goto("/planner");
    await page.getByRole("button", { name: "Нарисовать", exact: true }).click();

    const room = page.getByRole("group", { name: /План комнаты/ });
    await expect(room).toHaveAttribute("data-contour-drawing", "true");
    await expect(page.getByRole("heading", { name: "Чертёж комнаты" })).toBeVisible();
    await expect(page.getByText("Нарисуйте контур по углам")).toBeVisible();
    await expect(room.locator("[data-room-segment]")).toHaveCount(0);
    await expect(room.locator("[data-room-opening]")).toHaveCount(0);
    await expect(room.locator("[data-furniture-piece]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Уместить всё", exact: true })).toHaveCount(0);
    await expect(
        page.getByText(
            /Сначала примените или отмените чертёж — расчёт расстановки пока недоступен/,
        ),
    ).toBeVisible();
    const drawSurface = room.getByRole("button", { name: /Добавить вершину контура/ });
    const box = await drawSurface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Contour drawing surface is not visible");

    if (testInfo.project.name === "mobile-chromium") {
        await expect(drawSurface).toBeFocused();
        const panViewport = page.getByLabel("Прокручиваемая область плана");
        const panBox = await panViewport.boundingBox();
        expect(panBox).not.toBeNull();
        if (!panBox) throw new Error("Plan viewport is not visible");
        expect(box.x).toBeGreaterThanOrEqual(panBox.x);
        expect(box.x + box.width).toBeLessThanOrEqual(panBox.x + panBox.width + 1);
    }

    const points = [
        [0.05, 0.05],
        [0.6, 0.05],
        [0.6, 0.4],
        // Target the 5.70m grid line directly. The drawing field now uses
        // its full width, so this ratio maps to the intended 50mm snap
        // without relying on an old padded surface.
        [0.95, 0.4],
        [0.95, 0.95],
    ];
    for (const [x, y] of points) {
        await drawSurface.click({
            position: { x: box.width * x, y: box.height * y },
            force: true,
        });
    }
    if (testInfo.project.name === "mobile-chromium") {
        await expect(page.getByText(/X 5700 мм · Y \d+ мм/)).toBeVisible();
    }
    await expect(page.getByText(/Точек: 5 из 15/)).toBeVisible();
    await page.getByRole("button", { name: "Применить контур", exact: true }).click();

    await expect(room).toHaveAttribute("data-contour-drawing", "false");
    await expect(room).toHaveAttribute("data-room-shape", "orthogonal");
    await expect(room.locator("[data-room-segment]")).toHaveCount(6);
    await expect(page.getByText(/Параметры изменены.*уместите набор заново/)).toBeVisible();
});

test("planner keeps the committed room while a custom contour is cancelled", async ({ page }) => {
    await page.goto("/planner");
    const room = page.getByRole("group", { name: /План комнаты/ });
    await expect(room.locator("[data-room-segment]")).toHaveCount(4);

    await page.getByRole("button", { name: "Нарисовать", exact: true }).click();
    const drawSurface = room.getByRole("button", { name: /Добавить вершину контура/ });
    const box = await drawSurface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Contour drawing surface is not visible");

    await drawSurface.click({ position: { x: box.width * 0.15, y: box.height * 0.15 } });
    await expect(page.getByText(/Точка 1 поставлена/)).toBeVisible();
    await page.getByRole("button", { name: "Отменить чертёж", exact: true }).click();

    await expect(room).toHaveAttribute("data-contour-drawing", "false");
    await expect(room.locator("[data-room-segment]")).toHaveCount(4);
    await expect(page.getByText(/текущая форма комнаты сохранена/)).toBeVisible();
});

test("planner caps an open contour before it can exceed the supported room vertices", async ({
    page,
}) => {
    await page.goto("/planner");
    await page.getByRole("button", { name: "Нарисовать", exact: true }).click();

    const room = page.getByRole("group", { name: /План комнаты/ });
    const drawSurface = room.getByRole("button", { name: /Добавить вершину контура/ });
    const clickContourPoint = async (x: number, y: number) => {
        const box = await drawSurface.boundingBox();
        expect(box).not.toBeNull();
        if (!box) throw new Error("Contour drawing surface is not visible");
        await drawSurface.click({ position: { x: box.width * x, y: box.height * y } });
    };

    const points = [
        [0.05, 0.05],
        [0.2, 0.05],
        [0.2, 0.2],
        [0.35, 0.2],
        [0.35, 0.35],
        [0.5, 0.35],
        [0.5, 0.5],
        [0.65, 0.5],
        [0.65, 0.65],
        [0.8, 0.65],
        [0.8, 0.8],
        [0.95, 0.8],
        [0.95, 0.95],
        [0.7, 0.95],
        [0.7, 0.5],
    ];
    for (const [x, y] of points) {
        await clickContourPoint(x, y);
    }
    await clickContourPoint(0.1, 0.5);

    await expect(page.getByText(/максимум 15 точек/)).toBeVisible();
    await expect(drawSurface).toHaveAccessibleName(/Сейчас точек: 15 из 15/);
});
