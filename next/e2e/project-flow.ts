import { expect, type Page } from "@playwright/test";

/**
 * Shared steps for the project path. Room sizes are no longer typed into the
 * planner: a room comes from the drawing step, or — for tests of the
 * planner's own geometry editing — from a saved draft.
 */

/** The planner's starter room turned into an L by «Г справа» (6 × 4.6 m). */
/** Builds a rectangular room on the drawing step (starter door and window included). */
export const buildRectRoom = async (page: Page, width = "6", depth = "4,6") => {
    await expect(page.locator("[data-draw-room-board='true']")).toBeVisible();
    await page.getByRole("button", { name: "Прямоугольная комната по размерам" }).click();
    const dialog = page.getByRole("dialog", { name: "Прямоугольная комната" });
    await dialog.getByLabel("Ширина, м").fill(width);
    await dialog.getByLabel("Глубина, м").fill(depth);
    await dialog.getByRole("button", { name: "Построить" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("[data-draw-room-preview='true']")).toBeVisible();
    await expect(page.getByRole("button", { name: "К итогу" })).toBeEnabled();
};
