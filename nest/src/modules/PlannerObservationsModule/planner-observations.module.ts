import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlannerObservationsController } from "../../controllers/PlannerObservationsController/planner-observations.controller";
import { PlannerObservation } from "../../entities/PlannerObservation/planner-observation.entity";
import { AuthModule } from "../AuthModule/auth.module";
import { PlannerObservationService } from "../../services/PlannerObservationService/planner-observation.service";

@Module({
    imports: [AuthModule, TypeOrmModule.forFeature([PlannerObservation])],
    controllers: [PlannerObservationsController],
    providers: [PlannerObservationService],
    exports: [PlannerObservationService],
})
export class PlannerObservationsModule {}
