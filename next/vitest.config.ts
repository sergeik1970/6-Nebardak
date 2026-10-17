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
        // Solver scenarios take 3–4 s on an idle machine; the 5 s default flakes under CPU load.
        testTimeout: 20_000,
    },
});
