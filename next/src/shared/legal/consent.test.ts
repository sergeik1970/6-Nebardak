import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_CONSENT_VERSION } from "./consent";

describe("personal-data consent edition", () => {
    it("matches the edition the API accepts, or every sign-up would fail", () => {
        const backend = readFileSync(
            resolve(__dirname, "../../../../nest/src/legal/consent.ts"),
            "utf8",
        );

        expect(backend).toContain(`CURRENT_CONSENT_VERSION = "${CURRENT_CONSENT_VERSION}"`);
    });
});
