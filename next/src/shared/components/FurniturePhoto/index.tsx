import React from "react";
import type { FurniturePhoto as Photo } from "@/shared/lib/furniture-planner/furniture-photos";

/** Frame supplied exports at their alpha bounds without changing the source artwork. */
export default function FurniturePhoto({ photo, fit = false }: { photo: Photo; fit?: boolean }) {
    const { bounds, rotation } = photo;
    const swap = rotation % 180 !== 0;
    const width = swap ? bounds.height : bounds.width;
    const height = swap ? bounds.width : bounds.height;
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height="100%"
            preserveAspectRatio={fit ? "xMidYMid meet" : "none"}
            aria-hidden="true"
            style={{ display: "block", pointerEvents: "none" }}
        >
            <g transform={`translate(${width / 2} ${height / 2}) rotate(${rotation})`}>
                <svg
                    x={-bounds.width / 2}
                    y={-bounds.height / 2}
                    width={bounds.width}
                    height={bounds.height}
                    viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
                    overflow="hidden"
                >
                    <image href={photo.src} width={photo.width} height={photo.height} />
                </svg>
            </g>
        </svg>
    );
}
