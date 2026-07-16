import type { FurnitureAssetKey, Rotation, Wall } from "./types";

export interface FurnitureAssetDefinition {
    src: string;
    /** Clockwise correction from the supplied source to the catalogue's 0° geometry. */
    baseRotation: Rotation;
    /** The normalized edge that faces the wall when a placement is at 0°. */
    backEdge: Wall;
    /** Desk uses its photograph only for the tabletop; the chair stays schematic. */
    bodyRectIndex?: number;
}

const asset = (
    key: FurnitureAssetKey,
    baseRotation: Rotation = 0,
    options: Pick<FurnitureAssetDefinition, "bodyRectIndex"> = {},
): FurnitureAssetDefinition => ({
    src: `/images/planner/${key}.webp`,
    baseRotation,
    backEdge: "top",
    ...options,
});

export const FURNITURE_ASSETS: Record<FurnitureAssetKey, FurnitureAssetDefinition> = {
    "single-bed": asset("single-bed"),
    "double-bed": asset("double-bed"),
    cradle: asset("cradle"),
    bookcase: asset("bookcase", 90),
    "wardrobe-small": asset("wardrobe-small", 90),
    "wardrobe-medium": asset("wardrobe-medium", 90),
    "wardrobe-large": asset("wardrobe-large", 90),
    desk: asset("desk", 0, { bodyRectIndex: 0 }),
    "bedside-table": asset("bedside-table"),
    dresser: asset("dresser", 90),
    "coffee-table": asset("coffee-table"),
    tv: asset("tv"),
    "sofa-two": asset("sofa-two", 90),
    "sofa-three": asset("sofa-three"),
    "sofa-four-left": asset("sofa-four-left"),
};

export const isFurnitureAssetKey = (value: string): value is FurnitureAssetKey =>
    Object.prototype.hasOwnProperty.call(FURNITURE_ASSETS, value);

export const getFurnitureAsset = (assetKey: string): FurnitureAssetDefinition | undefined =>
    isFurnitureAssetKey(assetKey) ? FURNITURE_ASSETS[assetKey] : undefined;
