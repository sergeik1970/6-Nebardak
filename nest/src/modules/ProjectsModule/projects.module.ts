import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectsController } from "../../controllers/ProjectsController/projects.controller";
import { Project } from "../../entities/Project/project.entity";
import { ProjectService } from "../../services/ProjectService/project.service";
import { AuthModule } from "../AuthModule/auth.module";

@Module({
    imports: [AuthModule, TypeOrmModule.forFeature([Project])],
    controllers: [ProjectsController],
    providers: [ProjectService],
})
export class ProjectsModule {}
