import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RemovalConfirmationDialog from "./RemovalConfirmationDialog";

describe("RemovalConfirmationDialog", () => {
    it("renders an explicitly labelled modal confirmation", () => {
        const html = renderToStaticMarkup(
            <RemovalConfirmationDialog
                open
                itemName="Кофейный столик"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('aria-labelledby="manual-removal-title"');
        expect(html).toContain("Кофейный столик");
        expect(html).toContain("«Отменить» над планом");
        expect(html).toContain("Ctrl/Cmd + Z");
    });

    it("renders nothing while closed", () => {
        expect(
            renderToStaticMarkup(
                <RemovalConfirmationDialog
                    open={false}
                    itemName="Кофейный столик"
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                />,
            ),
        ).toBe("");
    });
});
