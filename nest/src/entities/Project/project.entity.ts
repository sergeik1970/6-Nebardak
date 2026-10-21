import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { User } from "../User/user.entity";

export const PROJECT_STAGES = [
    "style",
    "questionnaire",
    "room",
    "layout",
    "done",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

/** Light, client-computed facts for the project list; never trusted for logic. */
export interface ProjectSummary {
    styleLabel?: string;
    areaM2?: number;
    furnitureCount?: number;
    stage?: ProjectStage;
}

/**
 * One saved room project. The planner document is opaque JSON to the API:
 * the browser owns its schema and migrations, the server owns ownership,
 * size limits and the revision used for optimistic concurrency.
 */
@Entity({ name: "project" })
export class Project {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "owner_user_id" })
    owner: User;

    @Column({ type: "varchar", length: 80 })
    name: string;

    @Column({ type: "jsonb" })
    document: Record<string, unknown>;

    @Column({ name: "document_version", type: "smallint" })
    documentVersion: number;

    /** +1 on every document save; a stale base revision is a conflict. */
    @Column({ type: "integer", default: 1 })
    revision: number;

    @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
    summary: ProjectSummary;

    /** Idempotency key of an imported guest draft. */
    @Column({
        name: "client_import_id",
        type: "varchar",
        length: 64,
        nullable: true,
    })
    clientImportId: string | null;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
