import type { PlanSheet } from "./plan-sheets";

/**
 * A PDF of full-page JPEG images, one per sheet. The format needs nothing
 * more than this, so no PDF library joins the bundle for it.
 */

const POINTS_PER_MM = 72 / 25.4;

export interface PdfPage {
    /** Page size in millimetres. */
    width: number;
    height: number;
    /** Image size in pixels. */
    pixelWidth: number;
    pixelHeight: number;
    jpeg: Uint8Array;
}

const ascii = (value: string) => new TextEncoder().encode(value);

export const buildImagePdf = (pages: PdfPage[]): Uint8Array => {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const write = (chunk: Uint8Array) => {
        chunks.push(chunk);
        length += chunk.length;
    };
    const object = (id: number, body: string, stream?: Uint8Array) => {
        offsets[id] = length;
        write(ascii(`${id} 0 obj\n${body}\n`));
        if (stream) {
            write(ascii("stream\n"));
            write(stream);
            write(ascii("\nendstream\n"));
        }
        write(ascii("endobj\n"));
    };

    write(ascii("%PDF-1.4\n"));
    // Objects: 1 catalog, 2 page tree, then page, content and image per page.
    const objectsPerPage = 3;
    const pageId = (index: number) => 3 + index * objectsPerPage;
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(
        2,
        `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(" ")}] >>`,
    );
    pages.forEach((page, index) => {
        const id = pageId(index);
        const width = (page.width * POINTS_PER_MM).toFixed(2);
        const height = (page.height * POINTS_PER_MM).toFixed(2);
        const content = ascii(`q ${width} 0 0 ${height} 0 0 cm /Sheet Do Q`);
        object(
            id,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${id + 1} 0 R /Resources << /XObject << /Sheet ${id + 2} 0 R >> >> >>`,
        );
        object(id + 1, `<< /Length ${content.length} >>`, content);
        object(
            id + 2,
            `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
            page.jpeg,
        );
    });

    const count = 2 + pages.length * objectsPerPage;
    const crossReference = length;
    const entries = [
        "0000000000 65535 f \n",
        ...Array.from(
            { length: count },
            (_, index) => `${String(offsets[index + 1]).padStart(10, "0")} 00000 n \n`,
        ),
    ];
    write(ascii(`xref\n0 ${count + 1}\n${entries.join("")}`));
    write(
        ascii(
            `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`,
        ),
    );

    const result = new Uint8Array(length);
    let position = 0;
    chunks.forEach((chunk) => {
        result.set(chunk, position);
        position += chunk.length;
    });
    return result;
};

/** Print quality for line drawings without an unwieldy file. */
const SHEET_DPI = 200;

/** One sheet as a JPEG, ready for the PDF or for the print dialog. */
export const rasterizeSheet = async (sheet: PlanSheet): Promise<PdfPage> => {
    if (typeof document === "undefined") throw new Error("Чертёж доступен только в браузере.");
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Браузер не смог подготовить лист чертежа."));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sheet.svg)}`;
    await loaded;

    const pixelWidth = Math.round((sheet.width / 25.4) * SHEET_DPI);
    const pixelHeight = Math.round((sheet.height / 25.4) * SHEET_DPI);
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог подготовить лист чертежа.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            (result) =>
                result
                    ? resolve(result)
                    : reject(new Error("Браузер не смог сохранить лист чертежа.")),
            "image/jpeg",
            0.92,
        ),
    );
    return {
        width: sheet.width,
        height: sheet.height,
        pixelWidth,
        pixelHeight,
        jpeg: new Uint8Array(await blob.arrayBuffer()),
    };
};

export const renderPlanSheetsPdf = async (sheets: PlanSheet[]): Promise<Blob> => {
    const pages: PdfPage[] = [];
    // One at a time: each A3 canvas holds tens of megabytes.
    for (const sheet of sheets) pages.push(await rasterizeSheet(sheet));
    return new Blob([buildImagePdf(pages)], { type: "application/pdf" });
};
