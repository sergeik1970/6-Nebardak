import { DataSource } from "typeorm";
import { User } from "../entities/User";

export const AppDataSource = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "password",
    database: process.env.DB_NAME || "nebardak",
    synchronize: process.env.NODE_ENV !== "production", // автоматическое создание таблиц в dev режиме
    logging: process.env.NODE_ENV !== "production",
    entities: [User],
    migrations: [],
    subscribers: [],
});

let isInitialized = false;

export const initializeDatabase = async () => {
    if (!isInitialized) {
        try {
            await AppDataSource.initialize();
            isInitialized = true;
            console.log("Database connected successfully");
        } catch (error) {
            console.error("Database connection failed:", error);
            throw error;
        }
    }
    return AppDataSource;
};
