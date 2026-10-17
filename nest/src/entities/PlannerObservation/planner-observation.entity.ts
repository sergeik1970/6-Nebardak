import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { User } from "../User/user.entity";

export const PLANNER_REVIEW_VERDICTS = [
    "good",
    "questionable",
    "needs-fix",
] as const;

export type PlannerReviewVerdict = (typeof PLANNER_REVIEW_VERDICTS)[number];

export const PLANNER_OBSERVATION_TRIAGE_STATUSES = [
    "new",
    "in-progress",
    "resolved",
    "dismissed",
] as const;

export type PlannerObservationTriageStatus =
    (typeof PLANNER_OBSERVATION_TRIAGE_STATUSES)[number];

/**
 * A frozen solver result together with the one designer conclusion for it.
 * The snapshots deliberately stay JSONB so a later algorithm change can be
 * compared with the exact room, furniture and coordinates that were reviewed.
 */
@Entity({ name: "planner_observations" })
@Index(
    "UQ_planner_observations_owner_client",
    ["createdBy", "clientObservationId"],
    {
        unique: true,
    },
)
export class PlannerObservation {
    @PrimaryGeneratedColumn("increment")
    id: number;

    @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "created_by_user_id" })
    createdBy: User;

    /** Client-generated idempotency key. A retried generation never creates a second row. */
    @Column({ name: "client_observation_id", type: "varchar", length: 64 })
    clientObservationId: string;

    @Column({ name: "input_snapshot", type: "jsonb" })
    inputSnapshot: Record<string, unknown>;

    @Column({ name: "layout_snapshot", type: "jsonb" })
    layoutSnapshot: Record<string, unknown>;

    @Column({ name: "input_fingerprint", type: "varchar", length: 512 })
    inputFingerprint: string;

    @Column({ name: "layout_fingerprint", type: "varchar", length: 512 })
    layoutFingerprint: string;

    @Column({ name: "algorithm_version", type: "varchar", length: 80 })
    algorithmVersion: string;

    @Column({ name: "catalog_version", type: "varchar", length: 512 })
    catalogVersion: string;

    @Column({ name: "solver_status", type: "varchar", length: 24 })
    solverStatus: string;

    @Column({
        name: "review_verdict",
        type: "varchar",
        length: 16,
        nullable: true,
    })
    reviewVerdict: PlannerReviewVerdict | null;

    /** There is intentionally one replaceable conclusion, not an item-level comment thread. */
    @Column({
        name: "review_comment",
        type: "varchar",
        length: 1200,
        nullable: true,
    })
    reviewComment: string | null;

    @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
    reviewedAt: Date | null;

    /**
     * A small internal work-queue state. It does not change the designer's
     * immutable layout snapshot or their single review comment.
     */
    @Column({
        name: "triage_status",
        type: "varchar",
        length: 16,
        default: "new",
    })
    triageStatus: PlannerObservationTriageStatus;

    @Column({ name: "triaged_at", type: "timestamptz", nullable: true })
    triagedAt: Date | null;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
