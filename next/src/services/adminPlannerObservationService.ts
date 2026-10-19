import { AUTH_API_URL, isAuthEnabled } from "@/shared/config/runtime";
import { authService } from "./authService";

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

const UNAVAILABLE_MESSAGE = "Войдите с учётной записью администратора, чтобы открыть очередь.";

const readErrorMessage = async (response: Response): Promise<string> => {
    try {
        const payload = (await response.json()) as { message?: unknown };
        if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    } catch {
        // An intermediary can return a non-JSON error page. Keep the safe message below.
    }

    return "Не удалось загрузить очередь расстановок.";
};

const getApiUrl = (): string => {
    if (!isAuthEnabled || !AUTH_API_URL) throw new Error(UNAVAILABLE_MESSAGE);
    return AUTH_API_URL;
};

const getHeaders = (): Record<string, string> => {
    const token = authService.getToken();
    if (!token) throw new Error(UNAVAILABLE_MESSAGE);

    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
};

const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await fetch(`${getApiUrl()}${path}`, {
        ...init,
        headers: getHeaders(),
    });

    if (!response.ok) throw new Error(await readErrorMessage(response));
    return response.json() as Promise<T>;
};

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
            body: JSON.stringify({ status }),
        }),
};
