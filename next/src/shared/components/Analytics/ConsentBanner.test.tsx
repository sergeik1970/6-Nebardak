import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConsentBanner from "./ConsentBanner";

describe("ConsentBanner", () => {
    it("offers both choices with equal weight and links to the policy", () => {
        const markup = renderToStaticMarkup(<ConsentBanner onChoice={() => undefined} />);

        expect(markup).toContain("Яндекс Метрику");
        expect(markup).toContain("Разрешить");
        expect(markup).toContain("Отказаться");
        expect(markup).toContain('href="/privacy#cookies"');
    });
});
