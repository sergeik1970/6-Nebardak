import { test, expect } from "@playwright/test";

test("sliding door clamps at full-travel obstacles and allows movement finer than the wall grid", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const points = [
        [1000, 1000],
        [1400, 1000],
        [4750, 1000],
        [4750, 4500],
        [1000, 4500],
    ];
    const scene = {
        segments: points
            .map(([x, y], i) => ({
                id: "w" + i,
                start: { x, y },
                end: {
                    x: points[(i + 1) % points.length][0],
                    y: points[(i + 1) % points.length][1],
                },
            }))
            .concat([{ id: "cross", start: { x: 1400, y: 1000 }, end: { x: 1400, y: 1900 } }]),
        doors: [
            {
                id: "d",
                wall: "top",
                segmentId: "segment-v1",
                offset: 450,
                width: 1600,
                clearanceDepth: 1600,
                doorKind: "sliding-double",
                drawingHostId: "w0",
            },
        ],
        windows: [],
        wallThickness: 50,
    };
    await page.addInitScript((s) => {
        if (!localStorage.getItem("stylefinder:draw-room-editor:v1"))
            localStorage.setItem("stylefinder:draw-room-editor:v1", JSON.stringify(s));
    }, scene);
    await page.goto("/planner/draw", { waitUntil: "networkidle" });
    const door = page.locator('[data-draw-room-opening="door"]');
    await expect(door).toHaveCount(1);
    async function move(leaf: number, dx: number, dy: number) {
        const target = door.locator("[data-sliding-leaf]").nth(leaf);
        const p = await target.evaluate((e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
        const scale = await page
            .locator("[data-draw-room-board]")
            .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x + dx * scale, p.y + dy * scale, { steps: 12 });
        await page.mouse.up();
    }
    const offset = () =>
        page.evaluate(
            () =>
                JSON.parse(localStorage.getItem("stylefinder:draw-room-editor:v1")!).doors[0]
                    .offset,
        );
    await move(1, 800, 500);
    await expect.poll(offset).toBe(1250);
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect.poll(offset).toBe(450);
    await move(0, 800, 0);
    await expect.poll(offset).toBe(1250);
    await move(0, -800, 0);
    await expect.poll(offset).toBe(1210);
    await move(1, 800, 0);
    await expect.poll(offset).toBe(1290);
    await move(1, -20, 0);
    await expect.poll(offset).toBe(1270);
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(offset).toBe(1270);
    expect(
        await page.evaluate(
            () => JSON.parse(localStorage.getItem("stylefinder:draw-room-editor:v1")!).segments,
        ),
    ).toEqual(scene.segments);
});
