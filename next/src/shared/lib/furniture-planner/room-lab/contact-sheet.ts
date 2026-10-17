import { getFurniture } from "../catalog";
import { getFurnitureAsset } from "../assets";
import {
    getDoorObstacle,
    getRadiatorBody,
    getRadiatorServiceObstacle,
    getRotatedGeometry,
    getWindowCurtainObstacle,
    getWorldClearanceRects,
} from "../geometry";
import { getRoomSegment, getRoomVertices } from "../room-geometry";
import { explainLayoutForProfile } from "../solver";
import type { FurnitureAssetKey, LayoutVariantProfileId, Placement, Rect, Room } from "../types";
import type { RoomLabCase, RoomLabCaseResult, RoomLabReport } from "./types";

export type RoomLabAssetDataUrls = Partial<Record<FurnitureAssetKey, string>>;

const escapeHtml = (value: string): string =>
    value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

const jsonForInlineScript = (value: unknown): string =>
    JSON.stringify(value).replaceAll("<", "\\u003c");

const formatMetric = (
    metric: RoomLabCaseResult["metrics"][keyof RoomLabCaseResult["metrics"]],
    formatter: (value: number) => string,
): string | null =>
    typeof metric === "object" &&
    metric !== null &&
    "status" in metric &&
    metric.status === "measured"
        ? formatter(metric.value)
        : null;

const normalizeRotation = (value: number): 0 | 90 | 180 | 270 =>
    (((value % 360) + 360) % 360) as 0 | 90 | 180 | 270;

const rectSvg = (rect: Rect, className: string, extra = ""): string =>
    `<rect class="${className}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.depth}" ${extra}/>`;

const openingLine = (
    room: Room,
    opening: {
        wall: Room["doors"][number]["wall"];
        segmentId?: string;
        offset: number;
        width: number;
    },
    className: string,
): string => {
    const segment = getRoomSegment(room, opening);
    if (!segment) return "";
    const tangentX = (segment.end.x - segment.start.x) / segment.length;
    const tangentY = (segment.end.y - segment.start.y) / segment.length;
    const startX = segment.start.x + tangentX * opening.offset;
    const startY = segment.start.y + tangentY * opening.offset;
    const endX = segment.start.x + tangentX * (opening.offset + opening.width);
    const endY = segment.start.y + tangentY * (opening.offset + opening.width);
    return `<line class="${className}" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"/>`;
};

const furnitureColor = (definitionId: string): string => {
    const definition = getFurniture(definitionId);
    switch (definition.category) {
        case "sleep":
            return "#8c6bc1";
        case "living":
            return "#d8794d";
        case "media":
            return "#3d5269";
        case "work":
            return "#3c8b78";
        case "storage":
            return "#c49342";
        case "children":
            return "#cf6f91";
    }
};

interface RenderedVariant {
    variantId: string;
    label: string;
    profileId: LayoutVariantProfileId;
    placements: Placement[];
    explanation: string[];
}

const renderedVariants = (roomCase: RoomLabCase, result: RoomLabCaseResult): RenderedVariant[] => {
    if (result.execution.status !== "success") {
        return [
            {
                variantId: "failure",
                label: result.execution.status,
                profileId: "balanced",
                placements: [],
                explanation: [result.execution.message],
            },
        ];
    }

    if (result.execution.variants.length > 0) {
        return result.execution.variants.map((variant) => ({
            variantId: variant.variantId,
            label: variant.profile.label,
            profileId: variant.profile.id,
            placements: variant.placements,
            explanation: explainLayoutForProfile(
                roomCase.room,
                variant.placements,
                variant.profile.id,
                roomCase.preferences,
            ),
        }));
    }

    return [
        {
            variantId: "balanced-1",
            label: "Сбалансированный",
            profileId: "balanced",
            placements: result.execution.placements,
            explanation: explainLayoutForProfile(
                roomCase.room,
                result.execution.placements,
                "balanced",
                roomCase.preferences,
            ),
        },
    ];
};

