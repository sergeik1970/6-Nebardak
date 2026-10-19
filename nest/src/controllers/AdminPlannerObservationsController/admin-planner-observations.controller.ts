import {
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Query,
    Body,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ListAdminPlannerObservationsDto } from "../../dto/planner-observations/list-admin-planner-observations.dto";
import { UpdatePlannerObservationTriageDto } from "../../dto/planner-observations/update-planner-observation-triage.dto";
import { PlannerObservation } from "../../entities/PlannerObservation/planner-observation.entity";
import { AdminGuard } from "../../guards/admin.guard";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";
import { AuthGuard } from "../../guards/auth.guard";
import { PlannerObservationService } from "../../services/PlannerObservationService/planner-observation.service";

const toAdminResponse = (observation: PlannerObservation) => ({
    id: observation.id,
    createdAt: observation.createdAt.toISOString(),
    updatedAt: observation.updatedAt.toISOString(),
    inputSnapshot: observation.inputSnapshot,
    layoutSnapshot: observation.layoutSnapshot,
    inputFingerprint: observation.inputFingerprint,
    layoutFingerprint: observation.layoutFingerprint,
    algorithmVersion: observation.algorithmVersion,
    catalogVersion: observation.catalogVersion,
    solverStatus: observation.solverStatus,
    reviewVerdict: observation.reviewVerdict,
    reviewComment: observation.reviewComment,
    reviewedAt: observation.reviewedAt?.toISOString() ?? null,
    triageStatus: observation.triageStatus,
    triagedAt: observation.triagedAt?.toISOString() ?? null,
    // The reviewer’s display name is adequate for operational follow-up.
    // Email is deliberately excluded from this cross-user view.
    reviewer: {
        id: observation.createdBy.id,
        name: observation.createdBy.name,
    },
});

@Controller("admin/planner-observations")
@UseGuards(AuthEnabledGuard, AuthGuard, AdminGuard)
export class AdminPlannerObservationsController {
    constructor(
        private readonly observationService: PlannerObservationService,
    ) {}

    @Get()
    @Throttle({ default: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
    async list(@Query() dto: ListAdminPlannerObservationsDto) {
        const observations = await this.observationService.listForAdmin(dto);
        return {
            observations: observations.map(toAdminResponse),
        };
    }

    @Patch(":id/triage")
    @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 60_000 } })
    async updateTriage(
        @Param("id", ParseIntPipe) observationId: number,
        @Body() dto: UpdatePlannerObservationTriageDto,
    ) {
        return toAdminResponse(
            await this.observationService.updateTriageForAdmin(
                observationId,
                dto,
            ),
        );
    }
}
