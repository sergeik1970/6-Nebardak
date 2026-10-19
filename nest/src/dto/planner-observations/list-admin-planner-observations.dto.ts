import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import {
    PLANNER_OBSERVATION_TRIAGE_STATUSES,
    PlannerObservationTriageStatus,
    PLANNER_REVIEW_VERDICTS,
} from "../../entities/PlannerObservation/planner-observation.entity";

export const ADMIN_PLANNER_REVIEW_FILTERS = [
    "unreviewed",
    ...PLANNER_REVIEW_VERDICTS,
] as const;

export type AdminPlannerReviewFilter =
    (typeof ADMIN_PLANNER_REVIEW_FILTERS)[number];

export class ListAdminPlannerObservationsDto {
    @IsOptional()
    @IsIn(PLANNER_OBSERVATION_TRIAGE_STATUSES)
    status?: PlannerObservationTriageStatus;

    @IsOptional()
    @IsIn(ADMIN_PLANNER_REVIEW_FILTERS)
    review?: AdminPlannerReviewFilter;

    @IsOptional()
    @Transform(({ value }) =>
        typeof value === "string" ? Number(value) : value,
    )
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 50;
}
