import { defineConfig, devices } from "@playwright/test";

/**
 * Account flows against a real API, database and mail catcher. Started by
 * `npm run test:e2e:accounts` (scripts/e2e-accounts.sh), which provides the
 * PostgreSQL and Mailpit ports below.
 */
const NEXT_PORT = 3200;
const API_PORT = 3201;
// Cookies and the CSRF Origin check need the exact origin the API expects.
const ORIGIN = `http://localhost:${NEXT_PORT}`;

const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set; run npm run test:e2e:accounts`);
    return value;
};

export default defineConfig({
    testDir: "./e2e-accounts",
    outputDir: "./test-results/accounts",
    // The dev server compiles each page on its first visit.
    timeout: 120_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI
        ? [["line"], ["html", { outputFolder: "playwright-report/accounts", open: "never" }]]
        : "list",
    use: {
        baseURL: ORIGIN,
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "desktop-chromium",
            use: { ...devices["Desktop Chrome"] },
            grepInvert: /@mobile/,
        },
        {
            name: "mobile-chromium",
            use: { ...devices["Pixel 7"] },
            grep: /@mobile/,
        },
    ],
    webServer: [
        {
            command: "npm run start",
            cwd: "../nest",
            url: `http://127.0.0.1:${API_PORT}/api/health`,
            reuseExistingServer: false,
            timeout: 180_000,
            env: {
                NODE_ENV: "test",
                PORT: String(API_PORT),
                DB_HOST: "127.0.0.1",
                DB_PORT: required("E2E_DB_PORT"),
                DB_USERNAME: "postgres",
                DB_PASSWORD: required("E2E_DB_PASSWORD"),
                DB_NAME: "stylefinder_e2e",
                PUBLIC_ORIGIN: ORIGIN,
                SMTP_HOST: "127.0.0.1",
                SMTP_PORT: required("E2E_SMTP_PORT"),
                SMTP_FROM: "StyleFinder <no-reply@stylefinder.test>",
                AUTH_ENABLED: "true",
                AUTH_REGISTRATION_ENABLED: "true",
                // The dev server adds one forwarding hop; each test brings its
                // own client address, so sign-up limits apply per test.
                TRUST_PROXY_HOPS: "2",
            },
        },
        {
            command: `npx next dev --webpack --port ${NEXT_PORT}`,
            url: `${ORIGIN}/projects`,
            reuseExistingServer: false,
            timeout: 180_000,
            env: {
                NEXT_PUBLIC_API_URL: "/api",
                NEXT_PUBLIC_AUTH_ENABLED: "true",
                NEXT_PUBLIC_AUTH_REGISTRATION_ENABLED: "true",
                API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
            },
        },
    ],
});
