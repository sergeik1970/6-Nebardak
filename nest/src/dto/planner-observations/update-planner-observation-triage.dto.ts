import { IsIn } from "class-validator";
import {
    PLANNER_OBSERVATION_TRIAGE_STATUSES,
    PlannerObservationTriageStatus,
} from "../../entities/PlannerObservation/planner-observation.entity";

export class UpdatePlannerObservationTriageDto {
    @IsIn(PLANNER_OBSERVATION_TRIAGE_STATUSES)
    status: PlannerObservationTriageStatus;
}
