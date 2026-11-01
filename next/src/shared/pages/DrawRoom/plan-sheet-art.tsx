import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanSpecificationItem } from "@/shared/lib/furniture-planner";
import { furnitureGeometry } from "./furniture";
import FurnitureSymbol from "./FurnitureSymbol";

/**
 * The plan symbols as SVG text for the drawing sheets. A sheet is rendered as
 * an image, which cannot load anything else, so designer pictures go in as
 * data URLs. Loaded on demand: the server renderer is not needed until then.
 */

const toDataUrl = async (src: string) => {
    const blob = await (await fetch(src)).blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось загрузить изображение мебели."));
        reader.readAsDataURL(blob);
    });
};

const symbolMarkup = (item: PlanSpecificationItem) => {
    const turned = item.rotation === 90 || item.rotation === 270;
    const geometry = furnitureGeometry({
        id: item.instanceId,
        definitionId: item.definitionId,
        x: 0,
        y: 0,
        width: turned ? item.depth : item.width,
        depth: turned ? item.width : item.depth,
        rotation: 0,
    });
    return renderToStaticMarkup(
        <FurnitureSymbol
            definitionId={item.definitionId}
            rects={geometry.bodyRects}
            width={geometry.width}
            depth={geometry.depth}
        />,
    ).replace(/data-symbol-hit=""/g, 'stroke="none"'); // Editor hit areas, invisible on the page.
};

export const buildFurnitureArt = async (items: PlanSpecificationItem[]) => {
    const markup = new Map(items.map((item) => [item.instanceId, symbolMarkup(item)]));
    const sources = new Set(
        Array.from(markup.values()).flatMap((svg) =>
            Array.from(svg.matchAll(/href="(\/[^"]+)"/g), (match) => match[1]),
        ),
    );
    const inlined = new Map(
        await Promise.all(Array.from(sources, async (src) => [src, await toDataUrl(src)] as const)),
    );
    return (item: PlanSpecificationItem) =>
        markup
            .get(item.instanceId)
            ?.replace(/href="(\/[^"]+)"/g, (_, src: string) => `href="${inlined.get(src)}"`) ??
        null;
};
