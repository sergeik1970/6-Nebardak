import {
    Body,
    Controller,
    HttpCode,
    Post,
    Req,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ReadPlanDto } from "../../dto/plan-recognition/read-plan.dto";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";
import { AuthGuard, type AuthenticatedRequest } from "../../guards/auth.guard";
import { PlanRecognitionService } from "../../services/PlanRecognitionService/plan-recognition.service";

/**
 * Reads an uploaded floor plan. Signed-in users only, and few requests: each
 * one costs a model call of up to a few minutes.
 */
@Controller("plan-recognition")
@UseGuards(AuthEnabledGuard, AuthGuard)
export class PlanRecognitionController {
    constructor(private readonly planRecognition: PlanRecognitionService) {}

    @Post()
    @HttpCode(200)
    @Throttle({ default: { limit: 6, ttl: 600_000, blockDuration: 600_000 } })
    read(@Req() request: AuthenticatedRequest, @Body() dto: ReadPlanDto) {
        return this.planRecognition.read(String(request.user.id), dto);
    }
}
