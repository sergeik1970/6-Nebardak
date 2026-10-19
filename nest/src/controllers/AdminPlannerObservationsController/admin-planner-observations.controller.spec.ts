import { AdminPlannerObservationsController } from "./admin-planner-observations.controller";
import { PlannerObservationService } from "../../services/PlannerObservationService/planner-observation.service";

const observation = {
    id: 31,
    createdAt: new Date("2026-08-10T12:00:00.000Z"),
    updatedAt: new Date("2026-08-10T12:05:00.000Z"),
    inputSnapshot: { room: { width: 4800, depth: 3600 } },
    layoutSnapshot: { specification: { items: [] } },
    inputFingerprint: "input-fingerprint",
    layoutFingerprint: "layout-fingerprint",
    algorithmVersion: "planner-v2",
    catalogVersion: "catalog-v1",
    solverStatus: "complete",
    reviewVerdict: "needs-fix",
    reviewComment: "Оставить больше прохода.",
    reviewedAt: new Date("2026-08-10T12:01:00.000Z"),
    triageStatus: "new",
    triagedAt: null,
    createdBy: {
        id: 9,
        name: "Мария",
        email: "private@example.com",
    },
};

describe("AdminPlannerObservationsController", () => {
    it("returns only the display identity needed by a protected review queue", async () => {
        const service = {
            listForAdmin: jest.fn().mockResolvedValue([observation]),
        } as unknown as PlannerObservationService;
        const controller = new AdminPlannerObservationsController(service);

        const result = await controller.list({ limit: 50 });

        expect(result).toEqual({
            observations: [
                expect.objectContaining({
                    id: 31,
                    reviewer: { id: 9, name: "Мария" },
                }),
            ],
        });
        expect(JSON.stringify(result)).not.toContain("private@example.com");
    });
});
