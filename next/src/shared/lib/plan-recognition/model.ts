/**
 * What the model is asked, and how it is asked. Two request shapes cover the
 * candidates: Gemini's generateContent and the OpenAI-compatible chat API
 * (which Yandex AI Studio and others also speak). The key never leaves the
 * machine running the measurement; the product does not call this.
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
    provider: "gemini" | "openai";
    apiKey: string;
    model: string;
    /** For OpenAI-compatible services other than OpenAI itself. */
    apiUrl?: string;
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

export const modelSettingsFrom = (
    env: Record<string, string | undefined>,
): ModelSettings | null => {
    const apiKey = env.AI_API_KEY;
    const model = env.AI_MODEL;
    if (!apiKey || !model) return null;
    const provider =
        env.AI_PROVIDER === "gemini" || env.AI_PROVIDER === "openai"
            ? env.AI_PROVIDER
            : model.startsWith("gemini")
              ? "gemini"
              : "openai";
    return { provider, apiKey, model, ...(env.AI_API_URL ? { apiUrl: env.AI_API_URL } : {}) };
};

/** Strips a ```json fence some models wrap their answer in. */
export const answerJson = (text: string): unknown => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse((fenced ? fenced[1] : text).trim());
};

/** Asks the model about one PNG image; returns its raw text answer. */
export const askModel = async (settings: ModelSettings, pngBase64: string): Promise<string> => {
    if (settings.provider === "gemini") {
        const url = `${settings.apiUrl ?? "https://generativelanguage.googleapis.com/v1beta"}/models/${settings.model}:generateContent`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": settings.apiKey },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: PLAN_READING_PROMPT },
                            { inline_data: { mime_type: "image/png", data: pngBase64 } },
                        ],
                    },
                ],
                generationConfig: { responseMimeType: "application/json", temperature: 0 },
            }),
        });
        const body = (await response.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
        return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    }
    const url = `${settings.apiUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
            model: settings.model,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: PLAN_READING_PROMPT },
                        {
                            type: "image_url",
                            image_url: { url: `data:image/png;base64,${pngBase64}` },
                        },
                    ],
                },
            ],
        }),
    });
    const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    return body.choices?.[0]?.message?.content ?? "";
};
