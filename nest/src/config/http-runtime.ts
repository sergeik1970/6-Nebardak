import { INestApplication } from "@nestjs/common";
import { json, urlencoded, type Response } from "express";

interface ExpressSettings {
    set(setting: string, value: unknown): unknown;
}

/** Applies the already validated numeric hop count to Express 5. */
export function configureTrustedProxy(
    expressApplication: ExpressSettings,
    trustProxyHops: number,
): void {
    expressApplication.set("trust proxy", trustProxyHops);
}

/** A project document may reach 1 MB; leave headroom for the JSON wrapper. */
export const PROJECT_BODY_LIMIT = "1100kb";
export const DEFAULT_BODY_LIMIT = "100kb";

/**
 * Replaces Nest's single global body parser: only the project endpoints may
 * receive large documents, every other route keeps the small default.
 * The app must be created with `bodyParser: false`.
 */
export function configureBodyParsers(app: INestApplication): void {
    app.use("/api/projects", json({ limit: PROJECT_BODY_LIMIT }));
    app.use(json({ limit: DEFAULT_BODY_LIMIT }));
    app.use(urlencoded({ extended: false, limit: DEFAULT_BODY_LIMIT }));
}

/**
 * API answers carry sessions, profiles and project documents: no browser or
 * intermediary cache may keep them, and logging out must not leave a copy.
 */
export function configureNoStore(app: INestApplication): void {
    app.use(
        "/api",
        (_request: unknown, response: Response, next: () => void) => {
            response.setHeader("Cache-Control", "no-store");
            next();
        },
    );
}
