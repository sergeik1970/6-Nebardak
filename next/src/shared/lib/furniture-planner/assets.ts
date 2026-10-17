import { getFurniturePhoto } from "./furniture-photos";
import type { FurnitureAssetKey, Rotation, Wall } from "./types";

export interface FurnitureAssetDefinition {
    src: string;
    /** Encoded WebP dimensions, recorded so replacements cannot silently change framing. */
    pixelSize: { width: number; height: number };
    /** Non-transparent alpha bounds in encoded-pixel coordinates. */
    contentBounds: { x: number; y: number; width: number; height: number };
    /** Encoded file size and digest protect immutable URLs from in-place replacement. */
    encodedBytes: number;
    sha256: string;
    encoding: {
        format: "webp";
        quality: 90;
        alphaQuality: 100;
        exactTransparentRgb: boolean;
    };
    /** Clockwise correction from the supplied source to the catalogue's 0° geometry. */
    baseRotation: Rotation;
    /** The normalized edge that faces the wall when a placement is at 0°. */
    backEdge: Wall;
    /** Asset-set revision; bump when an image or its crop changes. */
    version: "2026-07-17-v2" | "2026-09-14-v1";
    /** Rights were not supplied with the designer exports, so publication remains explicit. */
    license: {
        source: "designer-supplied";
        status: "unverified";
        note: string;
    };
    /** Desk uses its photograph only for the tabletop; the chair stays schematic. */
    bodyRectIndex?: number;
}

type FurnitureAssetPixelMetadata = Pick<
    FurnitureAssetDefinition,
    "pixelSize" | "contentBounds" | "encodedBytes" | "sha256"
>;

const PIXEL_METADATA: Record<FurnitureAssetKey, FurnitureAssetPixelMetadata> = {
    "bedside-table": {
        pixelSize: { width: 972, height: 1024 },
        contentBounds: { x: 7, y: 7, width: 958, height: 1010 },
        encodedBytes: 88_804,
        sha256: "3bde74d5b8ac0e5a797ce84a94bbce3ae8eb0fc7f2a2c3fa2c733a8ea47263da",
    },
    bookcase: {
        pixelSize: { width: 446, height: 1024 },
        contentBounds: { x: 4, y: 4, width: 438, height: 1016 },
        encodedBytes: 87_204,
        sha256: "474ae82a2a482702b474b4ba23e828dee4feb344291ebdb0bda4d5fe8c2d2c45",
    },
    "coffee-table": {
        pixelSize: { width: 1024, height: 1018 },
        contentBounds: { x: 5, y: 4, width: 1015, height: 1010 },
        encodedBytes: 137_814,
        sha256: "6f3044f2c5fe2fb3507ff0e92592c3cd682755c848dae1f1663b8029afa8d873",
    },
    cradle: {
        pixelSize: { width: 695, height: 1024 },
        contentBounds: { x: 4, y: 4, width: 687, height: 1016 },
        encodedBytes: 100_960,
        sha256: "82a06ce95336a3ac98c1df8cec5385590a76c6d3273c3be2369ebb7d102b095c",
    },
    desk: {
        pixelSize: { width: 1024, height: 551 },
        contentBounds: { x: 4, y: 4, width: 1016, height: 543 },
        encodedBytes: 84_386,
        sha256: "64959123ba61f675188f34b98a6909c8bc9fa733c764fe1f0d211e2c45a4bf57",
    },
    "double-bed": {
        pixelSize: { width: 453, height: 569 },
        contentBounds: { x: 16, y: 16, width: 421, height: 537 },
        encodedBytes: 35_214,
        sha256: "0cd34617f2f5d98b0591bf78dd008a4f6cb6095cba00e1b374e2c21c337e8c33",
    },
    dresser: {
        pixelSize: { width: 427, height: 616 },
        contentBounds: { x: 16, y: 16, width: 395, height: 584 },
        encodedBytes: 43_652,
        sha256: "068ae22bc27d70e8e1fdcdeae59ed9f9a5c48fb0fa6e89c1787abf1d0f106969",
    },
    "single-bed": {
        pixelSize: { width: 585, height: 1024 },
        contentBounds: { x: 3, y: 3, width: 579, height: 1018 },
        encodedBytes: 119_170,
        sha256: "9bfc04998402f7788822d7333cb4498f2e9e19b6082841fd56e6331be50ae11e",
    },
    "sofa-four-left": {
        pixelSize: { width: 1024, height: 782 },
        contentBounds: { x: 4, y: 3, width: 1016, height: 776 },
        encodedBytes: 50_494,
        sha256: "d4bdd3d3cefd075be444edc0a6455d903b174c232cde219ab718aee371dc94fe",
    },
    "sofa-three": {
        pixelSize: { width: 1024, height: 501 },
        contentBounds: { x: 4, y: 3, width: 1016, height: 487 },
        encodedBytes: 41_676,
        sha256: "e35d314059b6221c9f66437897cb2151c0b7bf7c592074e7ab91c2b201bf9033",
    },
    "sofa-two": {
        pixelSize: { width: 645, height: 1024 },
        contentBounds: { x: 4, y: 3, width: 637, height: 1017 },
        encodedBytes: 191_678,
        sha256: "be0109a673452755dd46429f44629cd67feb513e56f7dfaa2dd268bab2bd2b45",
    },
    tv: {
        pixelSize: { width: 1024, height: 205 },
        contentBounds: { x: 3, y: 3, width: 1018, height: 199 },
        encodedBytes: 11_112,
        sha256: "bcdd63d18ad6203abe69204e40e7f5eb0d89b1205cc6a777b6cdfd3532bc5066",
    },
    "wardrobe-large": {
        pixelSize: { width: 516, height: 1024 },
        contentBounds: { x: 4, y: 4, width: 508, height: 1016 },
        encodedBytes: 89_036,
        sha256: "6e1363c1083d5d5782a29e31818fc28b8d00d27ee415b759404f7de66007269b",
    },
    "wardrobe-medium": {
        pixelSize: { width: 635, height: 1024 },
        contentBounds: { x: 5, y: 4, width: 626, height: 1016 },
        encodedBytes: 104_200,
        sha256: "355dfdd51dcd3fd82ca5c4071a7b9d91b3a0602ff6a9ecb3e50d4fb95aa67e4a",
    },
    "wardrobe-small": {
        pixelSize: { width: 996, height: 1024 },
        contentBounds: { x: 8, y: 7, width: 980, height: 1009 },
        encodedBytes: 130_624,
        sha256: "b75c9993a719d5a9d31f40137a7e180894c8e7ae03128dbc8e3a1bf6ab1e7504",
    },
};

