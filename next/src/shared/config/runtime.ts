export const readPublicFlag = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined || value.trim() === "") return fallback;

    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export type AuthUiMode = "off" | "login" | "login-registration";

export const resolveAuthUiMode = (
    authEnabled: boolean,
    registrationEnabled: boolean,
): AuthUiMode => {
    if (!authEnabled) return "off";
    return registrationEnabled ? "login-registration" : "login";
};

/**
 * Same-origin by design: session cookies are HttpOnly and SameSite, so the API
 * is served under the site's own `/api` (Caddy in production, a rewrite in dev).
 */
export const AUTH_API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "/api";

export const isAuthEnabled = readPublicFlag(process.env.NEXT_PUBLIC_AUTH_ENABLED, false);

export const isAuthRegistrationEnabled =
    isAuthEnabled && readPublicFlag(process.env.NEXT_PUBLIC_AUTH_REGISTRATION_ENABLED, false);

export const authUiMode = resolveAuthUiMode(isAuthEnabled, isAuthRegistrationEnabled);

export const isBetaBadgeEnabled = readPublicFlag(process.env.NEXT_PUBLIC_BETA_BADGE_ENABLED, true);

export const readCounterId = (value: string | undefined): number | null => {
    const trimmed = value?.trim();
    return trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : null;
};

/** Yandex Metrika counter. Unset keeps analytics and its cookie banner off (dev, CI, e2e). */
export const yandexMetrikaCounterId = readCounterId(process.env.NEXT_PUBLIC_YM_COUNTER_ID);
