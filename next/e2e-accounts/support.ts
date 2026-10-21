import { randomInt, randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CURRENT_CONSENT_VERSION } from "../src/shared/legal/consent";

/**
 * Every browser context comes from its own client address, as separate people
 * would: the API's sign-up and sign-in limits are per address, and the dev
 * server's proxy forwards this one (TRUST_PROXY_HOPS=2 in the config).
 */
export const test = base.extend({
    context: async ({ browser, contextOptions }, provide) => {
        const context = await browser.newContext({
            ...contextOptions,
            extraHTTPHeaders: {
                "X-Forwarded-For": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
            },
        });
        await provide(context);
        await context.close();
    },
});

export { expect };

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "";
export const PASSWORD = "correct-horse-42";
const API_HEADERS = { "X-Requested-With": "stylefinder", Origin: "http://localhost:3200" };

export interface Account {
    name: string;
    email: string;
    password: string;
}

export const newAccount = (name = "Тестовый пользователь"): Account => ({
    name,
    email: `e2e-${randomUUID().slice(0, 12)}@example.test`,
    password: PASSWORD,
});

/** Signs up through the API; the session cookie lands in the page's context. */
export const registerByApi = async (page: Page, account: Account = newAccount()) => {
    const response = await page.request.post("/api/auth/register", {
        headers: API_HEADERS,
        data: { ...account, consentVersion: CURRENT_CONSENT_VERSION },
    });
    expect(response.status(), await response.text()).toBe(201);
    return account;
};

export const loginByApi = (request: APIRequestContext, account: Account) =>
    request.post("/api/auth/login", {
        headers: API_HEADERS,
        data: { email: account.email, password: account.password },
    });

/** Signs up through the site's own dialog, as a person would. */
export const registerByUi = async (page: Page, account: Account = newAccount()) => {
    await page
        .getByRole("navigation", { name: "Основная навигация" })
        .getByRole("button", { name: /Войти/ })
        .first()
        .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Зарегистрироваться" }).click();
    await dialog.getByPlaceholder("Введите ваше имя").fill(account.name);
    await dialog.getByPlaceholder("name@example.com").fill(account.email);
    await dialog.getByPlaceholder("Введите пароль").fill(account.password);
    await dialog.getByText("Я даю согласие на обработку моих персональных данных").click();
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
    return account;
};

export const loginByUi = async (page: Page, account: Account) => {
    await page
        .getByRole("navigation", { name: "Основная навигация" })
        .getByRole("button", { name: /Войти/ })
        .first()
        .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("name@example.com").fill(account.email);
    await dialog.getByPlaceholder("Введите пароль").fill(account.password);
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
};

/** A project saved in the account, with an optional planner room. */
export const createProjectByApi = async (page: Page, document: object, name?: string) => {
    const response = await page.request.post("/api/projects", {
        headers: API_HEADERS,
        data: { document, ...(name ? { name } : {}) },
    });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { project: { id: string } }).project;
};

export const getProjectByApi = (page: Page, id: string) => page.request.get(`/api/projects/${id}`);

/** A one-bed project in a 6 × 4.6 m room, ready for the layout step. */
export const projectDocument = (styleLabel = "Прованс") => ({
    version: 5,
    updatedAt: Date.now(),
    questionnaire: {
        items: [{ definitionId: "single-bed", count: 1, priority: "required" }],
        meta: { styleKey: "provence", styleLabel },
    },
    planner: {
        room: {
            width: 6000,
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
        },
        selection: { "single-bed": 1 },
        priorities: { "single-bed": "required" },
    },
});

interface MailpitSummary {
    ID: string;
    Subject: string;
    To: Array<{ Address: string }>;
}

/** Waits for the newest letter to `to` and returns the site link in it. */
export const linkFromMail = async (to: string, path: "/auth/verify" | "/auth/reset") => {
    if (!MAILPIT_URL) throw new Error("E2E_MAILPIT_URL is not set");
    const pattern = new RegExp(`https?://[^\\s"<>]+${path}\\?token=[A-Za-z0-9_-]+`);
    let link: string | null = null;
    await expect
        .poll(
            async () => {
                const search = await fetch(
                    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
                );
                const { messages } = (await search.json()) as { messages: MailpitSummary[] };
                for (const message of messages) {
                    const body = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
                    const { Text } = (await body.json()) as { Text: string };
                    const match = Text.match(pattern);
                    if (match) {
                        link = match[0];
                        return true;
                    }
                }
                return false;
            },
            { timeout: 20_000, message: `letter with ${path} to ${to}` },
        )
        .toBe(true);
    // Letters point at the configured public origin; keep the test's own origin.
    const url = new URL(link!);
    return `${url.pathname}${url.search}`;
};

export const projectBar = (page: Page) => page.locator('[data-project-bar="true"]');

/** The project bar has reported a completed save. */
export const expectSaved = async (page: Page) => {
    await expect(projectBar(page).getByRole("status")).toHaveText(/Сохранено/, {
        timeout: 30_000,
    });
};
