import { Transform } from "class-transformer";
import { IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";
import {
    PLANNER_REVIEW_VERDICTS,
    PlannerReviewVerdict,
} from "../../entities/PlannerObservation/planner-observation.entity";

export class UpdatePlannerObservationReviewDto {
    @IsIn(PLANNER_REVIEW_VERDICTS)
    verdict: PlannerReviewVerdict;

    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    @IsString()
    @MinLength(1)
    @MaxLength(1200)
    @Matches(/^[^\u0000-\u001f\u007f]+$/, {
        message: "comment must not contain control characters",
    })
    comment: string;
}
