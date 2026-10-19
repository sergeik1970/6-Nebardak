import { Body, Controller, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Param, ParseIntPipe } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreatePlannerObservationDto } from "../../dto/planner-observations/create-planner-observation.dto";
import { UpdatePlannerObservationReviewDto } from "../../dto/planner-observations/update-planner-observation-review.dto";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";
import { AuthGuard, AuthenticatedRequest } from "../../guards/auth.guard";
import { PlannerObservation } from "../../entities/PlannerObservation/planner-observation.entity";
import { PlannerObservationService } from "../../services/PlannerObservationService/planner-observation.service";

const toResponse = (observation: PlannerObservation) => ({
    id: observation.id,
    clientObservationId: observation.clientObservationId,
    review:
        observation.reviewVerdict &&
        observation.reviewComment &&
        observation.reviewedAt
            ? {
                  verdict: observation.reviewVerdict,
                  comment: observation.reviewComment,
                  reviewedAt: observation.reviewedAt.toISOString(),
              }
            : null,
    createdAt: observation.createdAt.toISOString(),
    updatedAt: observation.updatedAt.toISOString(),
});

@Controller("planner-observations")
@UseGuards(AuthEnabledGuard, AuthGuard)
export class PlannerObservationsController {
    constructor(
        private readonly observationService: PlannerObservationService,
    ) {}

    @Post()
    @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 60_000 } })
    async create(
        @Req() request: AuthenticatedRequest,
        @Body() dto: CreatePlannerObservationDto,
    ) {
        return toResponse(
            await this.observationService.create(request.user, dto),
        );
    }

    @Patch(":id/review")
    @Throttle({ default: { limit: 20, ttl: 60_000, blockDuration: 60_000 } })
    async updateReview(
        @Req() request: AuthenticatedRequest,
        @Param("id", ParseIntPipe) observationId: number,
        @Body() dto: UpdatePlannerObservationReviewDto,
    ) {
        return toResponse(
            await this.observationService.updateReview(
                request.user.id,
                observationId,
                dto,
            ),
        );
    }
}
