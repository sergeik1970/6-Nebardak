import photos from "./furniture-photos.json";

export const FURNITURE_PHOTOS = photos;
export type FurniturePhoto = (typeof photos)[number];
export const getFurniturePhotos = (definitionId: string) =>
    FURNITURE_PHOTOS.filter((photo) => photo.definitionId === definitionId);
export const getFurniturePhoto = (definitionId: string, photoId?: string) => {
    const variants = getFurniturePhotos(definitionId);
    return variants.find((photo) => photo.id === photoId) ?? variants[0];
};
