import type { CookieOptions, Request, Response } from "express";
import { getRuntimeConfig } from "../config/runtime.config";
import { UserRole } from "../entities/User/user.entity";
import { sessionLifetime } from "../services/SessionService/session.service";

function cookieOptions(): CookieOptions {
    return {
        httpOnly: true,
        secure: getRuntimeConfig().session.secureCookie,
        sameSite: "lax",
        path: "/",
    };
}

/** Reads one cookie without trusting malformed or duplicated values. */
function readCookie(
    request: Pick<Request, "headers">,
    name: string,
): string | undefined {
    const header = request.headers.cookie;
    if (typeof header !== "string") return undefined;

    const values = header
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${name}=`))
        .map((part) => part.slice(name.length + 1));

    return values.length === 1 && values[0] ? values[0] : undefined;
}

export function readSessionToken(
    request: Pick<Request, "headers">,
): string | undefined {
    return readCookie(request, getRuntimeConfig().session.cookieName);
}

export function readTrustedDeviceToken(
    request: Pick<Request, "headers">,
): string | undefined {
    return readCookie(
        request,
        getRuntimeConfig().session.trustedDeviceCookieName,
    );
}

/**
 * The cookie lives as long as the absolute session limit; the shorter idle
 * expiry is enforced by the server, which can also end it at any time.
 */
export function setSessionCookie(
    response: Response,
    token: string,
    role: UserRole,
): void {
    response.cookie(getRuntimeConfig().session.cookieName, token, {
        ...cookieOptions(),
        maxAge: sessionLifetime(role).absoluteMs,
    });
}

export function clearSessionCookie(response: Response): void {
    response.clearCookie(
        getRuntimeConfig().session.cookieName,
        cookieOptions(),
    );
}

export function setTrustedDeviceCookie(
    response: Response,
    token: string,
    expiresAt: Date,
): void {
    response.cookie(getRuntimeConfig().session.trustedDeviceCookieName, token, {
        ...cookieOptions(),
        expires: expiresAt,
    });
}

export function clearTrustedDeviceCookie(response: Response): void {
    response.clearCookie(
        getRuntimeConfig().session.trustedDeviceCookieName,
        cookieOptions(),
    );
}
