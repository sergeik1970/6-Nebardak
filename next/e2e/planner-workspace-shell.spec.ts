import { expect, test } from "@playwright/test";

test("desktop planner presents a tool rail and reserves the largest column for the drawing workspace", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop workspace is covered once");
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    const workspace = page.locator("[data-planner-workspace='true']");
    const rail = page.getByRole("navigation", { name: "Разделы рабочего пространства" });
    const planHeading = page.getByRole("heading", { name: "План комнаты", exact: true });

    await expect(workspace).toBeVisible();
    await expect(rail).toBeVisible();
    await expect(planHeading).toBeVisible();
    await expect(page.locator("[data-planner-app-bar='true']")).toContainText("Комната готова");
    await expect(
        page.getByRole("status").filter({ hasText: "Расстановка не рассчитана" }),
    ).toBeVisible();
    await expect(page.getByText("Быстрый расчёт не завершён", { exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: /Комната/ })).toHaveAttribute(
        "aria-pressed",
        "true",
    );

    const geometry = await workspace.evaluate((element) => {
        const columns = getComputedStyle(element)
            .gridTemplateColumns.split(" ")
            .map((value) => Number.parseFloat(value))
            .filter((value) => Number.isFinite(value));
        return { columns, height: element.getBoundingClientRect().height };
    });
    expect(geometry.columns).toHaveLength(4);
    expect(geometry.columns[2]).toBeGreaterThan(geometry.columns[1]);
    expect(geometry.columns[2]).toBeGreaterThan(geometry.columns[3]);
    expect(geometry.height).toBeGreaterThanOrEqual(550);

    await rail.getByRole("button", { name: /Мебель/ }).click();
    await expect(rail.getByRole("button", { name: /Мебель/ })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(page.locator("#planner-tool-furniture")).toBeInViewport();
});

test("mobile planner keeps the plan full width before the stacked tool panels", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile workspace is covered once");
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    const workspace = page.locator("[data-planner-workspace='true']");
    const rail = page.getByRole("navigation", { name: "Разделы рабочего пространства" });
    const plan = page.getByRole("heading", { name: "План комнаты", exact: true });

    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button")).toHaveCount(3);
    await expect(plan).toBeVisible();

    const order = await workspace.evaluate((element) => {
        const railElement = element.querySelector<HTMLElement>("nav");
        const planElement = document
            .getElementById("plan-heading")
            ?.closest<HTMLElement>("section");
        const setupElement = element.querySelector<HTMLElement>(
            "aside[aria-label='Настройка комнаты']",
        );
        return {
            template: getComputedStyle(element).gridTemplateColumns,
            railBottom: railElement?.getBoundingClientRect().bottom ?? 0,
            planTop: planElement?.getBoundingClientRect().top ?? 0,
            setupTop: setupElement?.getBoundingClientRect().top ?? 0,
        };
    });
    expect(order.template.split(" ")).toHaveLength(1);
    expect(order.planTop).toBeGreaterThanOrEqual(order.railBottom);
    expect(order.setupTop).toBeGreaterThan(order.planTop);
});

test("desktop keeps the results strip in page flow instead of a hidden canvas scroll", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop workspace is covered once");
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    const worktable = page.locator("[data-planner-primary-worktable='true']");
    const lab = page.getByRole("heading", { name: "Лаборатория расстановки", exact: true });

    const layout = await page.evaluate(() => {
        const worktable = document.querySelector<HTMLElement>(
            "[data-planner-primary-worktable='true']",
        );
        const lab = document.getElementById("design-lab-heading");
        if (!worktable || !lab) return null;

        const worktableBox = worktable.getBoundingClientRect();
        const labBox = lab.getBoundingClientRect();
        return {
            hiddenOverflow: getComputedStyle(worktable).overflowY,
            scrollHeight: worktable.scrollHeight,
            clientHeight: worktable.clientHeight,
            labTop: labBox.top,
            worktableBottom: worktableBox.bottom,
        };
    });

    expect(layout).not.toBeNull();
    if (!layout) throw new Error("Planner worktable is unavailable");
    expect(layout.hiddenOverflow).not.toBe("auto");
    expect(layout.scrollHeight - layout.clientHeight).toBeLessThanOrEqual(1);
    expect(layout.labTop).toBeGreaterThanOrEqual(layout.worktableBottom);

    await lab.scrollIntoViewIfNeeded();
    await expect(lab).toBeInViewport();
});

