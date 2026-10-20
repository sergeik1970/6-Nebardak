import {
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import {
    CreateProjectDto,
    SaveProjectDocumentDto,
} from "../../dto/projects/project.dto";
import { ProjectSummary } from "../../entities/Project/project.entity";
import { MAX_PROJECTS_PER_USER } from "../../projects/project-document";

export interface ProjectListItem {
    id: string;
    name: string;
    summary: ProjectSummary;
    documentVersion: number;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface ProjectDetail extends ProjectListItem {
    document: Record<string, unknown>;
}

export interface SavedRevision {
    revision: number;
    updatedAt: Date;
}

interface ProjectRow {
    id: string;
    name: string;
    summary: ProjectSummary;
    document_version: number;
    revision: number;
    created_at: Date;
    updated_at: Date;
    document?: Record<string, unknown>;
}

const LIST_COLUMNS = `"id", "name", "summary", "document_version", "revision", "created_at", "updated_at"`;
const COPY_SUFFIX = " (копия)";

/** TypeORM returns [rows, affectedCount] for UPDATE/DELETE on PostgreSQL. */
function mutationRows<T>(result: unknown): T[] {
    if (Array.isArray(result) && Array.isArray(result[0]))
        return result[0] as T[];
    return Array.isArray(result) ? (result as T[]) : [];
}

function mutationCount(result: unknown): number {
    return Array.isArray(result) && typeof result[1] === "number"
        ? result[1]
        : 0;
}

/**
 * Every query is scoped by owner in SQL itself: a project id that belongs to
 * someone else behaves exactly like one that does not exist.
 */
@Injectable()
export class ProjectService {
    constructor(private readonly dataSource: DataSource) {}

    async list(ownerId: number): Promise<ProjectListItem[]> {
        const rows: ProjectRow[] = await this.dataSource.query(
            `SELECT ${LIST_COLUMNS} FROM "project"
             WHERE "owner_user_id" = $1
             ORDER BY "updated_at" DESC`,
            [ownerId],
        );
        return rows.map((row) => this.toListItem(row));
    }

    async get(ownerId: number, projectId: string): Promise<ProjectDetail> {
        const rows: ProjectRow[] = await this.dataSource.query(
            `SELECT ${LIST_COLUMNS}, "document" FROM "project"
             WHERE "id" = $1 AND "owner_user_id" = $2`,
            [projectId, ownerId],
        );
        if (rows.length === 0) throw this.notFound();
        return this.toDetail(rows[0]);
    }

    /** `created: false` means a retried import returned the original project. */
    async create(
        ownerId: number,
        dto: CreateProjectDto,
    ): Promise<{ project: ProjectDetail; created: boolean }> {
        if (dto.clientImportId) {
            const existing = await this.findImport(ownerId, dto.clientImportId);
            if (existing) return { project: existing, created: false };
        }

        try {
            const project = await this.dataSource.transaction((manager) =>
                this.insertWithinLimit(manager, ownerId, {
                    name: dto.name,
                    document: dto.document,
                    summary: dto.summary ?? {},
                    clientImportId: dto.clientImportId ?? null,
                }),
            );
            return { project, created: true };
        } catch (error) {
            if (dto.clientImportId && this.isUniqueViolation(error)) {
                const concurrent = await this.findImport(
                    ownerId,
                    dto.clientImportId,
                );
                if (concurrent) return { project: concurrent, created: false };
            }
            throw error;
        }
    }

    /**
     * Optimistic concurrency in one statement: the write lands only if
     * nobody saved since `baseRevision`, so two tabs or devices can never
     * silently overwrite each other.
     */
    async saveDocument(
        ownerId: number,
        projectId: string,
        dto: SaveProjectDocumentDto,
    ): Promise<SavedRevision> {
        const result: unknown = await this.dataSource.query(
            `UPDATE "project"
             SET "document" = $1::jsonb,
                 "document_version" = $2,
                 "summary" = COALESCE($3::jsonb, "summary"),
                 "revision" = "revision" + 1,
                 "updated_at" = now()
             WHERE "id" = $4 AND "owner_user_id" = $5 AND "revision" = $6
             RETURNING "revision", "updated_at"`,
            [
                JSON.stringify(dto.document),
                dto.document.version,
                dto.summary ? JSON.stringify(dto.summary) : null,
                projectId,
                ownerId,
                dto.baseRevision,
            ],
        );
        const saved = mutationRows<{ revision: number; updated_at: Date }>(
            result,
        );
        if (saved.length === 1) {
            return {
                revision: saved[0].revision,
                updatedAt: saved[0].updated_at,
            };
        }

        const current: Array<{ revision: number; updated_at: Date }> =
            await this.dataSource.query(
                `SELECT "revision", "updated_at" FROM "project"
                 WHERE "id" = $1 AND "owner_user_id" = $2`,
                [projectId, ownerId],
            );
        if (current.length === 0) throw this.notFound();
        throw new ConflictException({
            statusCode: 409,
            code: "revision-conflict",
            message:
                "Проект изменён в другой вкладке или на другом устройстве.",
            currentRevision: current[0].revision,
            updatedAt: current[0].updated_at,
        });
    }

    /** Renaming is metadata: it does not bump the document revision. */
    async rename(
        ownerId: number,
        projectId: string,
        name: string,
    ): Promise<ProjectListItem> {
        const result: unknown = await this.dataSource.query(
            `UPDATE "project" SET "name" = $1, "updated_at" = now()
             WHERE "id" = $2 AND "owner_user_id" = $3
             RETURNING ${LIST_COLUMNS}`,
            [name, projectId, ownerId],
        );
        const rows = mutationRows<ProjectRow>(result);
        if (rows.length === 0) throw this.notFound();
        return this.toListItem(rows[0]);
    }

    async duplicate(
        ownerId: number,
        projectId: string,
    ): Promise<ProjectDetail> {
        const source = await this.get(ownerId, projectId);
        const name =
            source.name.slice(0, 80 - COPY_SUFFIX.length) + COPY_SUFFIX;
        return this.dataSource.transaction((manager) =>
            this.insertWithinLimit(manager, ownerId, {
                name,
                document: source.document,
                summary: source.summary,
                clientImportId: null,
            }),
        );
    }

    async remove(ownerId: number, projectId: string): Promise<void> {
        const result: unknown = await this.dataSource.query(
            `DELETE FROM "project" WHERE "id" = $1 AND "owner_user_id" = $2`,
            [projectId, ownerId],
        );
        if (mutationCount(result) === 0) throw this.notFound();
    }

    private async insertWithinLimit(
        manager: EntityManager,
        ownerId: number,
        input: {
            name?: string;
            document: Record<string, unknown>;
            summary: ProjectSummary;
            clientImportId: string | null;
        },
    ): Promise<ProjectDetail> {
        // Serialises this user's creations, so parallel requests cannot
        // slip past the limit between the count and the insert.
        await manager.query(
            `SELECT "id" FROM "user" WHERE "id" = $1 FOR UPDATE`,
            [ownerId],
        );
        const [{ count }]: Array<{ count: number }> = await manager.query(
            `SELECT COUNT(*)::int AS "count" FROM "project" WHERE "owner_user_id" = $1`,
            [ownerId],
        );
        if (count >= MAX_PROJECTS_PER_USER) {
            throw new ConflictException({
                statusCode: 409,
                code: "project-limit",
                message: `Можно хранить до ${MAX_PROJECTS_PER_USER} проектов. Удалите ненужные, чтобы создать новый.`,
            });
        }

        const rows: ProjectRow[] = await manager.query(
            `INSERT INTO "project"
                ("owner_user_id", "name", "document", "document_version", "summary", "client_import_id")
             VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6)
             RETURNING ${LIST_COLUMNS}, "document"`,
            [
                ownerId,
                input.name ?? `Проект ${count + 1}`,
                JSON.stringify(input.document),
                input.document.version,
                JSON.stringify(input.summary),
                input.clientImportId,
            ],
        );
        return this.toDetail(rows[0]);
    }

    private async findImport(
        ownerId: number,
        clientImportId: string,
    ): Promise<ProjectDetail | null> {
        const rows: ProjectRow[] = await this.dataSource.query(
            `SELECT ${LIST_COLUMNS}, "document" FROM "project"
             WHERE "owner_user_id" = $1 AND "client_import_id" = $2`,
            [ownerId, clientImportId],
        );
        return rows.length === 1 ? this.toDetail(rows[0]) : null;
    }

    private toListItem(row: ProjectRow): ProjectListItem {
        return {
            id: row.id,
            name: row.name,
            summary: row.summary ?? {},
            documentVersion: row.document_version,
            revision: row.revision,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private toDetail(row: ProjectRow): ProjectDetail {
        return { ...this.toListItem(row), document: row.document ?? {} };
    }

    private notFound(): NotFoundException {
        return new NotFoundException("Проект не найден");
    }

    private isUniqueViolation(error: unknown): boolean {
        if (!(error instanceof QueryFailedError)) return false;
        return (error.driverError as { code?: string }).code === "23505";
    }
}
