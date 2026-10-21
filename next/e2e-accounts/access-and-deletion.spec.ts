import {
    createProjectByApi,
    expect,
    getProjectByApi,
    loginByApi,
    projectDocument,
    registerByApi,
    test,
} from "./support";

test("another account cannot open someone else's project", async ({ page, browser }) => {
    await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument("Лофт"), "Чужой проект");

    const strangerContext = await browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": "10.253.0.1" },
    });
    const stranger = await strangerContext.newPage();
    await registerByApi(stranger);

    await stranger.goto(`/planner?project=${project.id}`, { waitUntil: "networkidle" });
    await expect(stranger.getByRole("heading", { name: "Проект не найден" })).toBeVisible();
    await expect(stranger.getByText("Лофт")).toHaveCount(0);

    // Every method answers as if the project did not exist.
    const headers = { "X-Requested-With": "stylefinder", Origin: "http://localhost:3200" };
    const base = `/api/projects/${project.id}`;
    const answers = await Promise.all([
        stranger.request.get(base),
        stranger.request.patch(base, { headers, data: { name: "Моё" } }),
        stranger.request.put(`${base}/document`, {
            headers,
            data: { document: projectDocument(), baseRevision: 1 },
        }),
        stranger.request.post(`${base}/duplicate`, { headers }),
        stranger.request.delete(base, { headers }),
    ]);
    expect(answers.map((answer) => answer.status())).toEqual([404, 404, 404, 404, 404]);
    await strangerContext.close();

    // The owner's project is untouched.
    const own = await getProjectByApi(page, project.id);
    expect(own.status()).toBe(200);
    expect(((await own.json()) as { project: { name: string } }).project.name).toBe("Чужой проект");
});

test("a deleted account can no longer sign in and its projects are gone", async ({ page }) => {
    const account = await registerByApi(page);
    const project = await createProjectByApi(page, projectDocument(), "Удаляемый");

    await page.goto("/account", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Удалить аккаунт…" }).click();
    await page.getByLabel("Введите пароль, чтобы подтвердить удаление").fill(account.password);
    await page.getByRole("button", { name: "Удалить навсегда" }).click();
    await expect(page.getByRole("heading", { name: "Аккаунт удалён" })).toBeVisible();

    expect((await getProjectByApi(page, project.id)).status()).toBe(401);
    expect((await loginByApi(page.request, account)).status()).toBe(401);

    // The same address can sign up again and starts empty.
    await registerByApi(page, account);
    expect((await getProjectByApi(page, project.id)).status()).toBe(404);
    const list = await page.request.get("/api/projects");
    expect(((await list.json()) as { projects: unknown[] }).projects).toEqual([]);
});