const furnitureImage = (placement: Placement, index: number, clipPrefix: string): string => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation, placement);
    const asset = getFurnitureAsset(definition.id, placement.photoId);
    if (!asset) return "";

    const imageRectIndex = asset.bodyRectIndex;
    const imageRect =
        imageRectIndex === undefined
            ? { x: 0, y: 0, width: geometry.width, depth: geometry.depth }
            : geometry.bodyRects[imageRectIndex];
    if (!imageRect) return "";
    const worldRect = {
        x: placement.x + imageRect.x,
        y: placement.y + imageRect.y,
        width: imageRect.width,
        depth: imageRect.depth,
    };
    const clipId = `${clipPrefix}-asset-${index}`;

    return `<clipPath id="${clipId}">${rectSvg(worldRect, "asset-clip")}</clipPath>`;
};

const renderRoomSvg = (
    roomCase: RoomLabCase,
    renderedVariant: RenderedVariant,
    uniqueId: string,
): string => {
    const { room } = roomCase;
    const maximumDimension = Math.max(room.width, room.depth);
    const badgeRadius = maximumDimension / 62;
    const badgeFontSize = maximumDimension / 48;
    const fixedClearances = [
        ...room.doors.map((door) => getDoorObstacle(door, room)),
        ...room.windows.map((window) => getWindowCurtainObstacle(window, room)),
        ...(room.radiators ?? []).map((radiator) => getRadiatorServiceObstacle(radiator, room)),
    ];
    const furnitureClearances = renderedVariant.placements.flatMap((placement) =>
        getWorldClearanceRects(placement),
    );
    const imageDefinitions = renderedVariant.placements
        .map((placement, index) => furnitureImage(placement, index, uniqueId))
        .join("");

    const furniture = renderedVariant.placements
        .map((placement, index) => {
            const definition = getFurniture(placement.definitionId);
            const geometry = getRotatedGeometry(definition, placement.rotation, placement);
            const centerX = placement.x + geometry.width / 2;
            const centerY = placement.y + geometry.depth / 2;
            const bodyRects = geometry.bodyRects
                .map((rect) =>
                    rectSvg(
                        {
                            x: placement.x + rect.x,
                            y: placement.y + rect.y,
                            width: rect.width,
                            depth: rect.depth,
                        },
                        "furniture-body",
                        `fill="${furnitureColor(placement.definitionId)}"`,
                    ),
                )
                .join("");

            return [
                `<g class="furniture-item"><title>${escapeHtml(definition.label)} · X ${placement.x}, Y ${placement.y}, ${placement.rotation}°</title>`,
                bodyRects,
                `<circle class="item-badge" cx="${centerX}" cy="${centerY}" r="${badgeRadius}"/>`,
                `<text class="item-number" x="${centerX}" y="${centerY}" font-size="${badgeFontSize}">${index + 1}</text>`,
                `</g>`,
            ].join("");
        })
        .join("");

    const gridId = `${uniqueId}-grid`;
    const roomPoints = getRoomVertices(room)
        .map((vertex) => `${vertex.x},${vertex.y}`)
        .join(" ");
    return [
        `<svg class="room-plan" viewBox="0 0 ${room.width} ${room.depth}" role="img" aria-label="План ${escapeHtml(roomCase.title)}, ${escapeHtml(renderedVariant.label)}">`,
        `<defs><pattern id="${gridId}" width="500" height="500" patternUnits="userSpaceOnUse"><path d="M 500 0 L 0 0 0 500" class="grid-line"/></pattern>${imageDefinitions}</defs>`,
        `<polygon class="room-surface" points="${roomPoints}"/>`,
        `<polygon class="grid-fill" points="${roomPoints}" fill="url(#${gridId})"/>`,
        fixedClearances.map((rect) => rectSvg(rect, "fixed-clearance")).join(""),
        furnitureClearances
            .map((clearance) =>
                rectSvg(
                    clearance,
                    clearance.requirement === "hard"
                        ? "clearance clearance-hard"
                        : "clearance clearance-preferred",
                ),
            )
            .join(""),
        room.doors.map((door) => openingLine(room, door, "door-line")).join(""),
        room.windows.map((window) => openingLine(room, window, "window-line")).join(""),
        (room.radiators ?? [])
            .map((radiator) => rectSvg(getRadiatorBody(radiator, room), "radiator-body"))
            .join(""),
        `<g class="assets">${renderedVariant.placements
            .map((placement, index) => {
                const definition = getFurniture(placement.definitionId);
                const geometry = getRotatedGeometry(definition, placement.rotation, placement);
                const asset = getFurnitureAsset(definition.id, placement.photoId);
                if (!asset) return "";
                const imageRectIndex = asset.bodyRectIndex;
                const imageRect =
                    imageRectIndex === undefined
                        ? { x: 0, y: 0, width: geometry.width, depth: geometry.depth }
                        : geometry.bodyRects[imageRectIndex];
                const baseGeometry = getRotatedGeometry(definition, 0, placement);
                const baseImageRect =
                    imageRectIndex === undefined
                        ? {
                              x: 0,
                              y: 0,
                              width: baseGeometry.width,
                              depth: baseGeometry.depth,
                          }
                        : baseGeometry.bodyRects[imageRectIndex];
                if (!imageRect || !baseImageRect) return "";
                const correctionSwapsAxes = asset.baseRotation % 180 !== 0;
                const sourceWidth = correctionSwapsAxes ? baseImageRect.depth : baseImageRect.width;
                const sourceHeight = correctionSwapsAxes
                    ? baseImageRect.width
                    : baseImageRect.depth;
                const worldRect = {
                    x: placement.x + imageRect.x,
                    y: placement.y + imageRect.y,
                    width: imageRect.width,
                    depth: imageRect.depth,
                };
                const centerX = worldRect.x + worldRect.width / 2;
                const centerY = worldRect.y + worldRect.depth / 2;
                return `<image class="asset-layer" data-asset-key="${definition.assetKey}" x="${centerX - sourceWidth / 2}" y="${centerY - sourceHeight / 2}" width="${sourceWidth}" height="${sourceHeight}" preserveAspectRatio="none" clip-path="url(#${uniqueId}-asset-${index})" transform="rotate(${normalizeRotation(asset.baseRotation + placement.rotation)} ${centerX} ${centerY})"/>`;
            })
            .join("")}</g>`,
        furniture,
        `<polygon class="room-outline" points="${roomPoints}"/>`,
        `</svg>`,
    ].join("");
};

