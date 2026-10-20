import { AUTH_API_URL, isAuthEnabled } from "@/shared/config/runtime";

/** The server rejects state changes without this same-origin marker (CSRF). */
export const CSRF_HEADERS = { "X-Requested-With": "stylefinder" } as const;

const TOO_MANY_REQUESTS_MESSAGE =
    "Слишком много попыток. Подождите несколько минут и попробуйте снова.";
const DISABLED_MESSAGE = "Авторизация временно недоступна: сайт запущен без подключенного API.";

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly payload?: unknown,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions {
    method?: ApiMethod;
    body?: unknown;
    /** Message used when the server gives no readable reason. */
    fallbackMessage?: string;
    keepalive?: boolean;
    signal?: AbortSignal;
}

const readServerMessage = (payload: unknown): string | null => {
    if (!payload || typeof payload !== "object") return null;
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    // Nest validation errors arrive as a list; the first is enough for a form.
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
    return null;
};

/**
 * Same-origin JSON request. The session cookie travels automatically and is
 * never readable from JavaScript.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    if (!isAuthEnabled || !AUTH_API_URL) throw new ApiError(0, DISABLED_MESSAGE);

    const method = options.method ?? "GET";
    let response: Response;
    try {
        response = await fetch(`${AUTH_API_URL}${path}`, {
            method,
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                ...(method === "GET" ? {} : CSRF_HEADERS),
                ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            keepalive: options.keepalive,
            signal: options.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new ApiError(0, "Нет соединения с сервером. Проверьте интернет.");
    }

    const text = response.status === 204 ? "" : await response.text();
    let payload: unknown = undefined;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            // An intermediary can return an HTML error page; keep the safe message.
        }
    }

    if (!response.ok) {
        throw new ApiError(
            response.status,
            // The rate limiter answers in English; people need to know to wait.
            response.status === 429
                ? TOO_MANY_REQUESTS_MESSAGE
                : readServerMessage(payload) ??
                  options.fallbackMessage ??
                  "Не удалось выполнить запрос.",
            payload,
        );
    }

    return payload as T;
}
