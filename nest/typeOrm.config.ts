import "./src/config/load-environment";
import { DataSource } from "typeorm";
import { join } from "node:path";
import { getRuntimeConfig } from "./src/config/runtime.config";

const runtime = getRuntimeConfig();
const usesTypeScriptSources = runtime.nodeEnv !== "production";
const sourceExtension = usesTypeScriptSources ? "ts" : "js";

export default new DataSource({
    type: "postgres",
    host: runtime.database.host,
    port: runtime.database.port,
    username: runtime.database.username,
    password: runtime.database.password,
    database: runtime.database.name,
    entities: [join(__dirname, `src/entities/**/*.${sourceExtension}`)],
    migrations: [join(__dirname, `migrations/**/*.${sourceExtension}`)],
    extra: {
        statement_timeout: runtime.database.statementTimeoutMs,
        query_timeout: runtime.database.queryTimeoutMs,
        connectionTimeoutMillis: runtime.database.connectionTimeoutMs,
        application_name: "stylefinder-migrator",
    },
});
