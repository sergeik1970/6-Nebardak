import { Module } from "@nestjs/common";
import { PlanRecognitionController } from "../../controllers/PlanRecognitionController/plan-recognition.controller";
import { PlanRecognitionService } from "../../services/PlanRecognitionService/plan-recognition.service";
import { AuthModule } from "../AuthModule/auth.module";

@Module({
    imports: [AuthModule],
    controllers: [PlanRecognitionController],
    providers: [
        {
            provide: PlanRecognitionService,
            useFactory: () => new PlanRecognitionService(),
        },
    ],
})
export class PlanRecognitionModule {}
