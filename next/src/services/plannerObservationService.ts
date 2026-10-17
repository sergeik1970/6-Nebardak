import { AUTH_API_URL, isAuthEnabled } from "@/shared/config/runtime";
import { authService } from "./authService";

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

const UNAVAILABLE_MESSAGE = "Войдите, чтобы сохранить наблюдение в базе данных.";

const readErrorMessage = async (response: Response): Promise<string> => {
    try {
        const payload = (await response.json()) as { message?: unknown };
        if (typeof payload.message === "string" && payload.message.trim()) {
            return payload.message;
        }
    } catch {
        // Keep the safe generic message below when an intermediary returns HTML.
    }

    return "Не удалось сохранить наблюдение в базе данных.";
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

const request = async <T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> => {
    const response = await fetch(`${getApiUrl()}${path}`, {
        method,
        headers: getHeaders(),
        body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(await readErrorMessage(response));
    return response.json() as Promise<T>;
};

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
