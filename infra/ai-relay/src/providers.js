// One request shape in, one text answer out. The provider, model and key come
// from the relay's own environment; callers never see or choose them.

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_URL = "https://api.openai.com/v1";

export const providerFrom = (env) => {
    const apiKey = env.AI_API_KEY;
    const model = env.AI_MODEL;
    if (!apiKey || !model) return null;
    const kind =
        env.AI_PROVIDER === "gemini" || env.AI_PROVIDER === "openai"
            ? env.AI_PROVIDER
            : model.startsWith("gemini")
              ? "gemini"
              : "openai";
    return {
        kind,
        model,
        apiKey,
        apiUrl: (env.AI_API_URL || (kind === "gemini" ? GEMINI_URL : OPENAI_URL)).replace(
            /\/$/,
            "",
        ),
    };
};

/** The provider's error text, never the request (which carries the key in a header only). */
const failure = (status, body) =>
    new Error(`provider HTTP ${status}: ${body?.error?.message ?? "no message"}`.slice(0, 500));

/**
 * Asks the configured model one question about one image.
 * `request`: { prompt, image: { mimeType, base64 }, json }.
 */
export const askProvider = async (provider, request, { fetchImpl = fetch, timeoutMs } = {}) => {
    const signal = AbortSignal.timeout(timeoutMs);
    if (provider.kind === "gemini") {
        const response = await fetchImpl(
            `${provider.apiUrl}/models/${encodeURIComponent(provider.model)}:generateContent`,
            {
                method: "POST",
                signal,
                headers: { "content-type": "application/json", "x-goog-api-key": provider.apiKey },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: request.prompt },
                                {
                                    inline_data: {
                                        mime_type: request.image.mimeType,
                                        data: request.image.base64,
                                    },
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 0,
                        ...(request.json ? { responseMimeType: "application/json" } : {}),
                    },
                }),
            },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) throw failure(response.status, body);
        const usage = body?.usageMetadata ?? {};
        return {
            text: (body?.candidates?.[0]?.content?.parts ?? [])
                .map((part) => part.text ?? "")
                .join(""),
            usage: {
                inputTokens: usage.promptTokenCount ?? 0,
                // Gemini bills thinking as output.
                outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
                reasoningTokens: usage.thoughtsTokenCount ?? 0,
                cost: null,
            },
        };
    }
    const response = await fetchImpl(`${provider.apiUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
            model: provider.model,
            ...(request.json ? { response_format: { type: "json_object" } } : {}),
            // OpenRouter then reports the request's price in usage.cost.
            ...(provider.apiUrl.includes("openrouter.ai") ? { usage: { include: true } } : {}),
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: request.prompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${request.image.mimeType};base64,${request.image.base64}`,
                            },
                        },
                    ],
                },
            ],
        }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw failure(response.status, body);
    const usage = body?.usage ?? {};
    return {
        text: body?.choices?.[0]?.message?.content ?? "",
        usage: {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
            cost: typeof usage.cost === "number" ? usage.cost : null,
        },
    };
};

/**
 * The price of one request in US dollars: the provider's own figure when it
 * gives one (OpenRouter), otherwise from AI_PRICE_*_PER_M if set, else null.
 */
export const priceOf = (usage, prices) => {
    if (usage.cost !== null) return usage.cost;
    if (!prices) return null;
    return (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1_000_000;
};
