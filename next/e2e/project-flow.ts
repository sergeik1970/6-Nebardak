import { expect, type Page } from "@playwright/test";

/**
 * Shared steps for the project path. Room sizes are no longer typed into the
 * planner: a room comes from the drawing step, or — for tests of the
 * planner's own geometry editing — from a saved draft.
 */

/** The planner's starter room turned into an L by «Г справа» (6 × 4.6 m). */
export const L_ROOM_RIGHT = {
    width: 6000,
    depth: 4600,
    partitions: [],
    doors: [
        {
            id: "door-main",
            wall: "bottom",
            offset: 500,
            width: 900,
            clearanceDepth: 900,
            hinge: "start",
            swingDirection: "inward",
            doorKind: "room",
            segmentId: "segment-v5",
        },
    ],
    radiators: [],
    windows: [
        {
            id: "window-main",
            wall: "top",
            offset: 1800,
            width: 1800,
            windowKind: "standard",
            segmentId: "segment-v1",
        },
    ],
    geometry: {
        version: 1,
        kind: "orthogonal",
        vertices: [
            {
                id: "v1",
                x: 0,
                y: 0,
            },
            {
                id: "v2",
                x: 3600,
                y: 0,
            },
            {
                id: "v3",
                x: 3600,
                y: 1850,
            },
            {
                id: "v4",
                x: 6000,
                y: 1850,
            },
            {
                id: "v5",
                x: 6000,
                y: 4600,
            },
            {
                id: "v6",
                x: 0,
                y: 4600,
            },
        ],
    },
};

/** The 10 × 10 m starter room turned into an L the same way. */
export const L_ROOM_RIGHT_10M = {
    width: 10000,
    depth: 10000,
    partitions: [],
    doors: [
        {
            id: "door-main",
            wall: "bottom",
            offset: 500,
            width: 900,
            clearanceDepth: 900,
            hinge: "start",
            swingDirection: "inward",
            doorKind: "room",
            segmentId: "segment-v5",
        },
    ],
    radiators: [],
    windows: [
        {
            id: "window-main",
            wall: "top",
            offset: 4100,
            width: 1800,
            windowKind: "standard",
            segmentId: "segment-v1",
        },
    ],
    geometry: {
        version: 1,
        kind: "orthogonal",
        vertices: [
            {
                id: "v1",
                x: 0,
                y: 0,
            },
            {
                id: "v2",
                x: 6000,
                y: 0,
            },
            {
                id: "v3",
                x: 6000,
                y: 4000,
            },
            {
                id: "v4",
                x: 10000,
                y: 4000,
            },
            {
                id: "v5",
                x: 10000,
                y: 10000,
            },
            {
                id: "v6",
                x: 0,
                y: 10000,
            },
        ],
    },
};

const DRAFT_KEY = "stylefinder:project-draft:v4";

/**
 * Opens the planner with `room` already saved, as if it came from the room
 * step. The draft is written once per test, so a reload keeps later edits.
 */
export const openPlannerWithRoom = async (page: Page, room: object) => {
    const draft = {
        version: 4,
        updatedAt: Date.now(),
        questionnaire: {
            items: [{ definitionId: "single-bed", count: 1, priority: "required" }],
        },
        planner: {
            room,
            selection: { "single-bed": 1 },
            priorities: { "single-bed": "required" },
        },
    };
    await page.addInitScript(
        ([key, value]) => {
            if (sessionStorage.getItem("e2e:draft-seeded")) return;
            sessionStorage.setItem("e2e:draft-seeded", "1");
            localStorage.setItem(key, value);
        },
        [DRAFT_KEY, JSON.stringify(draft)] as const,
    );
    await page.goto("/planner", { waitUntil: "networkidle" });
};

/** Clear room size in millimetres, as the room summary reports it. */
export const readRoomSize = async (page: Page) => {
    const size = page.locator("[data-room-summary] [data-room-width]");
    const [width, depth] = await Promise.all([
        size.getAttribute("data-room-width"),
        size.getAttribute("data-room-depth"),
    ]);
    return { width: Number(width), depth: Number(depth) };
};

/** Builds a rectangular room on the drawing step (starter door and window included). */
export const buildRectRoom = async (page: Page, width = "6", depth = "4,6") => {
    await expect(page.locator("[data-draw-room-board='true']")).toBeVisible();
    await page.getByRole("button", { name: "Прямоугольная комната по размерам" }).click();
    const dialog = page.getByRole("dialog", { name: "Прямоугольная комната" });
    await dialog.getByLabel("Ширина, м").fill(width);
    await dialog.getByLabel("Глубина, м").fill(depth);
    await dialog.getByRole("button", { name: "Построить" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Продолжить с комнатой" })).toBeEnabled();
};

/**
 * From a filled questionnaire through the room step to the layout step,
 * keeping the questionnaire's furniture set.
 */
export const continueThroughRoomStep = async (page: Page, width = "6", depth = "4,6") => {
    await Promise.all([
        page.waitForURL(/\/planner\/draw\?handoff=/, { timeout: 60_000, waitUntil: "commit" }),
        page.getByRole("button", { name: "Дальше: комната" }).click(),
    ]);
    await buildRectRoom(page, width, depth);
    await Promise.all([
        page.waitForURL(/\/planner\?(?:drawRoom=1&)?handoff=/, {
            timeout: 60_000,
            waitUntil: "commit",
        }),
        page.getByRole("button", { name: "Продолжить с комнатой" }).click(),
    ]);
    await expect(page.locator("[data-room-summary]")).toBeVisible();
};