test("tablet app bar and mobile catalogue remain contained and touch-safe", async ({
    page,
}, testInfo) => {
    if (testInfo.project.name === "desktop-chromium") {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto("/planner/layout", { waitUntil: "networkidle" });

        const tablet = await page.evaluate(() => {
            const header = document.querySelector<HTMLElement>("[data-planner-app-bar='true']");
            const identity = header?.querySelector<HTMLElement>("h1");
            return {
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                headerWidth: header?.getBoundingClientRect().width ?? 0,
                titleWidth: identity?.getBoundingClientRect().width ?? 0,
            };
        });
        expect(tablet.documentWidth).toBeLessThanOrEqual(tablet.viewportWidth);
        expect(tablet.headerWidth).toBeLessThanOrEqual(tablet.viewportWidth);
        expect(tablet.titleWidth).toBeGreaterThan(180);
        return;
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/planner/layout", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Править комнату", exact: true }).click();

    const containment = await page.evaluate(() => {
        const opening = document.querySelector<HTMLElement>("[data-room-opening='window']");
        const row = document
            .querySelector<HTMLElement>("input:checked")
            ?.closest<HTMLElement>("div");
        const select = row?.querySelector<HTMLElement>("select");
        const priority = select?.closest<HTMLElement>("label")?.querySelector<HTMLElement>("span");
        const openingBox = opening?.getBoundingClientRect();
        const priorityBox = priority?.getBoundingClientRect();
        const selectBox = select?.getBoundingClientRect();

        return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            openingThinSide: openingBox ? Math.min(openingBox.width, openingBox.height) : 0,
            priorityBottom: priorityBox?.bottom ?? 0,
            selectTop: selectBox?.top ?? 0,
        };
    });

    expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth);
    expect(containment.openingThinSide).toBeGreaterThanOrEqual(44);
    expect(containment.selectTop).toBeGreaterThanOrEqual(containment.priorityBottom - 1);
});

test("catalogue search and filters preserve selected furniture without overlapping its controls", async ({
    page,
}, testInfo) => {
    await page.setViewportSize(
        testInfo.project.name === "desktop-chromium"
            ? { width: 768, height: 1024 }
            : { width: 375, height: 812 },
    );
    await page.goto("/planner/layout", { waitUntil: "networkidle" });
    await page.locator("#planner-tool-furniture").scrollIntoViewIfNeeded();

    const search = page.getByRole("searchbox", { name: "Поиск мебели" });
    await expect(search).toBeVisible();
    await search.fill("кресло");
    await expect
        .poll(() =>
            page.locator("[data-catalog-item]").evaluateAll((items) =>
                items.map((item) => ({
                    id: item.getAttribute("data-catalog-item"),
                    text: item.textContent,
                })),
            ),
        )
        .toEqual([
            {
                id: "armchair",
                text: expect.stringContaining("Кресло"),
            },
        ]);
    await expect(page.locator("[data-catalog-item]")).toContainText("Кресло");
    await page.getByRole("button", { name: "Очистить поиск мебели" }).click();

    await page.getByRole("button", { name: "Выбрано", exact: true }).click();
    const rows = page.locator("[data-catalog-item][data-selected='true']");
    await expect(rows).toHaveCount(4);
    await expect(page.locator("[data-catalog-item]:not([data-selected='true'])")).toHaveCount(0);

    const noOverlaps = await rows.evaluateAll((catalogRows) =>
        catalogRows.map((row) => {
            const itemLabel = row.querySelector<HTMLElement>("[data-catalog-item-label='true']");
            const priority = row.querySelector<HTMLElement>("[data-catalog-priority='true']");
            const counter = row.querySelector<HTMLElement>("output")?.parentElement;
            const itemBox = itemLabel?.getBoundingClientRect();
            const priorityBox = priority?.getBoundingClientRect();
            const counterBox = counter?.getBoundingClientRect();
            return {
                definition: row.getAttribute("data-catalog-item"),
                itemBottom: itemBox?.bottom ?? Number.POSITIVE_INFINITY,
                counterTop: counterBox?.top ?? Number.NEGATIVE_INFINITY,
                counterBottom: counterBox?.bottom ?? Number.POSITIVE_INFINITY,
                priorityTop: priorityBox?.top ?? Number.NEGATIVE_INFINITY,
            };
        }),
    );

    for (const row of noOverlaps) {
        expect(
            row.itemBottom,
            `${row.definition}: item label overlaps counter`,
        ).toBeLessThanOrEqual(row.counterTop + 1);
        expect(
            row.counterBottom,
            `${row.definition}: counter overlaps priority picker`,
        ).toBeLessThanOrEqual(row.priorityTop + 1);
    }
});

