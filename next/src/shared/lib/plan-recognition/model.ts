/**
 * What the model is asked, and how it is asked. Requests go through the AI
 * relay (`infra/ai-relay`) on the server outside Russia, which holds the
 * provider key; this side only knows the relay's address and token. The
 * product does not call this.
 */
export const PLAN_READING_PROMPT = `You read a measured floor plan of ONE room and return its geometry as JSON.

The drawing shows thick walls, window openings (thin parallel lines inside a gap in the wall), door openings (a gap with a door leaf and a dashed swing arc), and dimension chains outside the walls. Dimension numbers are in millimetres. Use the numbers on the drawing, not pixel measurements.

Return only JSON of this shape:
{
  "contour": [{"x": number, "y": number}, ...],
  "openings": [{"kind": "door" | "window", "wall": number, "offset": number, "width": number}, ...]
}

Rules:
- contour: the inner face of the walls, corners in order around the room, in millimetres. Put the top-left corner at x=0, y=0; x grows to the right and y grows downwards, as on the drawing.
- wall: the index of the contour edge holding the opening; edge i runs from contour[i] to contour[i+1] (the last edge closes back to contour[0]).
- offset: the distance in millimetres along that edge from contour[wall] to the nearer end of the opening.
- width: the opening's width in millimetres.
- List every door and every window. No other keys, no comments.`;

export interface ModelSettings {
    /** The relay, usually through an SSH tunnel: http://127.0.0.1:8790. */
    relayUrl: string;
    relayToken: string;
}

/** Reads `KEY=value` lines from a file's text, e.g. ~/.stylefinder-ai.env. */
export const parseEnvFile = (text: string): Record<string, string> =>
    Object.fromEntries(
        text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#") && line.includes("="))
            .map((line) => {
                const at = line.indexOf("=");
                return [
                    line.slice(0, at).trim(),
                    line
                        .slice(at + 1)
                        .trim()
                        .replace(/^["']|["']$/g, ""),
                ];
            }),
    );

export const modelSettingsFrom = (env: Record<string, string | undefined>): ModelSettings | null =>
    env.AI_RELAY_TOKEN
        ? {
              relayUrl: (env.AI_RELAY_URL || "http://127.0.0.1:8790").replace(/\/$/, ""),
              relayToken: env.AI_RELAY_TOKEN,
          }
        : null;

/** Strips a ```json fence some models wrap their answer in. */
export const answerJson = (text: string): unknown => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse((fenced ? fenced[1] : text).trim());
};

/** The relay's provider and model, or why it cannot be reached. */
export const relayStatus = async (
    settings: ModelSettings,
): Promise<{ provider: string | null; model: string | null } | { error: string }> => {
    try {
        const response = await fetch(`${settings.relayUrl}/health`, {
            signal: AbortSignal.timeout(5_000),
        });
        return (await response.json()) as { provider: string | null; model: string | null };
    } catch {
        return {
            error: `Посредник ${settings.relayUrl} не отвечает. Откройте туннель: ssh -fN -L 8790:127.0.0.1:8790 root@89.208.107.138`,
        };
    }
};

/** Tokens and US dollars for one request; cost is null when the provider gives no price. */
export interface ModelUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cost: number | null;
}

/** Asks the model about one PNG image (a room by default); returns its raw text answer and what it cost. */
export const askModel = async (
    settings: ModelSettings,
    pngBase64: string,
    prompt = PLAN_READING_PROMPT,
    /** One of the relay's allowed models; its default when left out. */
    model?: string,
): Promise<{ text: string; usage: ModelUsage | null }> => {
    const response = await fetch(`${settings.relayUrl}/v1/vision`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${settings.relayToken}`,
        },
        body: JSON.stringify({
            prompt,
            ...(model ? { model } : {}),
            image: { mimeType: "image/png", base64: pngBase64 },
            json: true,
        }),
        signal: AbortSignal.timeout(330_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
        usage?: ModelUsage;
    };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return { text: body.text ?? "", usage: body.usage ?? null };
};

/** The relay's running totals: requests, tokens and dollars this month and overall. */
export const relayUsage = async (settings: ModelSettings) => {
    const response = await fetch(`${settings.relayUrl}/v1/usage`, {
        headers: { authorization: `Bearer ${settings.relayToken}` },
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<
        "month" | "total",
        {
            requests: number;
            inputTokens: number;
            outputTokens: number;
            cost: number;
            unpriced: number;
        }
    >;
};
