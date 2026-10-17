import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    FindOptionsWhere,
    IsNull,
    QueryFailedError,
    Repository,
} from "typeorm";
import { CreatePlannerObservationDto } from "../../dto/planner-observations/create-planner-observation.dto";
import {
    AdminPlannerReviewFilter,
    ListAdminPlannerObservationsDto,
} from "../../dto/planner-observations/list-admin-planner-observations.dto";
import { UpdatePlannerObservationReviewDto } from "../../dto/planner-observations/update-planner-observation-review.dto";
import { UpdatePlannerObservationTriageDto } from "../../dto/planner-observations/update-planner-observation-triage.dto";
import { PlannerObservation } from "../../entities/PlannerObservation/planner-observation.entity";
import { User } from "../../entities/User/user.entity";

@Injectable()
export class PlannerObservationService {
    constructor(
        @InjectRepository(PlannerObservation)
        private readonly observationRepository: Repository<PlannerObservation>,
    ) {}

    async create(
        user: User,
        dto: CreatePlannerObservationDto,
    ): Promise<PlannerObservation> {
        const existing = await this.findByClientObservationId(
            user.id,
            dto.clientObservationId,
        );
        if (existing) return existing;

        const observation = this.observationRepository.create({
            createdBy: user,
            clientObservationId: dto.clientObservationId,
            inputSnapshot: dto.inputSnapshot,
            layoutSnapshot: dto.layoutSnapshot,
            inputFingerprint: dto.inputFingerprint,
            layoutFingerprint: dto.layoutFingerprint,
            algorithmVersion: dto.algorithmVersion,
            catalogVersion: dto.catalogVersion,
            solverStatus: dto.solverStatus,
            reviewVerdict: null,
            reviewComment: null,
            reviewedAt: null,
            triageStatus: "new",
            triagedAt: null,
        });

        try {
            return await this.observationRepository.save(observation);
        } catch (error) {
            // A browser can retry after a dropped response. The unique key is
            // the authority here, so return the original immutable row.
            if (!this.isUniqueViolation(error)) throw error;
            const concurrent = await this.findByClientObservationId(
                user.id,
                dto.clientObservationId,
            );
            if (concurrent) return concurrent;
            throw error;
        }
    }

    async updateReview(
        userId: number,
        observationId: number,
        dto: UpdatePlannerObservationReviewDto,
    ): Promise<PlannerObservation> {
        const observation = await this.observationRepository.findOne({
            where: { id: observationId, createdBy: { id: userId } },
        });
        if (!observation) {
            // Do not disclose whether an observation exists for another user.
            throw new NotFoundException("Наблюдение не найдено");
        }

        observation.reviewVerdict = dto.verdict;
        observation.reviewComment = dto.comment;
        observation.reviewedAt = new Date();
        return this.observationRepository.save(observation);
    }

    async listForAdmin(
        dto: ListAdminPlannerObservationsDto,
    ): Promise<PlannerObservation[]> {
        const where: FindOptionsWhere<PlannerObservation> = {};

        if (dto.status) where.triageStatus = dto.status;
        this.applyAdminReviewFilter(where, dto.review);

        return this.observationRepository.find({
            where,
            relations: { createdBy: true },
            order: { createdAt: "DESC", id: "DESC" },
            take: dto.limit,
        });
    }

    async updateTriageForAdmin(
        observationId: number,
        dto: UpdatePlannerObservationTriageDto,
    ): Promise<PlannerObservation> {
        const observation = await this.observationRepository.findOne({
            where: { id: observationId },
            relations: { createdBy: true },
        });
        if (!observation) {
            throw new NotFoundException("Наблюдение не найдено");
        }

        observation.triageStatus = dto.status;
        observation.triagedAt = dto.status === "new" ? null : new Date();
        return this.observationRepository.save(observation);
    }

    private findByClientObservationId(
        userId: number,
        clientObservationId: string,
    ): Promise<PlannerObservation | null> {
        return this.observationRepository.findOne({
            where: { createdBy: { id: userId }, clientObservationId },
        });
    }

    private isUniqueViolation(error: unknown): boolean {
        if (!(error instanceof QueryFailedError)) return false;
        const driverError = error.driverError as { code?: string };
        return driverError.code === "23505";
    }

    private applyAdminReviewFilter(
        where: FindOptionsWhere<PlannerObservation>,
        review: AdminPlannerReviewFilter | undefined,
    ): void {
        if (!review) return;
        if (review === "unreviewed") {
            where.reviewVerdict = IsNull();
            return;
        }

        where.reviewVerdict = review;
    }
}
