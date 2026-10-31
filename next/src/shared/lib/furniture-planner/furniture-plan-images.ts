import images from "./furniture-plan-images.json";

/** Designer images for the plan, built by scripts/build-furniture-plan-images.mjs. */
export const FURNITURE_PLAN_IMAGES = images;
export type FurniturePlanImage = (typeof images)[number];

const sizeDistance = (image: FurniturePlanImage, width: number, depth: number) =>
    Math.abs(Math.log(width / image.size.width)) + Math.abs(Math.log(depth / image.size.depth));

/** The image drawn for this size: each standard size has one, others take the closest. */
export const getFurniturePlanImage = (
    definitionId: string,
    width: number,
    depth: number,
): FurniturePlanImage | undefined =>
    FURNITURE_PLAN_IMAGES.filter((image) => image.definitionId === definitionId).reduce<
        FurniturePlanImage | undefined
    >(
        (best, image) =>
            !best || sizeDistance(image, width, depth) < sizeDistance(best, width, depth)
                ? image
                : best,
        undefined,
    );
