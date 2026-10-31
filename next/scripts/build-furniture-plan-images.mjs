// Builds the planner's furniture images from the designer's PNG export.
//
//   node scripts/build-furniture-plan-images.mjs <folder with the PNGs> <folder with the earlier set>
//
// Each export is one cell of the designer's AutoCAD sheets at its own zoom, so
// the pixels say nothing about millimetres. Every entry below names the cell's
// real size, and `fit` says which part of the picture is the piece's body:
// doors, a chair or a duvet's overhang may reach past it without squashing it.
// Mirrored exports are left out: the planner flips a piece itself. The earlier
// set (September) still supplies the pieces the newer sheets do not draw.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const VERSION = "20261031";
const MAX_SIDE = 1024;
/** Above this alpha a pixel is the object; below it, a soft contact shadow. */
const SOLID_ALPHA = 128;
const KEPT_ALPHA = 8;
/** A contact shadow ends this close to the object; fainter pixels further out are export noise. */
const SHADOW_REACH = 40;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "public/images", `furniture-${VERSION}`);
const manifestPath = path.join(
    projectRoot,
    "src/shared/lib/furniture-planner/furniture-plan-images.json",
);

/** `solid`: the opaque outline is the body. */
const solid = { kind: "solid" };
/** The body starts at the top edge; doors or a chair hang below it. */
const fromTop = { kind: "from-top" };
/** The length is exact; the duvet and headboard overhang it sideways. */
const alongLength = { kind: "along-length" };
/** The width is exact; a stand or a soft edge overhangs it front and back. */
const alongWidth = { kind: "along-width" };
/** A group drawn smaller than its envelope, sized from the table's real depth. */
const inEnvelope = (tableDepth, tableColumn = 0) => ({
    kind: "in-envelope",
    tableDepth,
    tableColumn,
});

const piece = (id, definitionId, file, width, depth, fit, options = {}) => ({
    id,
    definitionId,
    file,
    width,
    depth,
    fit,
    ...options,
});

const EARLIER_SET_PREFIX = "909926c27c35d8b2ce372ede03583b4b_3b1cc180_0a7c_42f2_a92f_41a7708a22a4";

