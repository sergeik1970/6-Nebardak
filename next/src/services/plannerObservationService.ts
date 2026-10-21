import { apiRequest } from "./apiClient";

export type PlannerObservationVerdict = "good" | "questionable" | "needs-fix";

export interface PlannerObservationCreateInput {
    clientObservationId: string;
    inputSnapshot: Record<string, unknown>;
    layoutSnapshot: Record<string, unknown>;
    inputFingerprint: string;
    layoutFingerprint: string;
    algorithmVersion: string;
    catalogVersion: string;
    solverStatus: string;
}

export interface PlannerObservationReview {
    verdict: PlannerObservationVerdict;
    comment: string;
    reviewedAt: string;
}

export interface PlannerObservationResponse {
    id: number;
    clientObservationId: string;
    review: PlannerObservationReview | null;
    createdAt: string;
    updatedAt: string;
}

const request = <T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> =>
    apiRequest<T>(path, {
        method,
        body,
        fallbackMessage: "Не удалось сохранить наблюдение в базе данных.",
    });

export const plannerObservationService = {
    create: (input: PlannerObservationCreateInput): Promise<PlannerObservationResponse> =>
        request<PlannerObservationResponse>("/planner-observations", "POST", input),

    saveReview: (
        observationId: number,
        review: Pick<PlannerObservationReview, "verdict" | "comment">,
    ): Promise<PlannerObservationResponse> =>
        request<PlannerObservationResponse>(
            `/planner-observations/${observationId}/review`,
            "PATCH",
            review,
        ),
};
