import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        exclude: ["e2e/**", "node_modules/**", ".next/**"],
        // Solver scenarios take 3–16 s on an idle machine; the 5 s default flakes under CPU load.
        // CI runners are several times slower, so they get a proportionally longer limit.
        testTimeout: process.env.CI ? 120_000 : 30_000,
        // The 4-vCPU CI runner starves vitest's RPC ("Timeout calling onTaskUpdate")
        // when every core runs a CPU-bound solver suite.
        maxWorkers: process.env.CI ? 2 : undefined,
    },
});
