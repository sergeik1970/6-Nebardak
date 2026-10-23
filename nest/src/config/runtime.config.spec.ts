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
    "PUBLIC_ORIGIN",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "SMTP_TLS_SERVERNAME",
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

    it("uses safe local, auth, session and database defaults", () => {
        process.env.NODE_ENV = "dev";

        expect(getRuntimeConfig()).toEqual({
            nodeEnv: "dev",
            port: 3001,
            trustProxyHops: 0,
            authEnabled: false,
            registrationEnabled: false,
            publicOrigin: "http://localhost:3000",
            session: { cookieName: "sf_session", secureCookie: false },
            mail: {
                host: "127.0.0.1",
                port: 1025,
                secure: false,
                username: undefined,
                password: undefined,
                from: "StyleFinder <no-reply@stylefinder.local>",
            },
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

    it("does not require a public origin while server auth is disabled", () => {
        setProductionDatabaseEnvironment();

        expect(getRuntimeConfig()).toMatchObject({ authEnabled: false });
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

    it("requires a public origin when production auth is enabled", () => {
        setProductionDatabaseEnvironment();
        process.env.AUTH_ENABLED = "true";

        expect(() => getRuntimeConfig()).toThrow(/PUBLIC_ORIGIN.*production/);
    });

    it("requires an SMTP relay and sender once production accounts are on", () => {
        setProductionDatabaseEnvironment();
        process.env.AUTH_ENABLED = "true";
        process.env.PUBLIC_ORIGIN = "https://stylefinder.example";
        expect(() => getRuntimeConfig()).toThrow(/SMTP_HOST.*production/);

        process.env.SMTP_HOST = "smtp.example.net";
        expect(() => getRuntimeConfig()).toThrow(/SMTP_FROM.*production/);

        process.env.SMTP_FROM = "StyleFinder <no-reply@stylefinder.example>";
        expect(getRuntimeConfig().mail).toEqual({
            host: "smtp.example.net",
            port: 587,
            secure: false,
            username: undefined,
            password: undefined,
            from: "StyleFinder <no-reply@stylefinder.example>",
        });
    });

    it.each([
        ["SMTP_FROM", "no address here"],
        ["SMTP_FROM", "Two <a@b.c> <d@e.f>"],
        ["SMTP_HOST", "smtp.example.net/path"],
        ["SMTP_TLS_SERVERNAME", "smtp.example.net/path"],
    ])("rejects an invalid %s value %s", (name, value) => {
        process.env.NODE_ENV = "dev";
        process.env[name] = value;

        expect(() => getRuntimeConfig()).toThrow(new RegExp(name));
    });

    it("treats blank SMTP values from Compose as unset", () => {
        setProductionDatabaseEnvironment();
        for (const name of [
            "SMTP_HOST",
            "SMTP_USER",
            "SMTP_PASSWORD",
            "SMTP_FROM",
        ]) {
            process.env[name] = "";
        }

        expect(getRuntimeConfig().mail).toMatchObject({
            username: undefined,
            password: undefined,
        });

        process.env.AUTH_ENABLED = "true";
        process.env.PUBLIC_ORIGIN = "https://stylefinder.example";
        expect(() => getRuntimeConfig()).toThrow(/SMTP_HOST.*production/);
    });

    it("requires SMTP credentials as a pair and infers implicit TLS on 465", () => {
        process.env.NODE_ENV = "dev";
        process.env.SMTP_USER = "mailer";
        expect(() => getRuntimeConfig()).toThrow(/set together/);

        process.env.SMTP_PASSWORD = "test-only-smtp-password";
        process.env.SMTP_PORT = "465";
        expect(getRuntimeConfig().mail).toMatchObject({
            port: 465,
            secure: true,
            username: "mailer",
        });
    });

    it("keeps the provider's certificate name when Nest talks to the relay", () => {
        process.env.NODE_ENV = "dev";
        process.env.SMTP_HOST = "smtp-relay";
        process.env.SMTP_TLS_SERVERNAME = "smtp.example.net";

        expect(getRuntimeConfig().mail).toMatchObject({
            host: "smtp-relay",
            tlsServername: "smtp.example.net",
        });
    });

    it("requires https and binds the cookie to the production origin", () => {
        setProductionDatabaseEnvironment();
        process.env.AUTH_ENABLED = "true";
        process.env.SMTP_HOST = "smtp.example.net";
        process.env.SMTP_FROM = "no-reply@stylefinder.example";
        process.env.PUBLIC_ORIGIN = "http://stylefinder.example";
        expect(() => getRuntimeConfig()).toThrow(/https in production/);

        process.env.PUBLIC_ORIGIN = "https://stylefinder.example/";
        expect(getRuntimeConfig()).toMatchObject({
            publicOrigin: "https://stylefinder.example",
            session: { cookieName: "__Host-sf_session", secureCookie: true },
        });
    });

    it.each([
        "stylefinder.example",
        "https://stylefinder.example/app",
        "https://user:secret@stylefinder.example",
        "ftp://stylefinder.example",
    ])("rejects a public origin that is not a bare origin: %s", (origin) => {
        process.env.NODE_ENV = "dev";
        process.env.PUBLIC_ORIGIN = origin;

        expect(() => getRuntimeConfig()).toThrow(/PUBLIC_ORIGIN must be/);
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

    it("applies explicit origin and database timeout values", () => {
        process.env.NODE_ENV = "test";
        process.env.PUBLIC_ORIGIN = "http://127.0.0.1:3100";
        process.env.DB_STATEMENT_TIMEOUT_MS = "1000";
        process.env.DB_QUERY_TIMEOUT_MS = "1500";
        process.env.DB_CONNECTION_TIMEOUT_MS = "2000";
        process.env.DB_READINESS_TIMEOUT_MS = "500";

        expect(getRuntimeConfig()).toMatchObject({
            publicOrigin: "http://127.0.0.1:3100",
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
