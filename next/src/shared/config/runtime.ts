const devApiUrl = "http://localhost:3001/api";

export const AUTH_API_URL =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? devApiUrl : "");

export const isAuthEnabled = Boolean(AUTH_API_URL);
