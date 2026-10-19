import { getRateLimit, getRuntimeConfig } from "./runtime.config";

const managedEnvironmentKeys = [
    "NODE_ENV",
    "DB_HOST",
    "DB_PORT",
    "DB_USERNAME",
    "DB_PASSWORD",
    "DB_NAME",
    "DB_STATEMENT_TIMEOUT_MS",
    "DB_QUERY_TIMEOUT_MS",
    "DB_CONNECTION_TIMEOUT_MS",
    "DB_READINESS_TIMEOUT_MS",
    "JWT_SECRET",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "PORT",
    "TRUST_PROXY_HOPS",
    "RATE_LIMIT_TTL_MS",
    "RATE_LIMIT_REQUESTS",
    "AUTH_ENABLED",
    "AUTH_REGISTRATION_ENABLED",
] as const;

describe("runtime configuration", () => {
    const originalValues = Object.fromEntries(
        managedEnvironmentKeys.map((key) => [key, process.env[key]]),
    );

    beforeEach(() => {
        for (const key of managedEnvironmentKeys) delete process.env[key];
    });

    afterAll(() => {
        for (const key of managedEnvironmentKeys) {
            const originalValue = originalValues[key];
            if (originalValue === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalValue;
            }
        }
    });

    it("uses safe local, auth, JWT and database defaults", () => {
        process.env.NODE_ENV = "dev";

        expect(getRuntimeConfig()).toEqual({
            nodeEnv: "dev",
            port: 3001,
            trustProxyHops: 0,
            authEnabled: false,
            registrationEnabled: false,
            jwtSecret: undefined,
            jwtIssuer: "stylefinder-api",
            jwtAudience: "stylefinder-web",
            database: {
                host: "127.0.0.1",
                port: 5432,
                username: undefined,
                password: undefined,
                name: undefined,
                statementTimeoutMs: 5_000,
                queryTimeoutMs: 6_000,
                connectionTimeoutMs: 5_000,
                readinessTimeoutMs: 3_000,
            },
        });
    });

    it("fails fast when production database credentials are absent", () => {
        process.env.NODE_ENV = "production";

        expect(() => getRuntimeConfig()).toThrow(/DB_USERNAME.*production/);
    });

    it("does not require a JWT secret while server auth is disabled", () => {
        setProductionDatabaseEnvironment();

        expect(getRuntimeConfig()).toMatchObject({
            authEnabled: false,
            jwtSecret: undefined,
        });
    });

    it.each([
        "short",
        "database-password",
        "replace_with_a_different_long_random_app_password",
        "REPLACE_WITH_A_DIFFERENT_LONG_RANDOM_APP_PASSWORD",
    ])("rejects an unsafe production database password %s", (password) => {
        setProductionDatabaseEnvironment();
        process.env.DB_PASSWORD = password;

        expect(() => getRuntimeConfig()).toThrow(
            /DB_PASSWORD.*non-default.*at least 16/,
        );
    });

    it("rejects a production database password equal to the runtime role name", () => {
        setProductionDatabaseEnvironment();
        process.env.DB_USERNAME = "same-role-and-password";
        process.env.DB_PASSWORD = "same-role-and-password";

        expect(() => getRuntimeConfig()).toThrow(/DB_PASSWORD.*non-default/);
    });

    it("requires a JWT secret when production auth is enabled", () => {
        setProductionDatabaseEnvironment();
        process.env.AUTH_ENABLED = "true";

        expect(() => getRuntimeConfig()).toThrow(/JWT_SECRET.*production/);
    });

    it("requires a sufficiently long production JWT secret", () => {
        setProductionDatabaseEnvironment();
        process.env.AUTH_ENABLED = "true";
        process.env.JWT_SECRET = "too-short";

        expect(() => getRuntimeConfig()).toThrow(/at least 32 characters/);
    });

    it.each([
        "change_this_secret_in_production",
        "replace_with_at_least_32_random_bytes",
        "REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES",
    ])(
        "rejects the documented JWT placeholder %s when auth is enabled",
        (placeholder) => {
            setProductionDatabaseEnvironment();
            process.env.AUTH_ENABLED = "true";
            process.env.JWT_SECRET = placeholder;

            expect(() => getRuntimeConfig()).toThrow(/non-default value/);
        },
    );

    it.each(["too-short", "change_this_secret_in_production"])(
        "rejects a short or template JWT secret when local auth is enabled",
        (jwtSecret) => {
            process.env.NODE_ENV = "dev";
            process.env.AUTH_ENABLED = "true";
            process.env.JWT_SECRET = jwtSecret;

            expect(() => getRuntimeConfig()).toThrow(
                /JWT_SECRET.*non-default.*at least 32/,
            );
        },
    );

    it("creates a process-only key when explicitly running local dev auth", () => {
        process.env.NODE_ENV = "dev";
        process.env.AUTH_ENABLED = "true";
        delete process.env.JWT_SECRET;

        const config = getRuntimeConfig();

        expect(config.jwtSecret).toEqual(expect.any(String));
        expect(config.jwtSecret).toHaveLength(64);
    });

    it("rejects registration without the auth contour", () => {
        process.env.NODE_ENV = "dev";
        process.env.AUTH_REGISTRATION_ENABLED = "true";

        expect(() => getRuntimeConfig()).toThrow(
            /AUTH_REGISTRATION_ENABLED requires AUTH_ENABLED=true/,
        );
    });

    it("validates NODE_ENV, database host, port and bounded timeouts", () => {
        process.env.NODE_ENV = "staging";
        expect(() => getRuntimeConfig()).toThrow(/NODE_ENV must be one of/);

        process.env.NODE_ENV = "test";
        process.env.DB_HOST = "http://not-a-host";
        expect(() => getRuntimeConfig()).toThrow(/hostname or IP/);

        process.env.DB_HOST = "db";
        process.env.DB_PORT = "70000";
        expect(() => getRuntimeConfig()).toThrow(/DB_PORT.*integer/);

        process.env.DB_PORT = "5432";
        process.env.DB_STATEMENT_TIMEOUT_MS = "7000";
        process.env.DB_QUERY_TIMEOUT_MS = "6000";
        expect(() => getRuntimeConfig()).toThrow(/greater than or equal/);

        process.env.DB_STATEMENT_TIMEOUT_MS = "5000";
        process.env.DB_READINESS_TIMEOUT_MS = "7000";
        expect(() => getRuntimeConfig()).toThrow(/must not exceed/);
    });

    it("rejects invalid rate-limit values", () => {
        process.env.RATE_LIMIT_REQUESTS = "0";

        expect(() => getRateLimit("RATE_LIMIT_REQUESTS", 120)).toThrow(
            /integer between/,
        );
    });

    it("only enables auth and registration through explicit booleans", () => {
        process.env.NODE_ENV = "dev";
        process.env.AUTH_ENABLED = "true";
        process.env.AUTH_REGISTRATION_ENABLED = "true";
        process.env.JWT_SECRET = "test-only-local-auth-secret-2026";
        expect(getRuntimeConfig()).toMatchObject({
            authEnabled: true,
            registrationEnabled: true,
        });

        process.env.AUTH_ENABLED = "yes";
        expect(() => getRuntimeConfig()).toThrow(/either true or false/);
    });

    it("accepts only a bounded numeric trusted-proxy hop count", () => {
        process.env.NODE_ENV = "production";
        process.env.DB_USERNAME = "app";
        process.env.DB_PASSWORD = "test-only-runtime-db-password-2026";
        process.env.DB_NAME = "stylefinder";
        process.env.TRUST_PROXY_HOPS = "1";
        expect(getRuntimeConfig().trustProxyHops).toBe(1);

        process.env.TRUST_PROXY_HOPS = "5";
        expect(() => getRuntimeConfig()).toThrow(/TRUST_PROXY_HOPS.*integer/);
    });

    it("applies explicit JWT identity and database timeout values", () => {
        process.env.NODE_ENV = "test";
        process.env.JWT_ISSUER = "stylefinder-api-test";
        process.env.JWT_AUDIENCE = "stylefinder-web-test";
        process.env.DB_STATEMENT_TIMEOUT_MS = "1000";
        process.env.DB_QUERY_TIMEOUT_MS = "1500";
        process.env.DB_CONNECTION_TIMEOUT_MS = "2000";
        process.env.DB_READINESS_TIMEOUT_MS = "500";

        expect(getRuntimeConfig()).toMatchObject({
            jwtIssuer: "stylefinder-api-test",
            jwtAudience: "stylefinder-web-test",
            database: {
                statementTimeoutMs: 1000,
                queryTimeoutMs: 1500,
                connectionTimeoutMs: 2000,
                readinessTimeoutMs: 500,
            },
        });
    });

    it("keeps the implicit query timeout compatible with a longer migration statement timeout", () => {
        process.env.NODE_ENV = "test";
        process.env.DB_STATEMENT_TIMEOUT_MS = "60000";

        expect(getRuntimeConfig().database).toMatchObject({
            statementTimeoutMs: 60_000,
            queryTimeoutMs: 60_000,
        });
    });
});

function setProductionDatabaseEnvironment(): void {
    process.env.NODE_ENV = "production";
    process.env.DB_USERNAME = "app";
    process.env.DB_PASSWORD = "test-only-runtime-db-password-2026";
    process.env.DB_NAME = "stylefinder";
}