const renderMetricChips = (result: RoomLabCaseResult): string => {
    const values = [
        formatMetric(result.metrics.tvViewingDistanceMm, (value) => `ТВ ${Math.round(value)} мм`),
        formatMetric(result.metrics.tvAxisOffsetRatio, (value) => `ось ТВ ${value.toFixed(2)}`),
        formatMetric(result.metrics.dresserToBedMm, (value) => `комод ${Math.round(value)} мм`),
        formatMetric(result.metrics.bookcaseToDeskMm, (value) => `шкаф ${Math.round(value)} мм`),
        formatMetric(
            result.metrics.occupiedEnvelopeAreaRatio,
            (value) => `оболочка ${Math.round(value * 100)}%`,
        ),
        formatMetric(result.metrics.freeSpaceBalance, (value) => `баланс ${value.toFixed(2)}`),
        formatMetric(
            result.metrics.variantTopologyCount,
            (value) => `топологии ${Math.round(value)}`,
        ),
    ].filter((value): value is string => Boolean(value));

    return values.map((value) => `<span class="metric-chip">${escapeHtml(value)}</span>`).join("");
};

const renderReviewControls = (caseId: string, variantId: string): string => {
    const reviewKey = `${caseId}:${variantId}`;
    return [
        `<div class="review-controls" data-review-key="${escapeHtml(reviewKey)}">`,
        `<label>Вердикт<select class="review-verdict" aria-label="Вердикт ${escapeHtml(reviewKey)}"><option value="">Не оценено</option><option value="good">Хорошо</option><option value="acceptable">Допустимо</option><option value="questionable">Спорно</option><option value="bad">Плохо</option></select></label>`,
        `<label>Комментарий<textarea class="review-note" rows="2" placeholder="Что хорошо или что нужно исправить"></textarea></label>`,
        `</div>`,
    ].join("");
};