const SPEC = [
    piece("wardrobe-small-600", "wardrobe-small", "Гардероб-1", 600, 450, fromTop),
    piece("wardrobe-small-700", "wardrobe-small", "Гардероб-1 5", 700, 500, fromTop),
    piece("wardrobe-medium-900", "wardrobe-medium", "Гардероб-1 2", 900, 600, fromTop),
    piece("wardrobe-medium-1350", "wardrobe-medium", "Гардероб-1 6", 1350, 600, fromTop),
    piece("wardrobe-medium-1500", "wardrobe-medium", "Гардероб-1 3", 1500, 600, fromTop),
    piece("wardrobe-large-2000", "wardrobe-large", "Гардероб-1 4", 2000, 600, fromTop),
    piece("dresser-600", "dresser", "Гардероб-1 7", 600, 400, solid),
    piece("dresser-900", "dresser", "Гардероб-1 8", 900, 400, solid),
    piece("walk-in-u", "walk-in-u", "Гардероб-1 9", 2000, 1500, solid),
    piece("walk-in-l", "walk-in-l", "Гардероб-1 10", 2000, 1500, solid),
    piece("walk-in-wardrobes", "walk-in-wardrobes", "Гардероб-1 11", 2000, 1800, solid),
    piece("walk-in-dressers", "walk-in-dressers", "Гардероб-1 12", 2000, 1800, solid),
    piece("walk-in-rows", "walk-in-rows", "Гардероб-1 13", 2000, 2000, solid),
    piece("bookcase-800", "bookcase", "Гардероб-1 14", 800, 300, solid),

    piece("sofa-two-1600", "sofa-two", "Диваны", 1600, 950, solid),
    piece("sofa-two-1800", "sofa-two", "Диваны 2", 1800, 1000, solid),
    piece("sofa-two-2000", "sofa-two", "Диваны 3", 2000, 1000, solid),
    piece("armchair-800", "armchair", "Диваны 4", 800, 790, solid),
    piece("armchair-1000", "armchair", "Диваны 5", 1000, 950, solid),
    piece("sofa-three-2500", "sofa-three", "Диваны 6", 2500, 1200, solid),
    piece("sofa-three-2700", "sofa-three", "Диваны 7", 2700, 1200, solid),
    piece("sofa-bed-1400", "sofa-bed", "Диваны 8", 1400, 1000, solid),
    piece("sofa-bed-2000", "sofa-bed", "Диваны 9", 2000, 1000, solid),
    piece("sofa-four-left-2200", "sofa-four-left", "Диваны 10", 2200, 1500, solid),
    piece("sofa-three-2200", "sofa-three", "Диваны 11", 2200, 950, solid),
    piece("coffee-table-500", "coffee-table", "Диваны 12", 500, 500, solid),
    piece("tv-console-925", "tv-console", "Диваны 13", 925, 400, solid),
    piece("tv-console-1165", "tv-console", "Диваны 14", 1165, 400, solid),
    piece("tv-console-1325", "tv-console", "Диваны 15", 1325, 400, solid),
    piece("tv-console-1435", "tv-console", "Диваны 16", 1435, 400, solid),
    piece("tv-console-1655", "tv-console", "Диваны 17", 1655, 400, solid),
    piece("tv-console-1875", "tv-console", "Диваны 18", 1875, 400, solid),

    // Beds are exported on their side; the catalogue keeps the head at the wall (top).
    piece("single-bed-1000", "single-bed", "Кровати 5", 1000, 1800, alongLength, { rotate: 270 }),
    piece("single-bed-900", "single-bed", "Кровати 7", 900, 2000, alongLength, { rotate: 270 }),
    piece("double-bed-1400", "double-bed", "Кровати 10", 1400, 2000, alongLength, { rotate: 270 }),
    piece("double-bed-1600", "double-bed", "Кровати 12", 1600, 2000, alongLength, { rotate: 270 }),
    piece("double-bed-1800", "double-bed", "Кровати 14", 1800, 2000, alongLength, { rotate: 270 }),
    piece("bedside-table-400", "bedside-table", "Кровати 16", 400, 350, solid),
    // The cradle only exists next to a bed: this export has it upright.
    piece("cradle-650", "cradle", "Кровати 3", 650, 800, solid, {
        crop: { left: 1560, top: 860, width: 360, height: 416 },
    }),

    piece("dining-oval-six", "dining-oval-six", "Столы_обеденные", 2960, 2090, inEnvelope(900)),
    piece(
        "dining-round-four",
        "dining-round-four",
        "Столы_обеденные 2",
        2260,
        2260,
        inEnvelope(1000),
    ),
    piece("dining-rect-six", "dining-rect-six", "Столы_обеденные 3", 3000, 2200, inEnvelope(900)),
    piece(
        "dining-square-four",
        "dining-square-four",
        "Столы_обеденные 4",
        2340,
        2340,
        inEnvelope(1000, 0.18),
    ),

    // Dressing tables: the body is the tabletop, the seat stands in its front zone.
    piece(
        "dressing-table-900-350",
        "dressing-table",
        "Туалетные_и_рабочие_столы",
        900,
        350,
        fromTop,
        {
            object: "largest",
        },
    ),
    piece(
        "dressing-table-900-400",
        "dressing-table",
        "Туалетные_и_рабочие_столы 2",
        900,
        400,
        fromTop,
        {
            object: "largest",
        },
    ),
    piece(
        "dressing-table-1100",
        "dressing-table",
        "Туалетные_и_рабочие_столы 3",
        1100,
        450,
        fromTop,
        {
            object: "largest",
        },
    ),
    piece(
        "dressing-table-950",
        "dressing-table",
        "Туалетные_и_рабочие_столы 4",
        950,
        450,
        fromTop,
        {
            object: "largest",
        },
    ),
    // Desks: the body covers the tabletop and the chair, as the catalogue's rects do.
    piece("desk-1200", "desk", "Туалетные_и_рабочие_столы 5", 1200, 1100, fromTop),
    piece("desk-1400", "desk", "Туалетные_и_рабочие_столы 6", 1400, 1100, fromTop),
    piece(
        "desk-corner-narrow",
        "desk-corner-narrow",
        "Туалетные_и_рабочие_столы 7",
        1200,
        1400,
        solid,
    ),
    piece("desk-pedestal", "desk-pedestal", "Туалетные_и_рабочие_столы 8", 1200, 1100, fromTop),
    piece("desk-corner-1600", "desk-corner-1600", "Туалетные_и_рабочие_столы 9", 1600, 1200, solid),
    piece(
        "desk-corner-1200",
        "desk-corner-1200",
        "Туалетные_и_рабочие_столы 10",
        1200,
        1200,
        solid,
    ),
    piece(
        "desk-corner-1800",
        "desk-corner-1800",
        "Туалетные_и_рабочие_столы 11",
        1800,
        1200,
        solid,
    ),
    piece(
        "desk-corner-1600-1400",
        "desk-corner-1600-1400",
        "Туалетные_и_рабочие_столы 12",
        1600,
        1400,
        solid,
    ),

    piece("aquarium-1000", "aquarium", "5", 1000, 500, fromTop),
    piece("coffee-table-rect-1000", "coffee-table-rect", "10", 1000, 550, solid),
    piece("child-bed-800", "child-bed", "11", 800, 1600, alongLength, { rotate: 90 }),
    piece("pet-bed-1000", "pet-bed", "12", 1000, 750, solid),
    piece("tv-750", "tv", `${EARLIER_SET_PREFIX} (9)`, 750, 100, alongWidth),
    piece("litter-box-550", "litter-box", `${EARLIER_SET_PREFIX} (11)`, 550, 400, solid),
];

