import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalAuthEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

const loadClient = async () => {
    process.env.NEXT_PUBLIC_AUTH_ENABLED = "true";
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.resetModules();
    return import("./apiClient");
};

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

describe("apiRequest", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        if (originalAuthEnabled === undefined) delete process.env.NEXT_PUBLIC_AUTH_ENABLED;
        else process.env.NEXT_PUBLIC_AUTH_ENABLED = originalAuthEnabled;
        if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
        else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    });

    it("defaults to the same-origin /api path and sends the CSRF marker only on writes", async () => {
        const { apiRequest } = await loadClient();
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(json(200, { user: null }));
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

        await expect(apiRequest("/auth/session")).resolves.toEqual({ user: null });
        await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();

        const [getUrl, getInit] = fetchMock.mock.calls[0];
        expect(getUrl).toBe("/api/auth/session");
        expect(getInit).toMatchObject({ credentials: "same-origin", method: "GET" });
        expect(getInit?.headers).not.toHaveProperty("X-Requested-With");
        expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
            "X-Requested-With": "stylefinder",
        });
    });

    it("surfaces the server message, including the first validation error", async () => {
        const { apiRequest, ApiError } = await loadClient();
        vi.mocked(fetch)
            .mockResolvedValueOnce(json(401, { message: "Неверный email или пароль" }))
            .mockResolvedValueOnce(json(400, { message: ["password must be longer"] }));

        const first = await apiRequest("/auth/login", { method: "POST", body: {} }).catch(
            (error: unknown) => error,
        );
        expect(first).toBeInstanceOf(ApiError);
        expect(first).toMatchObject({ status: 401, message: "Неверный email или пароль" });
        await expect(apiRequest("/auth/register", { method: "POST", body: {} })).rejects.toThrow(
            "password must be longer",
        );
    });

    it("explains rate limiting in Russian instead of the limiter's English text", async () => {
        const { apiRequest } = await loadClient();
        vi.mocked(fetch).mockResolvedValueOnce(
            json(429, { message: "ThrottlerException: Too Many Requests" }),
        );

        await expect(
            apiRequest("/auth/forgot-password", { method: "POST", body: {} }),
        ).rejects.toMatchObject({ status: 429, message: expect.stringContaining("Слишком много") });
    });

    it("turns a network failure and an HTML error page into readable errors", async () => {
        const { apiRequest } = await loadClient();
        vi.mocked(fetch)
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));

        await expect(apiRequest("/auth/session")).rejects.toMatchObject({
            status: 0,
            message: expect.stringContaining("Нет соединения"),
        });
        await expect(
            apiRequest("/auth/session", { fallbackMessage: "Сервер недоступен" }),
        ).rejects.toMatchObject({ status: 502, message: "Сервер недоступен" });
    });
});
