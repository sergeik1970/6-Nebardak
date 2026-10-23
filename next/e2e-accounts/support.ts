import { execFileSync } from "node:child_process";
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

/**
 * Waits for the newest letter to `to` whose text matches `pattern` and
 * returns the match (its first group, if any) unless it equals `stale`.
 */
const findInMail = async (
    to: string,
    pattern: RegExp,
    what: string,
    stale?: string,
): Promise<string> => {
    if (!MAILPIT_URL) throw new Error("E2E_MAILPIT_URL is not set");
    let found: string | null = null;
    await expect
        .poll(
            async () => {
                const search = await fetch(
                    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
                );
                // Mailpit lists the newest letter first.
                const { messages } = (await search.json()) as { messages: MailpitSummary[] };
                for (const message of messages) {
                    const body = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
                    const { Text } = (await body.json()) as { Text: string };
                    const match = Text.match(pattern);
                    if (match) {
                        found = match[1] ?? match[0];
                        return found !== stale;
                    }
                }
                return false;
            },
            { timeout: 20_000, message: `letter with ${what} to ${to}` },
        )
        .toBe(true);
    return found!;
};

/** Waits for the newest letter to `to` and returns the site link in it. */
export const linkFromMail = async (to: string, path: "/auth/verify" | "/auth/reset") => {
    const link = await findInMail(
        to,
        new RegExp(`https?://[^\\s"<>]+${path}\\?token=[A-Za-z0-9_-]+`),
        path,
    );
    // Letters point at the configured public origin; keep the test's own origin.
    const url = new URL(link);
    return `${url.pathname}${url.search}`;
};

/** The newest administrator sign-in code sent to `to`, once it differs from `previous`. */
export const loginCodeFromMail = (to: string, previous?: string) =>
    findInMail(to, /^(\d{6})$/m, "a sign-in code", previous);

/**
 * Elevates an account the way `npm run admin:grant` does: role and the end
 * of every earlier session. Straight SQL in the throwaway database container.
 */
export const grantAdmin = (email: string) => {
    const container = process.env.E2E_DB_CONTAINER;
    if (!container) throw new Error("E2E_DB_CONTAINER is not set");
    const sql = `UPDATE "user" SET "role" = 'admin' WHERE "email" = '${email.replace(/'/g, "''")}';
        DELETE FROM "user_session" WHERE "user_id" IN (SELECT "id" FROM "user" WHERE "email" = '${email.replace(/'/g, "''")}');`;
    execFileSync("docker", [
        "exec",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "stylefinder_e2e",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
    ]);
};

export const projectBar = (page: Page) => page.locator('[data-project-bar="true"]');

/** The project bar has reported a completed save. */
export const expectSaved = async (page: Page) => {
    await expect(projectBar(page).getByRole("status")).toHaveText(/Сохранено/, {
        timeout: 30_000,
    });
};