const boundsOf = (data, width, height, minimumAlpha) => {
    let [left, top, right, bottom] = [width, height, -1, -1];
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (data[(y * width + x) * 4 + 3] < minimumAlpha) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    }
    if (right < 0) throw new Error("Image has no visible pixels");
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
};

const withinShadowReach = (outer, solidBounds) => {
    const left = Math.max(outer.x, solidBounds.x - SHADOW_REACH);
    const top = Math.max(outer.y, solidBounds.y - SHADOW_REACH);
    const right = Math.min(outer.x + outer.width, solidBounds.x + solidBounds.width + SHADOW_REACH);
    const bottom = Math.min(
        outer.y + outer.height,
        solidBounds.y + solidBounds.height + SHADOW_REACH,
    );
    return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Largest connected solid object: a tabletop without the seat in front of it. */
const largestObject = (data, width, height) => {
    const seen = new Uint8Array(width * height);
    let best = { size: 0 };
    for (let start = 0; start < seen.length; start += 1) {
        if (seen[start] || data[start * 4 + 3] < SOLID_ALPHA) continue;
        const stack = [start];
        seen[start] = 1;
        let [left, top, right, bottom, size] = [width, height, -1, -1, 0];
        while (stack.length) {
            const at = stack.pop();
            const x = at % width;
            const y = (at - x) / width;
            size += 1;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            for (const next of [at - 1, at + 1, at - width, at + width]) {
                if (next < 0 || next >= seen.length || seen[next]) continue;
                if (Math.abs((next % width) - x) > 1 || data[next * 4 + 3] < SOLID_ALPHA) continue;
                seen[next] = 1;
                stack.push(next);
            }
        }
        if (size > best.size)
            best = { size, x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    }
    return best;
};

/** Pixels per millimetre from the table's depth, read down a column clear of chairs. */
const tableScale = (data, width, height, solidBounds, fit) => {
    const column = Math.round(solidBounds.x + solidBounds.width * (0.5 + fit.tableColumn));
    let [top, bottom] = [height, -1];
    for (let y = 0; y < height; y += 1) {
        if (data[(y * width + column) * 4 + 3] < SOLID_ALPHA) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
    }
    return (bottom - top + 1) / fit.tableDepth;
};

const bodyOf = (entry, data, width, height, solidBounds) => {
    const { fit } = entry;
    const ratio = entry.depth / entry.width;
    if (fit.kind === "solid") return solidBounds;
    if (fit.kind === "from-top") {
        const reference =
            entry.object === "largest" ? largestObject(data, width, height) : solidBounds;
        return { ...reference, height: reference.width * ratio };
    }
    if (fit.kind === "along-length") {
        const across = solidBounds.height / ratio;
        return {
            ...solidBounds,
            x: solidBounds.x + (solidBounds.width - across) / 2,
            width: across,
        };
    }
    if (fit.kind === "along-width") {
        const along = solidBounds.width * ratio;
        return {
            ...solidBounds,
            y: solidBounds.y + (solidBounds.height - along) / 2,
            height: along,
        };
    }
    const scale = tableScale(data, width, height, solidBounds, fit);
    const [bodyWidth, bodyHeight] = [entry.width * scale, entry.depth * scale];
    return {
        x: solidBounds.x + (solidBounds.width - bodyWidth) / 2,
        y: solidBounds.y + (solidBounds.height - bodyHeight) / 2,
        width: bodyWidth,
        height: bodyHeight,
    };
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const round = (value) => Math.round(value * 100) / 100;

const sourceDirs = process.argv.slice(2);
if (sourceDirs.length < 2) throw new Error("Pass the folders with the designer's PNG files");

// macOS hands back NFD names, the spec is written in NFC.
const sourceFiles = new Map(
    (
        await Promise.all(
            sourceDirs.map(async (directory) =>
                (await readdir(directory)).map((name) => [
                    name.normalize("NFC"),
                    path.join(directory, name),
                ]),
            ),
        )
    ).flat(),
);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const manifest = [];
for (const entry of SPEC) {
    const source = sourceFiles.get(`${entry.file}.png`);
    if (!source) throw new Error(`Missing source file: ${entry.file}.png`);
    const sourceBuffer = await readFile(source);

    let image = sharp(sourceBuffer).ensureAlpha();
    if (entry.crop) image = sharp(await image.extract(entry.crop).png().toBuffer());
    if (entry.rotate) image = sharp(await image.rotate(entry.rotate).png().toBuffer());

    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const solidBounds = boundsOf(data, info.width, info.height, SOLID_ALPHA);
    const kept = withinShadowReach(
        boundsOf(data, info.width, info.height, KEPT_ALPHA),
        solidBounds,
    );
    const body = bodyOf(entry, data, info.width, info.height, solidBounds);

    const scale = Math.min(1, MAX_SIDE / Math.max(kept.width, kept.height));
    const outWidth = Math.round(kept.width * scale);
    const outHeight = Math.round(kept.height * scale);
    const webp = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
    })
        .extract({ left: kept.x, top: kept.y, width: kept.width, height: kept.height })
        .resize(outWidth, outHeight)
        .webp({ quality: 86, alphaQuality: 100, effort: 6 })
        .toBuffer();

    const digest = sha256(webp);
    const fileName = `${entry.id}-${digest.slice(0, 12)}.webp`;
    await writeFile(path.join(outputDir, fileName), webp);
    manifest.push({
        id: entry.id,
        definitionId: entry.definitionId,
        src: `/images/furniture-${VERSION}/${fileName}`,
        source: `${entry.file}.png`,
        sourceSha256: sha256(sourceBuffer),
        size: { width: entry.width, depth: entry.depth },
        pixelSize: { width: outWidth, height: outHeight },
        // The part of the picture that covers the piece's body, in encoded pixels.
        body: {
            x: round((body.x - kept.x) * scale),
            y: round((body.y - kept.y) * scale),
            width: round(body.width * scale),
            height: round(body.height * scale),
        },
        encodedBytes: webp.length,
        sha256: digest,
    });
    console.log(
        entry.id.padEnd(26),
        `${outWidth}x${outHeight}`.padEnd(11),
        `${webp.length >> 10} KB`,
    );
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
console.log(
    `${manifest.length} images from ${new Set(SPEC.map((entry) => entry.file)).size} files`,
);
