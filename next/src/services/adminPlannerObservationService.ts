import { apiRequest } from "./apiClient";

export type AdminPlannerObservationTriageStatus = "new" | "in-progress" | "resolved" | "dismissed";

export type AdminPlannerObservationVerdict = "good" | "questionable" | "needs-fix";

export type AdminPlannerObservationTriageFilter = AdminPlannerObservationTriageStatus | "all";

export type AdminPlannerObservationReviewFilter =
    | "unreviewed"
    | AdminPlannerObservationVerdict
    | "all";

export interface AdminPlannerRoom {
    width: number;
    depth: number;
}

export interface AdminPlannerItem {
    id?: string;
    instanceId?: string;
    label?: string;
    name?: string;
    x: number;
    y: number;
    width: number;
    depth: number;
    rotation?: number;
}

export interface AdminPlannerObservation {
    id: number;
    createdAt: string;
    triageStatus: AdminPlannerObservationTriageStatus;
    triagedAt: string | null;
    reviewVerdict: AdminPlannerObservationVerdict | null;
    reviewComment: string | null;
    reviewedAt: string | null;
    solverStatus: "complete" | "partial" | "failed" | string;
    algorithmVersion: string;
    catalogVersion: string;
    inputFingerprint: string;
    layoutFingerprint: string;
    inputSnapshot: Record<string, unknown>;
    layoutSnapshot: Record<string, unknown>;
    reviewer: {
        id: number;
        name: string;
    };
}

export interface AdminPlannerObservationFilters {
    status: AdminPlannerObservationTriageFilter;
    review: AdminPlannerObservationReviewFilter;
}

interface AdminPlannerObservationListResponse {
    observations?: unknown;
}

const request = <T>(path: string, init: { method: "GET" | "PATCH"; body?: unknown }): Promise<T> =>
    apiRequest<T>(path, {
        ...init,
        fallbackMessage: "Не удалось загрузить очередь расстановок.",
    });

export const adminPlannerObservationService = {
    list: (filters: AdminPlannerObservationFilters): Promise<AdminPlannerObservation[]> => {
        const searchParams = new URLSearchParams();
        if (filters.status !== "all") searchParams.set("status", filters.status);
        if (filters.review !== "all") searchParams.set("review", filters.review);
        const query = searchParams.size > 0 ? `?${searchParams.toString()}` : "";

        return request<AdminPlannerObservationListResponse>(`/admin/planner-observations${query}`, {
            method: "GET",
        }).then((response) =>
            Array.isArray(response.observations)
                ? (response.observations as AdminPlannerObservation[])
                : [],
        );
    },

    updateTriage: (
        observationId: number,
        status: AdminPlannerObservationTriageStatus,
    ): Promise<AdminPlannerObservation> =>
        request<AdminPlannerObservation>(`/admin/planner-observations/${observationId}/triage`, {
            method: "PATCH",
            body: { status },
        }),
};
