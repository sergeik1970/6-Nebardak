import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import {
    CreateProjectDto,
    ProjectNameDto,
    SaveProjectDocumentDto,
} from "../../dto/projects/project.dto";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";
import { AuthGuard, AuthenticatedRequest } from "../../guards/auth.guard";
import { MAX_PROJECTS_PER_USER } from "../../projects/project-document";
import {
    ProjectDetail,
    ProjectListItem,
    ProjectService,
    SavedRevision,
} from "../../services/ProjectService/project.service";

const projectId = new ParseUUIDPipe({ version: "4" });

@Controller("projects")
@UseGuards(AuthEnabledGuard, AuthGuard)
export class ProjectsController {
    constructor(private readonly projects: ProjectService) {}

    @Get()
    async list(
        @Req() request: AuthenticatedRequest,
    ): Promise<{ projects: ProjectListItem[]; limit: number }> {
        return {
            projects: await this.projects.list(request.user.id),
            limit: MAX_PROJECTS_PER_USER,
        };
    }

    /** 201 for a new project, 200 when a retried import found its original. */
    @Throttle({ default: { limit: 20, ttl: 60_000, blockDuration: 60_000 } })
    @Post()
    async create(
        @Req() request: AuthenticatedRequest,
        @Body() dto: CreateProjectDto,
        @Res({ passthrough: true }) response: Response,
    ): Promise<{ project: ProjectDetail }> {
        const { project, created } = await this.projects.create(
            request.user.id,
            dto,
        );
        response.status(created ? 201 : 200);
        return { project };
    }

    @Get(":id")
    async get(
        @Req() request: AuthenticatedRequest,
        @Param("id", projectId) id: string,
    ): Promise<{ project: ProjectDetail }> {
        return { project: await this.projects.get(request.user.id, id) };
    }

    /** Autosave target; 409 carries the server's current revision. */
    @Throttle({ default: { limit: 120, ttl: 60_000, blockDuration: 60_000 } })
    @Put(":id/document")
    async saveDocument(
        @Req() request: AuthenticatedRequest,
        @Param("id", projectId) id: string,
        @Body() dto: SaveProjectDocumentDto,
    ): Promise<SavedRevision> {
        return this.projects.saveDocument(request.user.id, id, dto);
    }

    @Patch(":id")
    async rename(
        @Req() request: AuthenticatedRequest,
        @Param("id", projectId) id: string,
        @Body() dto: ProjectNameDto,
    ): Promise<{ project: ProjectListItem }> {
        return {
            project: await this.projects.rename(request.user.id, id, dto.name),
        };
    }

    @Throttle({ default: { limit: 20, ttl: 60_000, blockDuration: 60_000 } })
    @Post(":id/duplicate")
    async duplicate(
        @Req() request: AuthenticatedRequest,
        @Param("id", projectId) id: string,
    ): Promise<{ project: ProjectDetail }> {
        return { project: await this.projects.duplicate(request.user.id, id) };
    }

    @HttpCode(204)
    @Delete(":id")
    async remove(
        @Req() request: AuthenticatedRequest,
        @Param("id", projectId) id: string,
    ): Promise<void> {
        await this.projects.remove(request.user.id, id);
    }
}
