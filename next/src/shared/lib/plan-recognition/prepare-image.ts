/** The model reads dimension numbers best at about this size; more only costs time. */
export const PLAN_IMAGE_MAX_SIDE = 2800;
/** What a person may pick; anything bigger is surely not a plan photo. */
export const PLAN_FILE_MAX_BYTES = 25 * 1024 * 1024;

export interface PreparedPlanImage {
    mimeType: "image/jpeg";
    base64: string;
    width: number;
    height: number;
}

export class PlanImageError extends Error {}

/**
 * Redraws the picked picture on a canvas: scaled down to PLAN_IMAGE_MAX_SIDE,
 * turned upright, and re-encoded, which also drops the photo's metadata
 * (camera, time, GPS position) before anything leaves the browser.
 */
export const preparePlanImage = async (file: File): Promise<PreparedPlanImage> => {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        throw new PlanImageError(
            "PDF пока не поддерживается. Сохраните лист с планом как картинку (скриншот) и загрузите её.",
        );
    }
    if (file.size > PLAN_FILE_MAX_BYTES) {
        throw new PlanImageError("Файл слишком большой. Максимум — 25 МБ.");
    }
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        throw new PlanImageError(
            "Не удалось открыть картинку. Подойдут JPG, PNG или WebP; фото с iPhone (HEIC) сохраните как JPG.",
        );
    }
    const scale = Math.min(1, PLAN_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new PlanImageError("Браузер не смог подготовить картинку.");
    // Transparent PNG plans would turn black in JPEG.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) throw new PlanImageError("Браузер не смог подготовить картинку.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(index, index + 0x8000)),
        );
    }
    return { mimeType: "image/jpeg", base64: btoa(binary), width, height };
};
