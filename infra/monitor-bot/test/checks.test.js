import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHttp } from "../src/checks.js";
import { Outbox } from "../src/telegram.js";

const respond = (status, body) => async () => new Response(body, { status });

test("passes on the expected status and body", async () => {
    const target = { url: "https://example.test/ready", contains: '"ok"' };
    const result = await checkHttp(target, 1000, respond(200, '{"status":"ok"}'));
    assert.equal(result.ok, true);
    assert.match(result.detail, /^HTTP 200, \d+ мс$/);
});

test("fails on another status or a missing keyword", async () => {
    const target = { url: "https://example.test/ready", contains: '"ok"' };
    assert.deepEqual(await checkHttp(target, 1000, respond(503, "")), {
        ok: false,
        detail: "HTTP 503, ожидался 200",
    });
    assert.deepEqual(await checkHttp(target, 1000, respond(200, '{"status":"degraded"}')), {
        ok: false,
        detail: 'в ответе нет «"ok"»',
    });
});

test("reports network errors and timeouts", async () => {
    const refused = async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    };
    assert.equal((await checkHttp({ url: "x" }, 1000, refused)).detail, "ECONNREFUSED");

    const slow = async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    assert.equal((await checkHttp({ url: "x" }, 10_000, slow)).detail, "нет ответа за 10 с");
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
