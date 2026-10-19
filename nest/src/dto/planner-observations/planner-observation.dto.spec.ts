import { BadRequestException } from "@nestjs/common";
import { createGlobalValidationPipe } from "../../config/validation";
import { CreatePlannerObservationDto } from "./create-planner-observation.dto";
import { UpdatePlannerObservationReviewDto } from "./update-planner-observation-review.dto";

const bodyMetadata = <T>(metatype: new () => T) => ({
    type: "body" as const,
    metatype,
    data: undefined,
});

describe("planner observation DTO validation", () => {
    const pipe = createGlobalValidationPipe();

    it("accepts a bounded immutable snapshot and trims its one review comment", async () => {
        await expect(
            pipe.transform(
                {
                    clientObservationId: "planner-a1b2c3d4",
                    inputSnapshot: { room: { width: 6000 } },
                    layoutSnapshot: { placements: [] },
                    inputFingerprint: "fnv1a-input",
                    layoutFingerprint: "fnv1a-layout",
                    algorithmVersion: "deterministic-layout-v2",
                    catalogVersion: "catalog-v1",
                    solverStatus: "success",
                },
                bodyMetadata(CreatePlannerObservationDto),
            ),
        ).resolves.toBeInstanceOf(CreatePlannerObservationDto);

        await expect(
            pipe.transform(
                { verdict: "questionable", comment: "  Не хватает прохода.  " },
                bodyMetadata(UpdatePlannerObservationReviewDto),
            ),
        ).resolves.toMatchObject({ comment: "Не хватает прохода." });
    });

    it("rejects unknown data and a blank or malformed review without reflecting its text", async () => {
        await expect(
            pipe.transform(
                {
                    clientObservationId: "planner-a1b2c3d4",
                    inputSnapshot: [],
                    layoutSnapshot: { placements: [] },
                    inputFingerprint: "fnv1a-input",
                    layoutFingerprint: "fnv1a-layout",
                    algorithmVersion: "deterministic-layout-v2",
                    catalogVersion: "catalog-v1",
                    solverStatus: "success",
                    ownerId: 99,
                },
                bodyMetadata(CreatePlannerObservationDto),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);

        await expect(
            pipe.transform(
                { verdict: "other", comment: " " },
                bodyMetadata(UpdatePlannerObservationReviewDto),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
