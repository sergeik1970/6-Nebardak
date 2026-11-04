import assert from "node:assert/strict";
import { test } from "node:test";
import { providerFrom } from "../src/providers.js";
import { createRelay } from "../src/server.js";

const TOKEN = "t".repeat(40);
const IMAGE = { mimeType: "image/png", base64: "iVBORw0KGgo=" };

const start = async (options) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return (
            options.reply?.(url) ??
            new Response(
                JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }),
                { status: 200 },
            )
        );
    };
    const server = createRelay({ token: TOKEN, fetchImpl, log: () => {}, ...options });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const ask = (body, token = TOKEN) =>
        fetch(`${base}/v1/vision`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
    return { base, ask, calls, close: () => new Promise((resolve) => server.close(resolve)) };
};

const gemini = providerFrom({ AI_API_KEY: "secret-key", AI_MODEL: "gemini-2.5-pro" });

test("picks the provider from the model name unless told", () => {
    assert.equal(gemini.kind, "gemini");
    assert.equal(providerFrom({ AI_API_KEY: "k", AI_MODEL: "gpt-5" }).kind, "openai");
    assert.equal(
        providerFrom({
            AI_API_KEY: "k",
            AI_MODEL: "m",
            AI_PROVIDER: "openai",
            AI_API_URL: "https://x/v1/",
        }).apiUrl,
        "https://x/v1",
    );
    assert.equal(providerFrom({ AI_MODEL: "gemini-2.5-pro" }), null);
});

test("asks Gemini with the key in a header and returns the text", async () => {
    const relay = await start({ provider: gemini });
    try {
        const response = await relay.ask({ prompt: "read", image: IMAGE, json: true });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.text, '{"a":1}');
        assert.equal(body.model, "gemini-2.5-pro");
        assert.equal(relay.calls.length, 1);
        assert.match(relay.calls[0].url, /models\/gemini-2\.5-pro:generateContent$/);
        assert.equal(relay.calls[0].init.headers["x-goog-api-key"], "secret-key");
        assert.equal(relay.calls[0].body.generationConfig.responseMimeType, "application/json");
        assert.equal(relay.calls[0].body.contents[0].parts[1].inline_data.data, IMAGE.base64);
    } finally {
        await relay.close();
    }
});

test("speaks the OpenAI-compatible chat API", async () => {
    const relay = await start({
        provider: providerFrom({ AI_API_KEY: "k", AI_MODEL: "gpt-5" }),
        reply: () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    });
    try {
        const body = await (await relay.ask({ prompt: "read", image: IMAGE })).json();
        assert.equal(body.text, "ok");
        assert.match(relay.calls[0].url, /\/chat\/completions$/);
        assert.equal(relay.calls[0].init.headers.authorization, "Bearer k");
        assert.equal(
            relay.calls[0].body.messages[0].content[1].image_url.url,
            `data:image/png;base64,${IMAGE.base64}`,
        );
    } finally {
        await relay.close();
    }
});

test("refuses a wrong token, a bad body and other paths without calling the provider", async () => {
    const relay = await start({ provider: gemini });
    try {
        assert.equal((await relay.ask({ prompt: "x", image: IMAGE }, "wrong")).status, 401);
        assert.equal((await relay.ask({ prompt: "", image: IMAGE })).status, 400);
        assert.equal(
            (await relay.ask({ prompt: "x", image: { mimeType: "image/gif", base64: "AA==" } }))
                .status,
            400,
        );
        assert.equal((await fetch(`${relay.base}/v1/other`)).status, 404);
        const health = await (await fetch(`${relay.base}/health`)).json();
        assert.deepEqual(health, { ok: true, provider: "gemini", model: "gemini-2.5-pro" });
        assert.equal(relay.calls.length, 0);
    } finally {
        await relay.close();
    }
});

test("stops at the daily limit and starts again the next day", async () => {
    let date = new Date("2026-11-04T10:00:00Z");
    const relay = await start({ provider: gemini, dailyLimit: 2, now: () => date });
    try {
        assert.equal((await relay.ask({ prompt: "x", image: IMAGE })).status, 200);
        assert.equal((await relay.ask({ prompt: "x", image: IMAGE })).status, 200);
        assert.equal((await relay.ask({ prompt: "x", image: IMAGE })).status, 429);
        date = new Date("2026-11-05T00:01:00Z");
        assert.equal((await relay.ask({ prompt: "x", image: IMAGE })).status, 200);
    } finally {
        await relay.close();
    }
});

test("reports a provider error without leaking the key", async () => {
    const relay = await start({
        provider: gemini,
        reply: () =>
            new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }),
    });
    try {
        const response = await relay.ask({ prompt: "x", image: IMAGE });
        assert.equal(response.status, 502);
        const text = await response.text();
        assert.match(text, /quota exceeded/);
        assert.doesNotMatch(text, /secret-key/);
    } finally {
        await relay.close();
    }
});

test("answers 503 until the key is set", async () => {
    const relay = await start({ provider: null });
    try {
        assert.equal((await relay.ask({ prompt: "x", image: IMAGE })).status, 503);
    } finally {
        await relay.close();
    }
});
