import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 256 random bits, URL- and cookie-safe. */
export function createSecretToken(): string {
    return randomBytes(32).toString("base64url");
}

/**
 * Tokens are high-entropy, so a plain SHA-256 is enough: a leaked table
 * cannot be turned back into usable cookies or links.
 */
export function hashSecretToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** Lets callers skip the database for anything we could never have issued. */
export function isSecretTokenFormat(token: unknown): token is string {
    return typeof token === "string" && TOKEN_PATTERN.test(token);
}
