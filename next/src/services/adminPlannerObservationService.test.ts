import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalAuthEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

const loadService = async () => {
    process.env.NEXT_PUBLIC_AUTH_ENABLED = "true";
    process.env.NEXT_PUBLIC_API_URL = "http://planner.test/api";
    vi.resetModules();

    const { adminPlannerObservationService } = await import("./adminPlannerObservationService");

    return adminPlannerObservationService;
};

describe("adminPlannerObservationService", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (originalAuthEnabled === undefined) {
            delete process.env.NEXT_PUBLIC_AUTH_ENABLED;
        } else {
            process.env.NEXT_PUBLIC_AUTH_ENABLED = originalAuthEnabled;
        }
        if (originalApiUrl === undefined) {
            delete process.env.NEXT_PUBLIC_API_URL;
        } else {
            process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
        }
    });

    it("loads every observation without turning the all filter into an invalid query", async () => {
        const service = await loadService();
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ observations: [{ id: 19 }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        await expect(service.list({ status: "all", review: "all" })).resolves.toEqual([{ id: 19 }]);
        expect(fetchMock).toHaveBeenCalledWith(
            "http://planner.test/api/admin/planner-observations",
            expect.objectContaining({
                method: "GET",
                credentials: "same-origin",
                headers: expect.not.objectContaining({ Authorization: expect.anything() }),
            }),
        );
    });

    it("sends only the selected server-side filters and persists triage changes", async () => {
        const service = await loadService();
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ observations: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ id: 19, triageStatus: "resolved" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );

        await service.list({ status: "resolved", review: "needs-fix" });
        await expect(service.updateTriage(19, "resolved")).resolves.toMatchObject({
            id: 19,
            triageStatus: "resolved",
        });

        expect(fetchMock.mock.calls[0][0]).toBe(
            "http://planner.test/api/admin/planner-observations?status=resolved&review=needs-fix",
        );
        expect(fetchMock.mock.calls[1][0]).toBe(
            "http://planner.test/api/admin/planner-observations/19/triage",
        );
        expect(fetchMock.mock.calls[1][1]).toMatchObject({
            method: "PATCH",
            credentials: "same-origin",
            headers: expect.objectContaining({ "X-Requested-With": "stylefinder" }),
            body: JSON.stringify({ status: "resolved" }),
        });
    });
});
