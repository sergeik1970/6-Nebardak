import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { askProvider, priceOf } from "./providers.js";
import { UsageBook } from "./usage.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const digest = (text) => createHash("sha256").update(text).digest();
const sameToken = (given, expected) => timingSafeEqual(digest(given), digest(expected));

const send = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
};

const readBody = (request, limit) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(Object.assign(new Error("too large"), { status: 413 }));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });

/** Checks a vision request; returns an error message or null. */
export const invalidRequest = (body) => {
    if (!body || typeof body !== "object") return "body must be a JSON object";
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return "prompt is required";
    if (body.prompt.length > 20_000) return "prompt is too long";
    const image = body.image;
    if (!image || typeof image !== "object") return "image is required";
    if (!IMAGE_TYPES.has(image.mimeType)) return "image.mimeType must be png, jpeg or webp";
    if (body.model !== undefined && (typeof body.model !== "string" || !body.model))
        return "model must be a non-empty string";
    if (typeof image.base64 !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(image.base64))
        return "image.base64 must be base64";
    return null;
};

/**
 * The relay: GET /health (open), POST /v1/vision (Bearer token). It keeps a
 * daily request cap and a small concurrency limit so a leaked token cannot run
 * up a large bill, and logs only sizes and timings, never prompts or images.
 */
export const createRelay = ({
    token,
    provider,
    /** Models a request may ask for instead of the default, same provider and key. */
    models = [],
    dailyLimit = 300,
    concurrency = 2,
    bodyLimit = 12 * 1024 * 1024,
    timeoutMs = 120_000,
    prices = null,
    usage = new UsageBook(),
    fetchImpl = fetch,
    now = () => new Date(),
    log = (line) => console.log(line),
}) => {
    let running = 0;

    return createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://relay");
        if (request.method === "GET" && url.pathname === "/health") {
            send(response, 200, {
                ok: true,
                provider: provider?.kind ?? null,
                model: provider?.model ?? null,
                ...(models.length ? { models } : {}),
            });
            return;
        }
        if (url.pathname !== "/v1/vision" && url.pathname !== "/v1/usage")
            return send(response, 404, { error: "not found" });

        const header = request.headers.authorization ?? "";
        const given = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!token || !given || !sameToken(given, token))
            return send(response, 401, { error: "unauthorized" });

        const today = now().toISOString().slice(0, 10);
        if (url.pathname === "/v1/usage") {
            if (request.method !== "GET") return send(response, 405, { error: "GET only" });
            return send(response, 200, usage.summary(today.slice(0, 7)));
        }
        if (request.method !== "POST") return send(response, 405, { error: "POST only" });
        if (!provider) return send(response, 503, { error: "AI_API_KEY or AI_MODEL is not set" });

        const used = usage.days[today]?.requests ?? 0;
        if (used >= dailyLimit)
            return send(response, 429, { error: `daily limit of ${dailyLimit} requests reached` });
        if (running >= concurrency) return send(response, 429, { error: "busy, retry shortly" });

        let body;
        try {
            body = JSON.parse(await readBody(request, bodyLimit));
        } catch (error) {
            return send(response, error.status ?? 400, {
                error: error.status === 413 ? "body too large" : "body is not JSON",
            });
        }
        const problem = invalidRequest(body);
        if (problem) return send(response, 400, { error: problem });
        const model = body.model ?? provider.model;
        if (model !== provider.model && !models.includes(model))
            return send(response, 400, {
                error: `model ${model} is not allowed; allowed: ${[provider.model, ...models].join(", ")}`,
            });
        const chosen = { ...provider, model };

        running += 1;
        const started = Date.now();
        try {
            const answer = await askProvider(
                chosen,
                { prompt: body.prompt, image: body.image, json: body.json === true },
                { fetchImpl, timeoutMs },
            );
            const ms = Date.now() - started;
            const cost = priceOf(answer.usage, prices);
            usage.record(today, answer.usage, cost);
            log(
                `vision ok ${chosen.model} image=${body.image.base64.length}B ${ms}ms in=${answer.usage.inputTokens} out=${answer.usage.outputTokens} cost=${cost ?? "?"} ${used + 1}/${dailyLimit}`,
            );
            send(response, 200, {
                text: answer.text,
                provider: provider.kind,
                model: chosen.model,
                ms,
                usage: { ...answer.usage, cost },
            });
        } catch (error) {
            const ms = Date.now() - started;
            usage.record(today, null, null);
            log(`vision failed ${chosen.model} ${ms}ms: ${error.message}`);
            send(response, 502, { error: error.message });
        } finally {
            running -= 1;
        }
    });
};
