import { expect, test } from "@playwright/test";

const CURRENT_KEY = "stylefinder:project-draft:v4";
const V3_KEY = "stylefinder:project-draft:v3";
const V2_KEY = "stylefinder:project-draft:v2";
const LEGACY_KEY = "stylefinder:project-draft:v1";
const LEGACY_VISUAL_KEY = "stylefinder:visual-preference:v2";

const room = {
    width: 6200,
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
};

const projectInputs = {
    updatedAt: 1_750_000_000_000,
    questionnaire: {
        items: [{ definitionId: "single-bed", count: 1, priority: "required" }],
        meta: { styleKey: "provence", styleLabel: "Прованс" },
    },
    planner: {
        room,
        selection: { "single-bed": 1 },
        priorities: { "single-bed": "required" },
    },
};

test("legacy v1 project is migrated and its inputs remain editable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Draft recovery runs once on desktop");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), {
        key: LEGACY_KEY,
        draft: { version: 1, ...projectInputs },
    });

    await page.goto("/planner", { waitUntil: "networkidle" });

    // The header and the narrow-screen status row share this text; one of them is shown.
    await expect(
        page.getByText(/Черновик перенесён в новую версию/).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
    await expect(page.locator("[data-room-summary] [data-room-width]")).toHaveAttribute(
        "data-room-width",
        "6200",
    );
    await expect
        .poll(() =>
            page.evaluate(
                ({ currentKey, legacyKey }) => ({
                    current: JSON.parse(localStorage.getItem(currentKey) ?? "null"),
                    legacy: localStorage.getItem(legacyKey),
                }),
                { currentKey: CURRENT_KEY, legacyKey: LEGACY_KEY },
            ),
        )
        .toMatchObject({ current: { version: 4 }, legacy: null });
});

test("v2 project is migrated without losing room inputs", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Draft recovery runs once on desktop");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), {
        key: V2_KEY,
        draft: { version: 2, ...projectInputs },
    });

    await page.goto("/planner", { waitUntil: "networkidle" });

    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
    await expect(page.locator("[data-room-summary] [data-room-width]")).toHaveAttribute(
        "data-room-width",
        "6200",
    );
    await expect
        .poll(() =>
            page.evaluate(
                ({ currentKey, v2Key }) => ({
                    current: JSON.parse(localStorage.getItem(currentKey) ?? "null"),
                    v2: localStorage.getItem(v2Key),
                }),
                { currentKey: CURRENT_KEY, v2Key: V2_KEY },
            ),
        )
        .toMatchObject({ current: { version: 4 }, v2: null });
});

test("v3 project is migrated to v4 room geometry and segment anchors", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Draft recovery runs once on desktop");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), {
        key: V3_KEY,
        draft: { version: 3, ...projectInputs },
    });
    await page.goto("/planner", { waitUntil: "networkidle" });

    await expect
        .poll(() =>
            page.evaluate(
                ({ currentKey, v3Key }) => {
                    const current = JSON.parse(localStorage.getItem(currentKey) ?? "null");
                    return {
                        version: current?.version,
                        geometry: current?.planner?.room?.geometry,
                        doorSegmentId: current?.planner?.room?.doors?.[0]?.segmentId,
                        legacy: localStorage.getItem(v3Key),
                    };
                },
                { currentKey: CURRENT_KEY, v3Key: V3_KEY },
            ),
        )
        .toEqual({
            version: 4,
            geometry: { version: 1, kind: "rect" },
            doorSegmentId: "rect-bottom",
            legacy: null,
        });
});

test("invalid saved coordinates are dropped without losing room or furniture", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Draft recovery runs once on desktop");

    const invalidLayoutDraft = {
        version: 3,
        ...projectInputs,
        planner: {
            ...projectInputs.planner,
            layout: {
                variants: [],
                activeVariantId: null,
                editedVariantIds: [],
                placements: [
                    {
                        instanceId: "single-bed-1",
                        definitionId: "single-bed",
                        x: 9999,
                        y: 0,
                        rotation: 0,
                    },
                ],
                exploredNodes: 12,
                score: 100,
                notes: [],
                generatedAt: "2026-07-17T07:00:00.000Z",
            },
        },
    };

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), {
        key: CURRENT_KEY,
        draft: invalidLayoutDraft,
    });

    await page.goto("/planner", { waitUntil: "networkidle" });

    await expect(
        page.getByText(/Сохранённая расстановка больше не проходит проверку/),
    ).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Кровать 1-местная/ })).toBeChecked();
    await expect(page.locator("[data-room-summary] [data-room-width]")).toHaveAttribute(
        "data-room-width",
        "6200",
    );
    await expect(page.locator("[data-plan-idle-guidance='true']")).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), CURRENT_KEY),
        )
        .not.toHaveProperty("planner.layout");
});

test("visual-test progress restores from the unified draft in a new page", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Draft recovery runs once on desktop");

    await page.goto("/test", { waitUntil: "networkidle" });
    await expect(page.getByText("Сравнение 1 из 18")).toBeVisible();
    await page.getByRole("button", { name: "Выбрать левое изображение" }).click();
    await expect(page.getByText("Сравнение 2 из 18")).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(
                ({ projectKey, legacyVisualKey }) => {
                    const project = JSON.parse(localStorage.getItem(projectKey) ?? "null");
                    return {
                        version: project?.version,
                        answers: project?.visualTest?.answers?.length,
                        legacy: sessionStorage.getItem(legacyVisualKey),
                    };
                },
                { projectKey: CURRENT_KEY, legacyVisualKey: LEGACY_VISUAL_KEY },
            ),
        )
        .toEqual({ version: 4, answers: 1, legacy: null });

    const secondPage = await page.context().newPage();
    await secondPage.goto("/test", { waitUntil: "networkidle" });
    await expect(secondPage.getByText("Сравнение 2 из 18")).toBeVisible();
    await secondPage.close();
});

test("legacy session progress is migrated once into the unified draft", async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Draft recovery runs once on desktop");

    await page.goto("/test", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Выбрать левое изображение" }).click();
    await expect(page.getByText("Сравнение 2 из 18")).toBeVisible();
    await page.evaluate(
        ({ projectKey, legacyVisualKey }) => {
            const project = JSON.parse(localStorage.getItem(projectKey) ?? "null");
            sessionStorage.setItem(legacyVisualKey, JSON.stringify(project.visualTest));
            localStorage.removeItem(projectKey);
        },
        { projectKey: CURRENT_KEY, legacyVisualKey: LEGACY_VISUAL_KEY },
    );

    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByText("Сравнение 2 из 18")).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(
                ({ projectKey, legacyVisualKey }) => ({
                    project: JSON.parse(localStorage.getItem(projectKey) ?? "null"),
                    legacy: sessionStorage.getItem(legacyVisualKey),
                }),
                { projectKey: CURRENT_KEY, legacyVisualKey: LEGACY_VISUAL_KEY },
            ),
        )
        .toMatchObject({ project: { version: 4, visualTest: { answers: [{}] } }, legacy: null });
});