test("mobile room controls expose 44px targets without changing visible opening colors", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Touch target geometry is covered once");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/planner/layout", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Править комнату", exact: true }).click();

    const targets = await page.evaluate(() => {
        const selectors = [
            "[data-room-opening='door']",
            "[data-room-opening='window']",
            "[data-room-vertex='rect-top-left']",
        ];
        return selectors.map((selector) => {
            const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
            return { selector, width: box?.width ?? 0, height: box?.height ?? 0 };
        });
    });
    for (const target of targets) {
        expect(target.width, `${target.selector} width`).toBeGreaterThanOrEqual(44);
        expect(target.height, `${target.selector} height`).toBeGreaterThanOrEqual(44);
    }

    const steppers = [
        page.getByRole("link", { name: "Изменить комнату в чертеже" }),
        page.getByRole("button", { name: /Изменить ширину комнаты/ }),
        page.getByRole("button", { name: "Начать вручную" }),
    ];
    for (const control of steppers) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
    }
});

test("desktop keeps the primary action visible on a 1440 by 1000 worktable", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Laptop height is covered once");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    await expect(page.locator("[data-project-status='true']")).toBeHidden();
    const primaryAction = page.getByRole("button", { name: "Уместить всё", exact: true });
    await expect(primaryAction).toBeInViewport();
    const box = await primaryAction.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? Number.POSITIVE_INFINITY) + (box?.height ?? 0)).toBeLessThanOrEqual(1000);
});

test("desktop fitted plan contains the room and edit controls without an internal scroll", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop fit is covered once");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    const readFit = () =>
        page.evaluate(() => {
            const viewport = document.querySelector<HTMLElement>(
                "[aria-label='Прокручиваемая область плана']",
            );
            if (!viewport) return null;

            const viewportBox = viewport.getBoundingClientRect();
            const targets = [
                "[data-manual-drop-room='true']",
                "[data-room-opening='door']",
                "[data-room-opening='window']",
                "[aria-label^='Изменить ширину комнаты']",
                "[aria-label^='Изменить глубину комнаты']",
            ]
                .map((selector) => {
                    const target = document.querySelector<HTMLElement>(selector);
                    const box = target?.getBoundingClientRect();
                    return {
                        selector,
                        present: Boolean(target),
                        contained: Boolean(
                            box &&
                                box.left >= viewportBox.left - 1 &&
                                box.top >= viewportBox.top - 1 &&
                                box.right <= viewportBox.right + 1 &&
                                box.bottom <= viewportBox.bottom + 1,
                        ),
                    };
                })
                .filter((target) => target.present);

            return {
                zoom: viewport.dataset.planZoom,
                overflowX: viewport.scrollWidth - viewport.clientWidth,
                overflowY: viewport.scrollHeight - viewport.clientHeight,
                targets,
            };
        });

    const expectFittedCanvas = async (expectedControlCount: number) => {
        await expect
            .poll(async () => {
                const metrics = await readFit();
                return metrics?.overflowY ?? Number.POSITIVE_INFINITY;
            })
            .toBeLessThanOrEqual(1);

        const metrics = await readFit();
        expect(metrics).not.toBeNull();
        if (!metrics) throw new Error("Planner canvas is unavailable");
        expect(metrics.zoom).toBe("fit");
        expect(metrics.overflowX).toBeLessThanOrEqual(1);
        expect(metrics.overflowY).toBeLessThanOrEqual(1);
        expect(metrics.targets).toHaveLength(expectedControlCount);
        for (const target of metrics.targets) {
            expect(target.contained, `${target.selector} is clipped in fitted plan`).toBe(true);
        }
    };

    await expectFittedCanvas(3);

    await page.getByRole("button", { name: "Править комнату", exact: true }).click();
    await expect(page.getByRole("button", { name: /Изменить ширину комнаты/ })).toBeVisible();
    await expectFittedCanvas(5);

    await page.getByRole("button", { name: "Вместить план по ширине" }).click();
    await expectFittedCanvas(5);
});

test("resetting the demo planner returns to the uncalculated room without a solver error", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Reset is covered once on desktop");
    await page.goto("/planner/layout", { waitUntil: "networkidle" });

    const size = page.locator("[data-room-summary] [data-room-width]");
    await page.getByRole("button", { name: "Править комнату", exact: true }).click();
    await page.getByRole("button", { name: /Изменить ширину комнаты/ }).press("ArrowRight");
    await expect(size).toHaveAttribute("data-room-width", "6050");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();

    await expect(size).toHaveAttribute("data-room-width", "6000");
    await expect(page.locator("[data-planner-app-bar='true']")).toContainText("Комната готова");
    await expect(
        page.getByRole("status").filter({ hasText: "Расстановка не рассчитана" }),
    ).toBeVisible();
    await expect(page.getByText("Лимит расчёта исчерпан")).toHaveCount(0);
});
