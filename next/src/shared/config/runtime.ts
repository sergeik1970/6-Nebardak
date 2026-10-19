const devApiUrl = "http://localhost:3001/api";

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

export const AUTH_API_URL =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? devApiUrl : "");

export const isAuthEnabled = readPublicFlag(process.env.NEXT_PUBLIC_AUTH_ENABLED, false);

export const isAuthRegistrationEnabled =
    isAuthEnabled && readPublicFlag(process.env.NEXT_PUBLIC_AUTH_REGISTRATION_ENABLED, false);

export const authUiMode = resolveAuthUiMode(isAuthEnabled, isAuthRegistrationEnabled);

export const isBetaBadgeEnabled = readPublicFlag(process.env.NEXT_PUBLIC_BETA_BADGE_ENABLED, true);
