import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG, getRotatedGeometry } from "@/shared/lib/furniture-planner";
import FurnitureSymbol from "./FurnitureSymbol";

const shapes = (definitionId: string) => {
    const definition = FURNITURE_CATALOG.find((item) => item.id === definitionId)!;
    const geometry = getRotatedGeometry(definition, 0);
    const markup = renderToStaticMarkup(
        <svg>
            <FurnitureSymbol
                definitionId={definitionId}
                rects={geometry.bodyRects}
                width={geometry.width}
                depth={geometry.depth}
            />
        </svg>,
    );
    return (markup.match(/<(rect|path|circle|ellipse|polygon)\b/g) ?? []).length;
};

describe("furniture plan symbols", () => {
    // A plain dining table is the one piece drawn as its outline alone.
    it.each(FURNITURE_CATALOG.filter((definition) => definition.id !== "dining-table"))(
        "draws $id in lines, not as a bare block",
        ({ id }) => {
            expect(shapes(id)).toBeGreaterThan(1);
        },
    );
});
