import assert from "node:assert/strict";
import test from "node:test";

import { isValidRightsEvidence } from "./image-rights-policy.mjs";

test("accepts a stable HTTPS document or internal record id", () => {
    assert.equal(isValidRightsEvidence("https://docs.example.test/rights/STYLE-2026-17"), true);
    assert.equal(isValidRightsEvidence("record:STYLE-2026-17"), true);
});

test("rejects placeholders and non-stable evidence", () => {
    for (const candidate of [
        "x",
        "pending",
        "yes",
        "http://docs.example.test/rights/17",
        "https://docs.example.test/",
        "record:short",
        "file:///tmp/rights.txt",
        "",
    ]) {
        assert.equal(isValidRightsEvidence(candidate), false, candidate);
    }
});
