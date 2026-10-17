import { Module } from "@nestjs/common";
import { AdminPlannerObservationsController } from "../../controllers/AdminPlannerObservationsController/admin-planner-observations.controller";
import { AdminGuard } from "../../guards/admin.guard";
import { AuthModule } from "../AuthModule/auth.module";
import { PlannerObservationsModule } from "../PlannerObservationsModule/planner-observations.module";

@Module({
    imports: [AuthModule, PlannerObservationsModule],
    controllers: [AdminPlannerObservationsController],
    providers: [AdminGuard],
})
export class AdminPlannerObservationsModule {}
