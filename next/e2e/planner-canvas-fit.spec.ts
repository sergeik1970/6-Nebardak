import { expect, test } from "@playwright/test";

const getScrollMetrics = (selector: string) =>
    document.querySelector<HTMLElement>(selector)
        ? (() => {
              const element = document.querySelector<HTMLElement>(selector)!;
              return {
                  clientHeight: element.clientHeight,
                  clientWidth: element.clientWidth,
                  scrollHeight: element.scrollHeight,
                  scrollLeft: element.scrollLeft,
                  scrollTop: element.scrollTop,
                  scrollWidth: element.scrollWidth,
              };
          })()
        : null;

test("normal plan stays unobstructed and fits before intentional zoom", async ({ page }) => {
    await page.goto("/planner", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Начать вручную" }).click();

    const viewport = page.getByLabel("Прокручиваемая область плана");
    const room = page.getByRole("group", { name: /План комнаты/ });

    await expect(viewport).toHaveAttribute("data-plan-zoom", "fit");
    await expect(room).toBeVisible();
    await expect(page.getByText("Комната готова к работе")).toHaveCount(0);
    await expect(page.locator("[data-plan-idle-guidance='true']")).toBeVisible();

    await expect
        .poll(() => page.evaluate(getScrollMetrics, "[aria-label='Прокручиваемая область плана']"))
        .toMatchObject({ scrollLeft: 0, scrollTop: 0 });
    const fitMetrics = await page.evaluate(
        getScrollMetrics,
        "[aria-label='Прокручиваемая область плана']",
    );
    expect(fitMetrics).not.toBeNull();
    if (!fitMetrics) throw new Error("Plan viewport is unavailable");
    expect(fitMetrics.scrollWidth - fitMetrics.clientWidth).toBe(0);
    expect(fitMetrics.scrollHeight - fitMetrics.clientHeight).toBeLessThanOrEqual(2);

    const [viewportBox, roomBox] = await Promise.all([viewport.boundingBox(), room.boundingBox()]);
    expect(viewportBox).not.toBeNull();
    expect(roomBox).not.toBeNull();
    if (!viewportBox || !roomBox) throw new Error("Plan bounds are unavailable");
    expect(roomBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(roomBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(roomBox.x + roomBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + 1);
    expect(roomBox.y + roomBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height + 1);

    await page.getByRole("button", { name: "Править комнату" }).click();
    await expect(room).toHaveAttribute("data-room-editing", "true");
    await expect
        .poll(() =>
            page.evaluate((selector) => {
                const element = document.querySelector<HTMLElement>(selector);
                if (!element) return Number.POSITIVE_INFINITY;
                return element.scrollWidth - element.clientWidth;
            }, "[aria-label='Прокручиваемая область плана']"),
        )
        .toBe(0);
    await page.getByRole("button", { name: "Готово с проёмами" }).click();

    await page.getByRole("button", { name: "Увеличить план" }).click();
    await expect(viewport).toHaveAttribute("data-plan-zoom", "manual");
    await expect(page.getByRole("button", { name: "Вместить план по ширине" })).toContainText(
        "125%",
    );
    await expect
        .poll(() => page.evaluate(getScrollMetrics, "[aria-label='Прокручиваемая область плана']"))
        .toMatchObject({ scrollWidth: expect.any(Number) });
    const zoomMetrics = await page.evaluate(
        getScrollMetrics,
        "[aria-label='Прокручиваемая область плана']",
    );
    expect(zoomMetrics).not.toBeNull();
    if (!zoomMetrics) throw new Error("Plan viewport is unavailable after zoom");
    expect(
        zoomMetrics.scrollWidth > zoomMetrics.clientWidth ||
            zoomMetrics.scrollHeight > zoomMetrics.clientHeight,
    ).toBe(true);

    await page.getByRole("button", { name: "Вместить план по ширине" }).click();
    await expect(viewport).toHaveAttribute("data-plan-zoom", "fit");
    const restoredMetrics = await page.evaluate(
        getScrollMetrics,
        "[aria-label='Прокручиваемая область плана']",
    );
    expect(restoredMetrics).not.toBeNull();
    if (!restoredMetrics) throw new Error("Plan viewport is unavailable after reset");
    expect(restoredMetrics.scrollWidth - restoredMetrics.clientWidth).toBe(0);
    expect(restoredMetrics.scrollHeight - restoredMetrics.clientHeight).toBeLessThanOrEqual(2);
    expect(restoredMetrics.scrollLeft).toBe(0);
    expect(restoredMetrics.scrollTop).toBe(0);
});
