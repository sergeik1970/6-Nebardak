import { apiRequest } from "./apiClient";

export interface PlanReadingResponse {
    /** The model's answer; checked room by room with apartmentFromModel. */
    answer: unknown;
    model: string | null;
    ms: number;
}

/** A plan takes the model up to a few minutes; the server waits five and a half. */
const READ_TIMEOUT_MS = 360_000;

export const readPlan = async (
    image: { mimeType: string; base64: string },
    signal?: AbortSignal,
): Promise<PlanReadingResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel);
    try {
        return await apiRequest<PlanReadingResponse>("/plan-recognition", {
            method: "POST",
            body: { mimeType: image.mimeType, image: image.base64 },
            fallbackMessage: "Не удалось распознать план. Попробуйте ещё раз.",
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
    }
};