const renderCase = (roomCase: RoomLabCase, result: RoomLabCaseResult): string => {
    const variants = renderedVariants(roomCase, result);
    const findings = result.findings.map((finding) => finding.code);
    const findingMarkup =
        result.findings.length > 0
            ? result.findings
                  .map(
                      (finding) =>
                          `<li class="finding finding-${finding.severity}"><strong>${escapeHtml(finding.code)}</strong> — ${escapeHtml(finding.message)}</li>`,
                  )
                  .join("")
            : `<li class="finding-none">Автоматических замечаний нет</li>`;

    return [
        `<article class="case-card" id="case-${roomCase.id}" data-case-id="${roomCase.id}" data-status="${result.execution.status}" data-tags="${escapeHtml(roomCase.tags.join("|").toLowerCase())}" data-findings="${escapeHtml(findings.join("|"))}">`,
        `<header class="case-header"><div><div class="case-kicker">${roomCase.id} · ${((roomCase.room.width * roomCase.room.depth) / 1_000_000).toFixed(1)} м²</div><h2>${escapeHtml(roomCase.title)}</h2><p>${escapeHtml(roomCase.description)}</p></div>`,
        `<div class="case-status"><span class="status status-${result.execution.status}">${escapeHtml(result.execution.status)}</span><span>${result.execution.durationMs} мс · ${result.execution.exploredNodes} узлов</span><a href="./cases/${roomCase.id}/result.json">JSON кейса</a></div></header>`,
        `<div class="case-meta"><span>${roomCase.room.width} × ${roomCase.room.depth} мм</span>${roomCase.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`,
        `<div class="quality-strip"><div class="metrics">${renderMetricChips(result)}</div><ul class="findings">${findingMarkup}</ul></div>`,
        `<div class="variant-grid" style="--variant-count:${Math.min(3, variants.length)}">`,
        variants
            .map((renderedVariant, index) => {
                const uniqueId = `${roomCase.id.toLowerCase()}-${index}`;
                const legend = renderedVariant.placements
                    .map(
                        (placement, itemIndex) =>
                            `<span class="legend-item"><b>${itemIndex + 1}</b>${escapeHtml(getFurniture(placement.definitionId).shortLabel)}</span>`,
                    )
                    .join("");
                return [
                    `<section class="variant-card" data-variant-id="${escapeHtml(renderedVariant.variantId)}">`,
                    `<div class="variant-heading"><div><strong>${escapeHtml(renderedVariant.label)}</strong><span>${escapeHtml(renderedVariant.profileId)}</span></div><span>${renderedVariant.placements.length} предметов</span></div>`,
                    `<div class="plan-frame">${renderRoomSvg(roomCase, renderedVariant, uniqueId)}</div>`,
                    `<div class="item-legend">${legend || `<span class="legend-item">Расстановка отсутствует</span>`}</div>`,
                    `<ul class="explanation">${renderedVariant.explanation.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
                    renderReviewControls(roomCase.id, renderedVariant.variantId),
                    `</section>`,
                ].join("");
            })
            .join(""),
        `</div></article>`,
    ].join("");
};

const styles = `
:root{color-scheme:light;--ink:#292621;--muted:#70695f;--paper:#f4efe6;--card:#fffdf8;--line:#d9d0c2;--accent:#a54f32;--good:#2f775d;--warn:#aa692d;--shadow:0 12px 38px rgba(61,48,32,.10)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(circle at 12% -8%,#fff7e9 0,transparent 28rem),var(--paper);color:var(--ink);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button,input,select,textarea{font:inherit}
a{color:#7c3d29}
.page-header{padding:42px clamp(20px,4vw,64px) 28px;background:#2d2a25;color:#fffaf0}
.page-header-inner{max-width:1680px;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end}
.eyebrow{color:#eab78b;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
h1{margin:8px 0 10px;font:700 clamp(34px,5vw,62px)/.98 Georgia,serif}
.page-header p{margin:0;max-width:760px;color:#d8d0c5;font-size:16px}
.run-summary{display:grid;grid-template-columns:repeat(3,minmax(96px,1fr));gap:8px}
.summary-cell{padding:14px 16px;border:1px solid #565048;border-radius:14px;background:#37332e}
.summary-cell b{display:block;font-size:22px}.summary-cell span{color:#c9c0b5;font-size:12px}
.toolbar{position:sticky;top:0;z-index:20;padding:12px clamp(20px,4vw,64px);border-bottom:1px solid var(--line);background:rgba(248,244,237,.94);backdrop-filter:blur(16px)}
.toolbar-inner{max-width:1680px;margin:auto;display:flex;flex-wrap:wrap;gap:10px;align-items:end}
.control{display:grid;gap:4px;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.control input,.control select{min-width:150px;height:38px;border:1px solid #cfc5b7;border-radius:9px;background:#fff;padding:0 10px;color:var(--ink);text-transform:none;letter-spacing:0}
.control-search{flex:1;min-width:230px}.control-search input{width:100%}
.toggle{height:38px;display:flex;align-items:center;gap:7px;padding:0 10px;border:1px solid #cfc5b7;border-radius:9px;background:#fff;color:var(--ink);font-size:12px}
.toolbar button{height:38px;border:0;border-radius:9px;padding:0 14px;background:#2d2a25;color:#fff;cursor:pointer}
.visible-count{margin-left:auto;align-self:center;color:var(--muted);white-space:nowrap}
main{max-width:1680px;margin:auto;padding:24px clamp(16px,3vw,44px) 80px}
.case-card{margin:0 0 24px;padding:22px;border:1px solid var(--line);border-radius:20px;background:var(--card);box-shadow:var(--shadow)}
.case-card[hidden]{display:none}
.case-header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:start}
.case-kicker{font-size:12px;font-weight:800;color:var(--accent);letter-spacing:.08em;text-transform:uppercase}
.case-header h2{margin:4px 0 5px;font:700 27px/1.1 Georgia,serif}.case-header p{margin:0;color:var(--muted);max-width:850px}
.case-status{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;color:var(--muted);font-size:12px}
.status{padding:5px 8px;border-radius:999px;font-weight:800;background:#eee7dc;color:#554c41}
.status-success{background:#dcefe5;color:#245f49}.status-invalid-room,.status-invalid-request,.status-proven-impossible,.status-search-exhausted{background:#f5e2d6;color:#8b452e}
.case-meta,.metrics{display:flex;gap:7px;flex-wrap:wrap}.case-meta{margin-top:13px}.tag,.case-meta>span:first-child,.metric-chip{padding:5px 8px;border-radius:7px;background:#f1ece3;color:#61584d;font-size:11px}
.quality-strip{display:grid;grid-template-columns:minmax(0,1fr) minmax(290px,.8fr);gap:14px;margin:14px 0;padding:12px;border-radius:12px;background:#f6f2eb}
.findings{margin:0;padding-left:19px;color:var(--muted);font-size:12px}.finding-warning{color:#843e28}.finding-info{color:#715a32}.finding-none{list-style:"✓  ";color:var(--good)}
.variant-grid{display:grid;grid-template-columns:repeat(var(--variant-count),minmax(260px,1fr));gap:14px}
.variant-card{min-width:0;padding:13px;border:1px solid #ded5c8;border-radius:14px;background:#fff}
.variant-heading{display:flex;justify-content:space-between;gap:10px;align-items:start;margin-bottom:10px}.variant-heading div{display:grid}.variant-heading strong{font-size:15px}.variant-heading span{color:var(--muted);font-size:11px}
.plan-frame{display:flex;align-items:center;justify-content:center;min-height:220px;padding:12px;border:1px solid #e2d9cc;border-radius:10px;background:#f8f5ef;overflow:hidden}
.room-plan{display:block;max-width:100%;max-height:390px;filter:drop-shadow(0 6px 8px rgba(54,44,32,.08))}
.room-surface{fill:#fffdf7}.room-outline{fill:none;stroke:#3f3a34;stroke-width:2.2;vector-effect:non-scaling-stroke}.grid-line{fill:none;stroke:#ddd5c8;stroke-width:12}.grid-fill{opacity:.42}
.door-line,.window-line{stroke-width:7;vector-effect:non-scaling-stroke}.door-line{stroke:#d16e3e}.window-line{stroke:#3488a2}.radiator-body{fill:#c75e47;stroke:#8f3627;stroke-width:1.5;vector-effect:non-scaling-stroke}
.fixed-clearance,.clearance{display:none;vector-effect:non-scaling-stroke}.show-hard .fixed-clearance,.show-hard .clearance-hard{display:block;fill:rgba(193,70,48,.10);stroke:#c14630;stroke-width:1;stroke-dasharray:5 4}.show-preferred .clearance-preferred{display:block;fill:rgba(66,126,176,.08);stroke:#427eb0;stroke-width:1;stroke-dasharray:4 4}
.furniture-body{fill-opacity:.42;stroke:#3e352c;stroke-width:1.5;vector-effect:non-scaling-stroke}.hide-assets .asset-layer{display:none}.asset-layer{opacity:.84}.hide-assets .furniture-body{fill-opacity:.78}
.item-badge{fill:#fffaf0;stroke:#382f27;stroke-width:1.5;vector-effect:non-scaling-stroke}.item-number{text-anchor:middle;dominant-baseline:central;font-weight:900;fill:#2f2821;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
.item-legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.legend-item{display:flex;align-items:center;gap:5px;color:#5f574d;font-size:11px}.legend-item b{display:inline-grid;place-items:center;width:18px;height:18px;border:1px solid #bdb1a2;border-radius:50%;background:#fff9ef;color:#312a24}
.explanation{min-height:45px;margin:10px 0;padding-left:18px;color:#625a50;font-size:12px}
.review-controls{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px;padding-top:10px;border-top:1px solid #e5ddd2}.review-controls label{display:grid;gap:4px;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.review-controls select,.review-controls textarea{width:100%;border:1px solid #d2c8bb;border-radius:7px;background:#fff;padding:6px;color:var(--ink);font-size:12px;text-transform:none;resize:vertical}
.empty-state{display:none;text-align:center;padding:80px;color:var(--muted)}.empty-state.visible{display:block}
@media(max-width:1050px){.variant-grid{grid-template-columns:1fr}.page-header-inner{grid-template-columns:1fr}.quality-strip{grid-template-columns:1fr}.room-plan{max-height:520px}}
@media(max-width:680px){.page-header{padding-top:28px}.run-summary{grid-template-columns:1fr 1fr}.toolbar{position:relative}.case-card{padding:15px;border-radius:14px}.case-header{grid-template-columns:1fr}.case-status{justify-content:flex-start}.review-controls{grid-template-columns:1fr}.visible-count{width:100%;margin-left:0}.plan-frame{min-height:180px}}
@media print{.toolbar,.review-controls{display:none}.case-card{break-inside:avoid;box-shadow:none}.variant-grid{grid-template-columns:repeat(var(--variant-count),1fr)}body{background:#fff}main{max-width:none;padding:0}.page-header{padding:20px}}
`;

const scripts = `
const assetData = JSON.parse(document.getElementById("asset-data").textContent);
document.querySelectorAll("image[data-asset-key]").forEach((image) => {
  const source = assetData[image.dataset.assetKey];
  if (source) image.setAttribute("href", source);
});
const body = document.body;
const search = document.getElementById("filter-search");
const status = document.getElementById("filter-status");
const tag = document.getElementById("filter-tag");
const finding = document.getElementById("filter-finding");
const verdict = document.getElementById("filter-verdict");
const cards = Array.from(document.querySelectorAll(".case-card"));
const storageKey = "planner-room-lab-review-v1";
const savedReviews = JSON.parse(localStorage.getItem(storageKey) || "{}");
document.querySelectorAll(".review-controls").forEach((controls) => {
  const key = controls.dataset.reviewKey;
  const stored = savedReviews[key] || {};
  controls.querySelector(".review-verdict").value = stored.verdict || "";
  controls.querySelector(".review-note").value = stored.note || "";
});
function reviews() {
  const result = {};
  document.querySelectorAll(".review-controls").forEach((controls) => {
    const value = controls.querySelector(".review-verdict").value;
    const note = controls.querySelector(".review-note").value.trim();
    if (value || note) result[controls.dataset.reviewKey] = { verdict: value, note };
  });
  return result;
}
function persistReviews() {
  localStorage.setItem(storageKey, JSON.stringify(reviews()));
}
function applyFilters() {
  const query = search.value.trim().toLowerCase();
  let visible = 0;
  cards.forEach((card) => {
    const reviewValues = Array.from(card.querySelectorAll(".review-verdict")).map((entry) => entry.value);
    const matches = (!query || card.textContent.toLowerCase().includes(query))
      && (!status.value || card.dataset.status === status.value)
      && (!tag.value || card.dataset.tags.split("|").includes(tag.value))
      && (!finding.value || card.dataset.findings.split("|").includes(finding.value))
      && (!verdict.value || reviewValues.includes(verdict.value));
    card.hidden = !matches;
    if (matches) visible += 1;
  });
  document.getElementById("visible-count").textContent = visible + " из " + cards.length;
  document.getElementById("empty-state").classList.toggle("visible", visible === 0);
}
[search, status, tag, finding, verdict].forEach((control) => control.addEventListener("input", applyFilters));
document.getElementById("toggle-hard").addEventListener("change", (event) => body.classList.toggle("show-hard", event.target.checked));
document.getElementById("toggle-preferred").addEventListener("change", (event) => body.classList.toggle("show-preferred", event.target.checked));
document.getElementById("toggle-assets").addEventListener("change", (event) => body.classList.toggle("hide-assets", !event.target.checked));
document.querySelectorAll(".review-verdict,.review-note").forEach((control) => control.addEventListener("input", () => { persistReviews(); applyFilters(); }));
document.getElementById("download-reviews").addEventListener("click", () => {
  const entries = Object.entries(reviews()).map(([key, review]) => {
    const [caseId, variantId] = key.split(":");
    return { caseId, variantId, verdict: review.verdict || null, note: review.note || "" };
  });
  const payload = { schemaVersion: "planner-room-lab-review-draft-v1", generatedAt: new Date().toISOString(), reviews: entries };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + "\\n"], { type: "application/json" }));
  link.download = "planner-room-lab-review.json";
  link.click();
  URL.revokeObjectURL(link.href);
});
applyFilters();
`;

export const renderRoomLabContactSheet = (
    cases: RoomLabCase[],
    results: RoomLabCaseResult[],
    report: RoomLabReport,
    assetDataUrls: RoomLabAssetDataUrls = {},
): string => {
    const resultByCaseId = new Map(results.map((result) => [result.caseId, result]));
    const tags = Array.from(new Set(cases.flatMap((roomCase) => roomCase.tags))).sort();
    const findings = Array.from(
        new Set(results.flatMap((result) => result.findings.map((finding) => finding.code))),
    ).sort();
    const statuses = Array.from(new Set(results.map((result) => result.execution.status))).sort();
    const caseMarkup = cases
        .map((roomCase) => {
            const result = resultByCaseId.get(roomCase.id);
            if (!result) throw new Error(`Missing room-lab result for ${roomCase.id}.`);
            return renderCase(roomCase, result);
        })
        .join("");

    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Planner Room Lab · Contact Sheet</title>
<style>${styles}</style>
</head>
<body>
<header class="page-header"><div class="page-header-inner"><div><div class="eyebrow">StyleFinder · Room Lab</div><h1>Контактный лист планировок</h1><p>Все эталонные комнаты в одинаковом масштабе внутри строки. Автоматические флаги — повод посмотреть внимательнее, а не самостоятельный вердикт.</p></div><div class="run-summary"><div class="summary-cell"><b>${report.summary.passed}/${report.summary.total}</b><span>hard-green</span></div><div class="summary-cell"><b>${report.summary.casesWithFindings}</b><span>с замечаниями</span></div><div class="summary-cell"><b>${Math.round(report.summary.totalDurationMs / 100) / 10} c</b><span>время расчёта</span></div></div></div></header>
<nav class="toolbar" aria-label="Фильтры contact sheet"><div class="toolbar-inner">
<label class="control control-search">Поиск<input id="filter-search" type="search" placeholder="ID, название, мебель…"/></label>
<label class="control">Статус<select id="filter-status"><option value="">Все</option>${statuses.map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label>
<label class="control">Тег<select id="filter-tag"><option value="">Все</option>${tags.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
<label class="control">Finding<select id="filter-finding"><option value="">Все</option>${findings.map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label>
<label class="control">Вердикт<select id="filter-verdict"><option value="">Все</option><option value="good">Хорошо</option><option value="acceptable">Допустимо</option><option value="questionable">Спорно</option><option value="bad">Плохо</option></select></label>
<label class="toggle"><input id="toggle-assets" type="checkbox" checked/>Фото</label>
<label class="toggle"><input id="toggle-hard" type="checkbox"/>Hard-зоны</label>
<label class="toggle"><input id="toggle-preferred" type="checkbox"/>Preferred</label>
<button id="download-reviews" type="button">Скачать review JSON</button>
<span class="visible-count" id="visible-count"></span>
</div></nav>
<main>${caseMarkup}<div class="empty-state" id="empty-state">По текущим фильтрам комнат нет.</div></main>
<script id="asset-data" type="application/json">${jsonForInlineScript(assetDataUrls)}</script>
<script>${scripts}</script>
</body>
</html>
`;
};
