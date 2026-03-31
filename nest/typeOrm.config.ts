import { DataSource } from "typeorm";

export default new DataSource({
    type: "postgres",
    host: process.env.NODE_ENV === "dev" ? "127.0.0.1" : "db",
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: ["./src/entities/**/*.ts"],
    migrations: ["./migrations/**/*.ts"],
});
