import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: "./e2e",
    outputDir: "./test-results",
    // Full questionnaire/solver/export flows need headroom on a cold standalone server.
    timeout: 60_000,
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    // Solver/export flows are CPU-heavy; one browser keeps the standalone server deterministic.
    workers: 1,
    reporter: process.env.CI
        ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
        : "list",
    use: {
        baseURL,
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    projects: [
        {
            name: "desktop-chromium",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "mobile-chromium",
            use: { ...devices["Pixel 7"] },
        },
    ],
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: `npm run start:standalone -- --hostname 127.0.0.1 --port ${PORT}`,
              url: baseURL,
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
          },
});
