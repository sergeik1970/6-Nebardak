import type { ProjectSummary } from "@/shared/lib/project-scope/document";
import { apiRequest } from "./apiClient";

export interface ProjectListItem {
    id: string;
    name: string;
    summary: ProjectSummary;
    documentVersion: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectDetail extends ProjectListItem {
    document: Record<string, unknown>;
}

export interface SavedRevision {
    revision: number;
    updatedAt: string;
}

export interface CreateProjectInput {
    name?: string;
    document: unknown;
    summary?: ProjectSummary;
    clientImportId?: string;
}

/** The subset of the API the sync engine needs; tests replace it. */
export interface ProjectsApi {
    get(projectId: string): Promise<ProjectDetail>;
    create(input: CreateProjectInput): Promise<ProjectDetail>;
    saveDocument(
        projectId: string,
        input: { document: unknown; baseRevision: number; summary?: ProjectSummary },
        options?: { keepalive?: boolean; signal?: AbortSignal },
    ): Promise<SavedRevision>;
}

const path = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

export const projectsService: ProjectsApi & {
    list(): Promise<{ projects: ProjectListItem[]; limit: number }>;
    rename(projectId: string, name: string): Promise<ProjectListItem>;
    duplicate(projectId: string): Promise<ProjectDetail>;
    remove(projectId: string): Promise<void>;
} = {
    list: () =>
        apiRequest<{ projects: ProjectListItem[]; limit: number }>("/projects", {
            fallbackMessage: "Не удалось загрузить проекты",
        }),

    get: async (projectId) =>
        (
            await apiRequest<{ project: ProjectDetail }>(path(projectId), {
                fallbackMessage: "Не удалось открыть проект",
            })
        ).project,

    create: async (input) =>
        (
            await apiRequest<{ project: ProjectDetail }>("/projects", {
                method: "POST",
                body: input,
                fallbackMessage: "Не удалось создать проект",
            })
        ).project,

    saveDocument: (projectId, input, options = {}) =>
        apiRequest<SavedRevision>(`${path(projectId)}/document`, {
            method: "PUT",
            body: input,
            keepalive: options.keepalive,
            signal: options.signal,
            fallbackMessage: "Не удалось сохранить проект",
        }),

    rename: async (projectId, name) =>
        (
            await apiRequest<{ project: ProjectListItem }>(path(projectId), {
                method: "PATCH",
                body: { name },
                fallbackMessage: "Не удалось переименовать проект",
            })
        ).project,

    duplicate: async (projectId) =>
        (
            await apiRequest<{ project: ProjectDetail }>(`${path(projectId)}/duplicate`, {
                method: "POST",
                fallbackMessage: "Не удалось скопировать проект",
            })
        ).project,

    remove: (projectId) =>
        apiRequest<void>(path(projectId), {
            method: "DELETE",
            fallbackMessage: "Не удалось удалить проект",
        }),
};
