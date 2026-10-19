import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BetaBadge from ".";

describe("BetaBadge", () => {
    it("renders nothing when the public beta status is disabled", () => {
        expect(renderToStaticMarkup(<BetaBadge enabled={false} />)).toBe("");
    });

    it("renders an honest status label when enabled", () => {
        const markup = renderToStaticMarkup(<BetaBadge enabled />);

        expect(markup).toContain("Бета");
        expect(markup).toContain("Бета-версия сайта");
    });
});
