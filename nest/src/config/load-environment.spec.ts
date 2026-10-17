import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadLocalEnvironment } from "./load-environment";

describe("local environment loading", () => {
    const originalNodeEnvironment = process.env.NODE_ENV;
    let temporaryDirectory: string | undefined;

    afterEach(() => {
        if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnvironment;

        if (temporaryDirectory)
            rmSync(temporaryDirectory, { recursive: true, force: true });
        temporaryDirectory = undefined;
    });

    it("delegates an existing local env file to the Node loader", () => {
        temporaryDirectory = mkdtempSync(join(tmpdir(), "stylefinder-env-"));
        const environmentFile = join(temporaryDirectory, ".env");
        writeFileSync(
            environmentFile,
            "STYLEFINDER_ENV_PROBE=from-file\n",
            "utf8",
        );
        delete process.env.NODE_ENV;
        let loadedPath: string | undefined;

        expect(
            loadLocalEnvironment(
                environmentFile,
                (path) => (loadedPath = path),
            ),
        ).toBe(true);
        expect(loadedPath).toBe(environmentFile);
    });

    it("never reads a dotenv file in production", () => {
        temporaryDirectory = mkdtempSync(join(tmpdir(), "stylefinder-env-"));
        const environmentFile = join(temporaryDirectory, ".env");
        writeFileSync(
            environmentFile,
            "STYLEFINDER_ENV_PROBE=from-file\n",
            "utf8",
        );
        process.env.NODE_ENV = "production";
        let loaderCalled = false;

        expect(
            loadLocalEnvironment(environmentFile, () => (loaderCalled = true)),
        ).toBe(false);
        expect(loaderCalled).toBe(false);
    });

    it("uses the pinned Node runtime's native dotenv parser", () => {
        temporaryDirectory = mkdtempSync(join(tmpdir(), "stylefinder-env-"));
        const environmentFile = join(temporaryDirectory, ".env");
        writeFileSync(
            environmentFile,
            "STYLEFINDER_ENV_PROBE=from-file\n",
            "utf8",
        );
        const childEnvironment = { ...process.env };
        delete childEnvironment.STYLEFINDER_ENV_PROBE;

        const result = spawnSync(
            process.execPath,
            [
                "-e",
                `process.loadEnvFile(${JSON.stringify(environmentFile)}); process.stdout.write(process.env.STYLEFINDER_ENV_PROBE || "")`,
            ],
            { encoding: "utf8", env: childEnvironment },
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("from-file");
    });
});
