import { NotFoundException } from "@nestjs/common";
import { QueryFailedError, Repository } from "typeorm";
import { PlannerObservation } from "../../entities/PlannerObservation/planner-observation.entity";
import { User } from "../../entities/User/user.entity";
import { PlannerObservationService } from "./planner-observation.service";

const user = { id: 7, name: "Дизайнер", email: "designer@example.com" } as User;
const input = {
    clientObservationId: "planner-a1b2c3d4",
    inputSnapshot: { room: { width: 6000, depth: 4600 } },
    layoutSnapshot: { placements: [] },
    inputFingerprint: "fnv1a-input",
    layoutFingerprint: "fnv1a-layout",
    algorithmVersion: "deterministic-layout-v2",
    catalogVersion: "catalog-v1",
    solverStatus: "success",
};

function makeRepository() {
    const repository = {
        create: jest.fn((value) => value),
        save: jest.fn(),
        findOne: jest.fn(),
        find: jest.fn(),
    } as unknown as Repository<PlannerObservation>;

    return {
        repository,
        save: repository.save as jest.Mock,
        findOne: repository.findOne as jest.Mock,
    };
}

describe("PlannerObservationService", () => {
    it("stores an immutable snapshot once for a retryable client observation id", async () => {
        const { repository, save, findOne } = makeRepository();
        findOne.mockResolvedValueOnce(null);
        save.mockImplementation(async (value) => ({ ...value, id: 18 }));
        const service = new PlannerObservationService(repository);

        await expect(service.create(user, input)).resolves.toMatchObject({
            id: 18,
            createdBy: user,
            clientObservationId: input.clientObservationId,
            inputSnapshot: input.inputSnapshot,
            layoutSnapshot: input.layoutSnapshot,
            reviewComment: null,
        });
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("returns the original row rather than duplicating a retried generation", async () => {
        const { repository, save, findOne } = makeRepository();
        const existing = {
            id: 18,
            clientObservationId: input.clientObservationId,
        } as PlannerObservation;
        findOne.mockResolvedValue(existing);
        const service = new PlannerObservationService(repository);

        await expect(service.create(user, input)).resolves.toBe(existing);
        expect(save).not.toHaveBeenCalled();
    });

    it("recovers safely when the unique key wins a concurrent create", async () => {
        const { repository, save, findOne } = makeRepository();
        const existing = {
            id: 18,
            clientObservationId: input.clientObservationId,
        } as PlannerObservation;
        findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
        save.mockRejectedValue(
            new QueryFailedError("INSERT", [], {
                code: "23505",
            } as unknown as Error),
        );
        const service = new PlannerObservationService(repository);

        await expect(service.create(user, input)).resolves.toBe(existing);
    });

    it("keeps the single review private to its author and replaces it on update", async () => {
        const { repository, save, findOne } = makeRepository();
        const observation = { id: 18, createdBy: user } as PlannerObservation;
        findOne.mockResolvedValue(observation);
        save.mockImplementation(async (value) => value);
        const service = new PlannerObservationService(repository);

        await expect(
            service.updateReview(user.id, 18, {
                verdict: "needs-fix",
                comment: "Кровать разрывает зону хранения.",
            }),
        ).resolves.toMatchObject({
            reviewVerdict: "needs-fix",
            reviewComment: "Кровать разрывает зону хранения.",
            reviewedAt: expect.any(Date),
        });
        expect(findOne).toHaveBeenCalledWith({
            where: { id: 18, createdBy: { id: user.id } },
        });
    });

    it("does not reveal an observation owned by another user", async () => {
        const { repository, findOne } = makeRepository();
        findOne.mockResolvedValue(null);
        const service = new PlannerObservationService(repository);

        await expect(
            service.updateReview(99, 18, {
                verdict: "good",
                comment: "Подходит.",
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns a bounded newest-first admin queue without exposing it through owner APIs", async () => {
        const { repository } = makeRepository();
        const observation = {
            id: 20,
            createdBy: user,
            triageStatus: "new",
        } as PlannerObservation;
        (repository.find as jest.Mock).mockResolvedValue([observation]);
        const service = new PlannerObservationService(repository);

        await expect(
            service.listForAdmin({
                status: "new",
                review: "unreviewed",
                limit: 25,
            }),
        ).resolves.toEqual([observation]);

        expect(repository.find).toHaveBeenCalledWith({
            where: {
                triageStatus: "new",
                reviewVerdict: expect.anything(),
            },
            relations: { createdBy: true },
            order: { createdAt: "DESC", id: "DESC" },
            take: 25,
        });
    });

    it("updates only the internal triage state while retaining the designer comment", async () => {
        const { repository, findOne, save } = makeRepository();
        const observation = {
            id: 20,
            createdBy: user,
            reviewComment: "Проход слишком узкий.",
            triageStatus: "new",
            triagedAt: null,
        } as PlannerObservation;
        findOne.mockResolvedValue(observation);
        save.mockImplementation(async (value) => value);
        const service = new PlannerObservationService(repository);

        await expect(
            service.updateTriageForAdmin(20, { status: "in-progress" }),
        ).resolves.toMatchObject({
            triageStatus: "in-progress",
            reviewComment: "Проход слишком узкий.",
            triagedAt: expect.any(Date),
        });
        expect(findOne).toHaveBeenCalledWith({
            where: { id: 20 },
            relations: { createdBy: true },
        });
    });
});
