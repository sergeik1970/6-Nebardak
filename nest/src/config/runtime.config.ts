import { randomBytes } from "node:crypto";

export type NodeEnvironment = "development" | "dev" | "test" | "production";

export interface DatabaseRuntimeConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    name?: string;
    statementTimeoutMs: number;
    queryTimeoutMs: number;
    connectionTimeoutMs: number;
    readinessTimeoutMs: number;
}

export interface RuntimeConfig {
    nodeEnv: NodeEnvironment;
    port: number;
    trustProxyHops: number;
    authEnabled: boolean;
    registrationEnabled: boolean;
    jwtSecret?: string;
    jwtIssuer: string;
    jwtAudience: string;
    database: DatabaseRuntimeConfig;
}

const insecureJwtSecrets = new Set([
    "change_this_secret_in_production",
    "replace_with_at_least_32_random_bytes",
    "REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES",
]);

const minimumProductionDatabasePasswordLength = 16;
const insecureDatabasePasswords = new Set([
    "password",
    "database-password",
    "replace_with_a_long_random_admin_password",
    "replace_with_a_different_long_random_app_password",
    "replace_with_a_third_long_random_migrator_password",
]);

const allowedNodeEnvironments = new Set<NodeEnvironment>([
    "development",
    "dev",
    "test",
    "production",
]);

function parseInteger(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(
            `${name} must be an integer between ${minimum} and ${maximum}`,
        );
    }

    return value;
}

function parseOptionalString(
    name: string,
    fallback?: string,
    maximumLength = 255,
): string | undefined {
    const rawValue = process.env[name];
    if (rawValue === undefined) return fallback;

    const value = rawValue.trim();
    if (
        !value ||
        value.length > maximumLength ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new Error(
            `${name} must be a non-empty string of at most ${maximumLength} characters without control characters`,
        );
    }

    return value;
}

function requireProductionValue(name: string): string {
    const value = parseOptionalString(name);
    if (!value) {
        throw new Error(`${name} is required in production`);
    }
    return value;
}

function assertProductionDatabasePassword(
    username: string,
    password: string,
): void {
    if (
        password.length < minimumProductionDatabasePasswordLength ||
        password === username ||
        insecureDatabasePasswords.has(password.toLowerCase()) ||
        /^(?:replace_with|change_this|change_me)(?:_|-)/i.test(password)
    ) {
        throw new Error(
            `DB_PASSWORD must be a non-default value with at least ${minimumProductionDatabasePasswordLength} characters in production`,
        );
    }
}

function parseBoolean(name: string, fallback: boolean): boolean {
    const rawValue = process.env[name]?.trim().toLowerCase();
    if (!rawValue) return fallback;
    if (rawValue === "true") return true;
    if (rawValue === "false") return false;
    throw new Error(`${name} must be either true or false`);
}

function parseNodeEnvironment(): NodeEnvironment {
    const rawValue = process.env.NODE_ENV?.trim() || "development";
    if (!allowedNodeEnvironments.has(rawValue as NodeEnvironment)) {
        throw new Error(
            "NODE_ENV must be one of development, dev, test or production",
        );
    }
    return rawValue as NodeEnvironment;
}

function parseDatabaseConfig(nodeEnv: NodeEnvironment): DatabaseRuntimeConfig {
    const isLocal =
        nodeEnv === "development" || nodeEnv === "dev" || nodeEnv === "test";
    const host = parseOptionalString(
        "DB_HOST",
        isLocal ? "127.0.0.1" : "db",
        253,
    )!;

    if (/\s|\//.test(host)) {
        throw new Error("DB_HOST must be a hostname or IP address");
    }

    const statementTimeoutMs = parseInteger(
        "DB_STATEMENT_TIMEOUT_MS",
        5_000,
        100,
        120_000,
    );
    const queryTimeoutMs = parseInteger(
        "DB_QUERY_TIMEOUT_MS",
        Math.max(6_000, statementTimeoutMs),
        100,
        120_000,
    );
    const connectionTimeoutMs = parseInteger(
        "DB_CONNECTION_TIMEOUT_MS",
        5_000,
        100,
        120_000,
    );
    const readinessTimeoutMs = parseInteger(
        "DB_READINESS_TIMEOUT_MS",
        3_000,
        100,
        30_000,
    );

    if (queryTimeoutMs < statementTimeoutMs) {
        throw new Error(
            "DB_QUERY_TIMEOUT_MS must be greater than or equal to DB_STATEMENT_TIMEOUT_MS",
        );
    }
    if (readinessTimeoutMs > queryTimeoutMs) {
        throw new Error(
            "DB_READINESS_TIMEOUT_MS must not exceed DB_QUERY_TIMEOUT_MS",
        );
    }

    return {
        host,
        port: parseInteger("DB_PORT", 5432, 1, 65_535),
        username: parseOptionalString("DB_USERNAME"),
        password: parseOptionalString("DB_PASSWORD", undefined, 1_024),
        name: parseOptionalString("DB_NAME"),
        statementTimeoutMs,
        queryTimeoutMs,
        connectionTimeoutMs,
        readinessTimeoutMs,
    };
}

export function getRuntimeConfig(): RuntimeConfig {
    const nodeEnv = parseNodeEnvironment();
    const isProduction = nodeEnv === "production";
    const authEnabled = isAuthEnabled();
    const registrationEnabled = isRegistrationEnabled();
    const database = parseDatabaseConfig(nodeEnv);

    if (registrationEnabled && !authEnabled) {
        throw new Error("AUTH_REGISTRATION_ENABLED requires AUTH_ENABLED=true");
    }

    if (isProduction) {
        database.username = requireProductionValue("DB_USERNAME");
        database.password = requireProductionValue("DB_PASSWORD");
        database.name = requireProductionValue("DB_NAME");
        assertProductionDatabasePassword(database.username, database.password);
    }

    let jwtSecret = parseOptionalString("JWT_SECRET", undefined, 4_096);
    if (authEnabled) {
        if (isProduction) {
            jwtSecret = requireProductionValue("JWT_SECRET");
        } else if (nodeEnv === "dev" && !jwtSecret) {
            // A local test session can work without persisting a signing key.
            // The key exists only in the Nest process and invalidates all
            // sessions on restart; production can never use this path.
            jwtSecret = randomBytes(48).toString("base64url");
        }
        if (
            !jwtSecret ||
            jwtSecret.length < 32 ||
            insecureJwtSecrets.has(jwtSecret)
        ) {
            throw new Error(
                "JWT_SECRET must be a non-default value with at least 32 characters when authentication is enabled",
            );
        }
    }

    return {
        nodeEnv,
        port: parseInteger("PORT", 3001, 1, 65_535),
        trustProxyHops: parseInteger(
            "TRUST_PROXY_HOPS",
            isProduction ? 1 : 0,
            0,
            4,
        ),
        authEnabled,
        registrationEnabled,
        jwtSecret,
        jwtIssuer: parseOptionalString("JWT_ISSUER", "stylefinder-api")!,
        jwtAudience: parseOptionalString("JWT_AUDIENCE", "stylefinder-web")!,
        database,
    };
}

export function isAuthEnabled(): boolean {
    return parseBoolean("AUTH_ENABLED", false);
}

export function isRegistrationEnabled(): boolean {
    return parseBoolean("AUTH_REGISTRATION_ENABLED", false);
}

export function getRateLimit(
    name: "RATE_LIMIT_TTL_MS" | "RATE_LIMIT_REQUESTS",
    fallback: number,
): number {
    return parseInteger(name, fallback, 1, 3_600_000);
}
