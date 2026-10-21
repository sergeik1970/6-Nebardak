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
    /** The browser origin that serves both the site and `/api`. */
    publicOrigin: string;
    session: SessionRuntimeConfig;
    mail: MailRuntimeConfig;
    database: DatabaseRuntimeConfig;
}

export interface MailRuntimeConfig {
    host: string;
    port: number;
    /** Implicit TLS (usually port 465); otherwise STARTTLS is required in production. */
    secure: boolean;
    username?: string;
    password?: string;
    /** RFC 5322 sender, e.g. `StyleFinder <no-reply@example.com>`. */
    from: string;
}

export interface SessionRuntimeConfig {
    cookieName: string;
    secureCookie: boolean;
}

const defaultLocalPublicOrigin = "http://localhost:3000";

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

function parsePublicOrigin(
    isProduction: boolean,
    authEnabled: boolean,
): string {
    // Compose passes an unset optional variable as an empty string.
    const rawValue = process.env.PUBLIC_ORIGIN?.trim();
    if (!rawValue) {
        if (isProduction && authEnabled) {
            throw new Error("PUBLIC_ORIGIN is required in production");
        }
        return defaultLocalPublicOrigin;
    }

    let url: URL;
    try {
        url = new URL(rawValue);
    } catch {
        throw new Error("PUBLIC_ORIGIN must be an absolute http(s) origin");
    }
    if (
        (url.protocol !== "https:" && url.protocol !== "http:") ||
        url.origin !== rawValue.replace(/\/$/, "") ||
        url.username ||
        url.password
    ) {
        throw new Error("PUBLIC_ORIGIN must be an absolute http(s) origin");
    }
    if (isProduction && authEnabled && url.protocol !== "https:") {
        throw new Error("PUBLIC_ORIGIN must use https in production");
    }

    return url.origin;
}

/**
 * Compose forwards an unset optional variable as an empty string; for these
 * settings that means "not configured" rather than an invalid value.
 */
function parseBlankableString(
    name: string,
    fallback: string | undefined,
    required: boolean,
    maximumLength = 255,
): string | undefined {
    if (!process.env[name]?.trim()) {
        if (required) throw new Error(`${name} is required in production`);
        return fallback;
    }
    return parseOptionalString(name, fallback, maximumLength);
}

function parseMailConfig(
    isProduction: boolean,
    authEnabled: boolean,
): MailRuntimeConfig {
    const requireForAccounts = isProduction && authEnabled;
    // Locally, Mailpit from docker-compose.dev.yml catches every letter.
    const host = parseBlankableString(
        "SMTP_HOST",
        "127.0.0.1",
        requireForAccounts,
        253,
    )!;
    if (/\s|\//.test(host)) {
        throw new Error("SMTP_HOST must be a hostname or IP address");
    }

    const port = parseInteger(
        "SMTP_PORT",
        isProduction ? 587 : 1025,
        1,
        65_535,
    );
    const from = parseBlankableString(
        "SMTP_FROM",
        "StyleFinder <no-reply@stylefinder.local>",
        requireForAccounts,
    )!;
    if (!/^[^<>@]*<[^<>@\s]+@[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+$/.test(from)) {
        throw new Error("SMTP_FROM must be an address or `Name <address>`");
    }

    const username = parseBlankableString("SMTP_USER", undefined, false);
    const password = parseBlankableString(
        "SMTP_PASSWORD",
        undefined,
        false,
        1_024,
    );
    if (Boolean(username) !== Boolean(password)) {
        throw new Error("SMTP_USER and SMTP_PASSWORD must be set together");
    }

    return {
        host,
        port,
        secure: parseBoolean("SMTP_SECURE", port === 465),
        username,
        password,
        from,
    };
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

    const publicOrigin = parsePublicOrigin(isProduction, authEnabled);
    const mail = parseMailConfig(isProduction, authEnabled);
    const secureCookie = publicOrigin.startsWith("https:");

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
        publicOrigin,
        session: {
            // `__Host-` binds the cookie to this exact origin over HTTPS only.
            cookieName: secureCookie ? "__Host-sf_session" : "sf_session",
            secureCookie,
        },
        mail,
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
