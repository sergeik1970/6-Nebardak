/**
 * Reading uploaded floor plans with an AI model. The model is reached only
 * through the AI relay (infra/ai-relay) outside Russia, which holds the
 * provider key; this server knows the relay's address and token. Off unless
 * PLAN_RECOGNITION_ENABLED=true: a plan leaves the country, which needs the
 * user's consent first.
 */
export interface PlanRecognitionConfig {
    relayUrl: string;
    relayToken: string;
    timeoutMs: number;
}

export const DEFAULT_RELAY_URL = "http://127.0.0.1:8790";
/** The relay itself gives up after five minutes; wait a little longer. */
const DEFAULT_TIMEOUT_MS = 330_000;

export function getPlanRecognitionConfig(
    env: Record<string, string | undefined> = process.env,
): PlanRecognitionConfig | null {
    if (env.PLAN_RECOGNITION_ENABLED?.trim() !== "true") return null;
    const relayToken = env.AI_RELAY_TOKEN?.trim();
    if (!relayToken || relayToken.length < 32) {
        throw new Error(
            "PLAN_RECOGNITION_ENABLED=true needs AI_RELAY_TOKEN of at least 32 characters",
        );
    }
    const relayUrl = (env.AI_RELAY_URL?.trim() || DEFAULT_RELAY_URL).replace(
        /\/$/,
        "",
    );
    if (!/^https?:\/\/[^/]+/.test(relayUrl)) {
        throw new Error("AI_RELAY_URL must be an http(s) address");
    }
    return { relayUrl, relayToken, timeoutMs: DEFAULT_TIMEOUT_MS };
}
