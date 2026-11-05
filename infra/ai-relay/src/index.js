import { providerFrom } from "./providers.js";
import { createRelay } from "./server.js";
import { UsageBook } from "./usage.js";

const env = process.env;
const number = (value, fallback) =>
    Number.isFinite(Number(value)) && value !== "" && value !== undefined
        ? Number(value)
        : fallback;

if (!env.RELAY_TOKEN || env.RELAY_TOKEN.length < 32) {
    console.error("RELAY_TOKEN must be set to at least 32 characters");
    process.exit(1);
}
const provider = providerFrom(env);
if (!provider) console.error("AI_API_KEY or AI_MODEL is not set: /v1/vision answers 503");

const prices =
    env.AI_PRICE_INPUT_PER_M && env.AI_PRICE_OUTPUT_PER_M
        ? {
              input: number(env.AI_PRICE_INPUT_PER_M, 0),
              output: number(env.AI_PRICE_OUTPUT_PER_M, 0),
          }
        : null;

const port = number(env.PORT, 8790);
createRelay({
    token: env.RELAY_TOKEN,
    provider,
    models: (env.AI_MODELS ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean),
    dailyLimit: number(env.RELAY_DAILY_LIMIT, 300),
    timeoutMs: number(env.RELAY_TIMEOUT_SECONDS, 300) * 1000,
    prices,
    usage: new UsageBook(env.RELAY_USAGE_FILE || null),
}).listen(port, "0.0.0.0", () => {
    console.log(
        `ai-relay on :${port}, ${provider ? `${provider.kind} ${provider.model}` : "no provider"}`,
    );
});