const UNVERIFIED_ASSET_LICENSE: FurnitureAssetDefinition["license"] = {
    source: "designer-supplied",
    status: "unverified",
    note: "Перед публичным релизом дизайнер должен подтвердить право использования изображения.",
};

const PLANNER_ASSET_ENCODING: FurnitureAssetDefinition["encoding"] = {
    format: "webp",
    quality: 90,
    alphaQuality: 100,
    exactTransparentRgb: true,
};

const asset = (
    key: FurnitureAssetKey,
    baseRotation: Rotation = 0,
    options: Pick<FurnitureAssetDefinition, "bodyRectIndex"> = {},
): FurnitureAssetDefinition => ({
    src: `/images/planner/${key}.20260717-v2.webp`,
    ...PIXEL_METADATA[key],
    baseRotation,
    backEdge: "top",
    encoding: PLANNER_ASSET_ENCODING,
    version: "2026-07-17-v2",
    license: UNVERIFIED_ASSET_LICENSE,
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

export const getFurnitureAsset = (
    definitionId?: string,
    photoId?: string,
): FurnitureAssetDefinition | undefined => {
    const photo = definitionId ? getFurniturePhoto(definitionId, photoId) : undefined;
    if (photo)
        return {
            src: photo.src,
            pixelSize: { width: photo.width, height: photo.height },
            contentBounds: photo.bounds,
            encodedBytes: photo.encodedBytes,
            sha256: photo.sha256,
            encoding: {
                format: "webp",
                quality: 90,
                alphaQuality: 100,
                exactTransparentRgb: false,
            },
            baseRotation: photo.rotation as Rotation,
            backEdge: "top",
            version: "2026-09-14-v1",
            license: {
                source: "designer-supplied",
                status: "unverified",
                note: "Изображение предоставлено пользователем.",
            },
        };
    return definitionId && isFurnitureAssetKey(definitionId)
        ? FURNITURE_ASSETS[definitionId]
        : undefined;
};
