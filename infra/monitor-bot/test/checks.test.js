import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHttp } from "../src/checks.js";
import { Outbox } from "../src/telegram.js";

const respond = (status, body) => async () => new Response(body, { status });
const SLOW = 3000;

test("passes on the expected status and body", async () => {
    const target = { url: "https://example.test/ready", contains: '"ok"' };
    const result = await checkHttp(target, 1000, SLOW, respond(200, '{"status":"ok"}'));
    assert.equal(result.ok, true);
    assert.equal(result.reachable, true);
    assert.match(result.detail, /^HTTP 200, \d+ мс$/);
});

test("fails on another status or a missing keyword", async () => {
    const target = { url: "https://example.test/ready", contains: '"ok"' };
    const wrongStatus = await checkHttp(target, 1000, SLOW, respond(503, ""));
    assert.equal(wrongStatus.ok, false);
    assert.equal(wrongStatus.reachable, false);
    assert.equal(wrongStatus.detail, "HTTP 503, ожидался 200");

    const degraded = await checkHttp(target, 1000, SLOW, respond(200, '{"status":"degraded"}'));
    assert.equal(degraded.ok, false);
    assert.equal(degraded.detail, 'в ответе нет «"ok"»');
});

test("a correct but slow answer is reachable yet not ok", async () => {
    const slowFetch = async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response("", { status: 200 });
    };
    const result = await checkHttp({ url: "x" }, 1000, 10, slowFetch);
    assert.equal(result.ok, false);
    assert.equal(result.reachable, true);
    assert.match(result.detail, /^медленный ответ: \d+ мс \(порог 10 мс\)$/);

    const ownLimit = await checkHttp({ url: "x", slowMs: 5000 }, 1000, 10, slowFetch);
    assert.equal(ownLimit.ok, true);
});

test("reports network errors and timeouts", async () => {
    const refused = async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    };
    const result = await checkHttp({ url: "x" }, 1000, SLOW, refused);
    assert.deepEqual(result, { ok: false, reachable: false, ms: null, detail: "ECONNREFUSED" });

    const timeout = async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    assert.equal(
        (await checkHttp({ url: "x" }, 10_000, SLOW, timeout)).detail,
        "нет ответа за 10 с",
    );
});

test("the outbox keeps undelivered messages in order", async () => {
    const sent = [];
    let online = false;
    const outbox = new Outbox(async (text) => {
        if (!online) throw new Error("offline");
        sent.push(text);
    });
    await outbox.push("one");
    await outbox.push("two");
    assert.deepEqual(sent, []);
    online = true;
    await outbox.flush();
    assert.deepEqual(sent, ["one", "two"]);
});
