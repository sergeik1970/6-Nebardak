import { existsSync } from "node:fs";
import { resolve } from "node:path";

type ProcessWithEnvironmentLoader = NodeJS.Process & {
    loadEnvFile(path?: string): void;
};

type EnvironmentFileLoader = (path: string) => void;

const nativeEnvironmentFileLoader: EnvironmentFileLoader = (path) => {
    const processWithEnvironmentLoader =
        process as ProcessWithEnvironmentLoader;
    if (typeof processWithEnvironmentLoader.loadEnvFile !== "function") {
        throw new Error("Node.js 22 with process.loadEnvFile is required");
    }

    processWithEnvironmentLoader.loadEnvFile(path);
};

/**
 * Node 22 provides a native dotenv parser. Local commands load `nest/.env`
 * before runtime configuration is imported; production remains environment-only.
 */
export function loadLocalEnvironment(
    environmentFile = resolve(process.cwd(), ".env"),
    loader: EnvironmentFileLoader = nativeEnvironmentFileLoader,
): boolean {
    if (
        process.env.NODE_ENV === "production" ||
        process.env.NODE_ENV === "test" ||
        !existsSync(environmentFile)
    ) {
        return false;
    }

    loader(environmentFile);
    return true;
}

loadLocalEnvironment();
