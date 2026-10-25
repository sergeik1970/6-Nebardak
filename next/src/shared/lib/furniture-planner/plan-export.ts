import { getFurniture, isSchematicFurnitureSource } from "./catalog";
import { getPartitionObstacleRects, getRotatedGeometry, getWorldBodyRects } from "./geometry";
import { getDoorHeight, getWindowHeight, getWindowSillHeight } from "./opening-heights";
import { validateRemovalRecords } from "./removal";
import { getRoomSegment, getRoomVertices } from "./room-geometry";
import { getDrawRoomRegions } from "./room-regions";
import {
    FurniturePriority,
    Placement,
    RadiatorObstacle,
    Rect,
    RemovalRecord,
    Room,
    ValidationResult,
    Wall,
} from "./types";

export const PLAN_SPEC_SCHEMA_VERSION = "stylefinder-plan-spec-v3";
export const PLANNER_ALGORITHM_VERSION = "deterministic-layout-v4";

export interface PlanSpecificationItem {
    instanceId: string;
    definitionId: string;
    name: string;
    width: number;
    depth: number;
    priority: FurniturePriority;
    x: number;
    y: number;
    rotation: Placement["rotation"];
    bodyRects: Rect[];
    /** Drawing exports name the room each piece stands in. */
    roomName?: string;
}

export interface PlanSpecificationCheck {
    id: string;
    label: string;
    status: "passed";
}

export interface PlanSpecificationRemovedItem extends RemovalRecord {
    name: string;
    priority: FurniturePriority;
}

export interface PlanSpecification {
    schemaVersion: typeof PLAN_SPEC_SCHEMA_VERSION;
    algorithmVersion: typeof PLANNER_ALGORITHM_VERSION;
    catalogRevision: string;
    generatedAt: string;
    room: Room;
    items: PlanSpecificationItem[];
    removedItems: PlanSpecificationRemovedItem[];
    checks: PlanSpecificationCheck[];
    caveats: string[];
    /** A hand-made apartment drawing rather than a solved layout. */
    source?: "drawing";
}

interface BuildPlanSpecificationInput {
    room: Room;
    placements: Placement[];
    priorities: Record<string, FurniturePriority>;
    validation: ValidationResult;
    removedItems?: RemovalRecord[];
    caveats?: string[];
    generatedAt: string;
}

const RESULT_CHECKS: PlanSpecificationCheck[] = [
    {
        id: "inside-room",
        label: "Корпуса мебели находятся внутри границ комнаты",
        status: "passed",
    },
    {
        id: "body-gap",
        label: "Между корпусами мебели сохранён зазор не менее 50 мм",
        status: "passed",
    },
    {
        id: "openings",
        label: "Дверные проёмы, перегородки, открывание и зоны радиаторов не перекрыты",
        status: "passed",
    },
    {
        id: "wall-contact",
        label: "Обязательное примыкание мебели к стенам соблюдено",
        status: "passed",
    },
    {
        id: "relations",
        label: "Заданные связи между предметами и направление ТВ соблюдены",
        status: "passed",
    },
];

const uniqueNonEmpty = (values: Array<string | null | undefined>): string[] =>
    Array.from(
        new Set(
            values
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter(Boolean),
        ),
    );

const getCatalogSourceRevision = (definitionId: string): string => {
    const { source } = getFurniture(definitionId);

    if (isSchematicFurnitureSource(source)) {
        return `${source.kind}:${source.version}`;
    }

    return `${source.versionPolicy}:${source.drawing.sha256.slice(0, 16)}:${source.rules.sha256.slice(
        0,
        16,
    )}`;
};

const toSpecificationItem = (
    placement: Placement,
    priority: FurniturePriority,
): PlanSpecificationItem => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation, placement);
    return {
        instanceId: placement.instanceId,
        definitionId: placement.definitionId,
        name: definition.shortLabel,
        width: geometry.width,
        depth: geometry.depth,
        priority,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        bodyRects: getWorldBodyRects(placement).map((rect) => ({ ...rect })),
    };
};

/** What the drawing editor enforces for every piece it accepts. */
const DRAWING_CHECKS: PlanSpecificationCheck[] = [
    {
        id: "inside-room",
        label: "Каждый предмет стоит внутри своей комнаты и не заходит в стены",
        status: "passed",
    },
    {
        id: "body-overlap",
        label: "Корпуса не пересекаются; навесные шкафы висят над напольными",
        status: "passed",
    },
    {
        id: "openings",
        label: "Проходы у дверей, открывание и зоны радиаторов свободны",
        status: "passed",
    },
];

interface BuildDrawingPlanSpecificationInput {
    room: Room;
    placements: (Placement & { roomName?: string })[];
    /** Pieces the editor currently flags; their presence voids the checks. */
    conflictCount: number;
    caveats?: string[];
    generatedAt: string;
}

/**
 * The result document of a hand-made drawing. Unlike a solved layout it
 * claims only what the editor checks, and only while no piece conflicts.
 */
export const buildDrawingPlanSpecification = ({
    room,
    placements,
    conflictCount,
    caveats = [],
    generatedAt,
}: BuildDrawingPlanSpecificationInput): PlanSpecification => ({
    ...buildPlanSpecification({
        room,
        placements: [],
        priorities: {},
        validation: { valid: true, issues: [] },
        generatedAt,
    }),
    catalogRevision:
        uniqueNonEmpty(placements.map((item) => getCatalogSourceRevision(item.definitionId))).join(
            ", ",
        ) || "unversioned",
    items: placements.map(({ roomName, ...placement }) => ({
        ...toSpecificationItem(placement, "preferred"),
        ...(roomName ? { roomName } : {}),
    })),
    checks: conflictCount === 0 ? DRAWING_CHECKS.map((check) => ({ ...check })) : [],
    caveats: uniqueNonEmpty([
        ...(conflictCount > 0
            ? [
                  `На плане ${conflictCount} ${conflictCount === 1 ? "предмет конфликтует" : "предмета конфликтуют"} со стенами, проходами или другой мебелью — проверки не пройдены.`,
              ]
            : []),
        "Размеры мебели — типовые, сверяйте их с выбранными моделями перед покупкой.",
        ...caveats,
    ]),
    source: "drawing",
});

export const buildPlanSpecification = ({
    room,
    placements,
    priorities,
    validation,
    removedItems = [],
    caveats = [],
    generatedAt,
}: BuildPlanSpecificationInput): PlanSpecification => {
    if (!validation.valid) {
        throw new Error("Нельзя сформировать спецификацию для невалидной расстановки.");
    }

    const removalValidation = validateRemovalRecords(removedItems);
    if (removalValidation.status === "invalid") {
        throw new Error(`Нельзя сформировать спецификацию: ${removalValidation.message}`);
    }
    const placedInstanceIds = new Set(placements.map((placement) => placement.instanceId));
    if (removalValidation.value.some((record) => placedInstanceIds.has(record.instanceId))) {
        throw new Error(
            "Нельзя сформировать спецификацию: удалённый предмет всё ещё присутствует на плане.",
        );
    }

    const catalogRevisions = uniqueNonEmpty(
        [...placements, ...removalValidation.value].map((item) =>
            getCatalogSourceRevision(item.definitionId),
        ),
    );

    return {
        schemaVersion: PLAN_SPEC_SCHEMA_VERSION,
        algorithmVersion: PLANNER_ALGORITHM_VERSION,
        catalogRevision: catalogRevisions.join(", ") || "unversioned",
        generatedAt,
        room: {
            ...room,
            ...(room.geometry?.kind === "orthogonal"
                ? {
                      geometry: {
                          ...room.geometry,
                          vertices: room.geometry.vertices.map((vertex) => ({ ...vertex })),
                      },
                  }
                : room.geometry
                  ? { geometry: { ...room.geometry } }
                  : {}),
            doors: room.doors.map((door) => ({ ...door })),
            partitions: room.partitions?.map((partition) => ({
                ...partition,
                start: { ...partition.start },
                end: { ...partition.end },
            })),
            windows: room.windows.map((window) => ({ ...window })),
            radiators: (room.radiators ?? []).map((radiator) => ({ ...radiator })),
            ...(room.regions
                ? {
                      regions: {
                          version: 1,
                          items: room.regions.items.map((item) => ({ ...item })),
                      },
                  }
                : {}),
        },
        items: placements.map((placement) =>
            toSpecificationItem(placement, priorities[placement.definitionId] ?? "preferred"),
        ),
        removedItems: removalValidation.value.map((record) => ({
            ...record,
            name: getFurniture(record.definitionId).shortLabel,
            priority: record.priority ?? priorities[record.definitionId] ?? "preferred",
        })),
        checks: RESULT_CHECKS.map((check) => ({ ...check })),
        caveats: uniqueNonEmpty(caveats),
    };
};

const pad = (value: number): string => String(value).padStart(2, "0");

export const getPlanExportFilename = (generatedAt: string): string => {
    const parsed = new Date(generatedAt);
    const date = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;

    return `stylefinder-plan-${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
        date.getUTCDate(),
    )}.png`;
};

const PRIORITY_LABELS: Record<FurniturePriority, string> = {
    required: "обязательно",
    preferred: "желательно",
    optional: "необязательно",
};

const WALL_LABELS: Record<Wall, string> = {
    top: "верх",
    right: "справа",
    bottom: "низ",
    left: "слева",
};

const DOOR_KIND_LABELS = {
    room: "распашная",
    balcony: "балконная",
    "swing-double": "двустворчатая распашная",
    "sliding-single": "раздвижная",
    "sliding-double": "двухстворчатая раздвижная",
} as const;

const drawWrappedText = (
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
): number => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";

    words.forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    });
    if (line) lines.push(line);

    lines.forEach((entry, index) => context.fillText(entry, x, y + index * lineHeight));

    return Math.max(lineHeight, lines.length * lineHeight);
};

const drawOpening = (
    context: CanvasRenderingContext2D,
    opening: { wall: Wall; segmentId?: string; offset: number; width: number },
    room: Room,
    originX: number,
    originY: number,
    scale: number,
    color: string,
) => {
    const segment = getRoomSegment(room, opening);
    if (!segment) return;
    const tangentX = (segment.end.x - segment.start.x) / segment.length;
    const tangentY = (segment.end.y - segment.start.y) / segment.length;
    const start = {
        x: segment.start.x + tangentX * opening.offset,
        y: segment.start.y + tangentY * opening.offset,
    };
    const end = {
        x: segment.start.x + tangentX * (opening.offset + opening.width),
        y: segment.start.y + tangentY * (opening.offset + opening.width),
    };
    context.strokeStyle = color;
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(originX + start.x * scale, originY + start.y * scale);
    context.lineTo(originX + end.x * scale, originY + end.y * scale);
    context.stroke();
};

const drawRadiator = (
    context: CanvasRenderingContext2D,
    radiator: RadiatorObstacle,
    room: Room,
    originX: number,
    originY: number,
    scale: number,
) => {
    drawOpening(context, radiator, room, originX, originY, scale, "#a65345");
};

/**
 * Creates a client-side PNG directly from domain geometry. Editor controls,
 * clearance overlays and transient validation notices are intentionally not
 * part of this renderer, so the exported file is a clean result document.
 */
export const renderPlanSpecificationPng = async (
    specification: PlanSpecification,
): Promise<Blob> => {
    if (typeof document === "undefined") {
        throw new Error("Экспорт PNG доступен только в браузере.");
    }

    const canvas = document.createElement("canvas");
    const width = 1600;
    const itemRowsHeight = Math.max(1, specification.items.length) * 44;
    const removedRowsHeight =
        specification.removedItems.length > 0 ? 70 + specification.removedItems.length * 180 : 0;
    const caveatHeight = Math.max(1, specification.caveats.length) * 54;
    const regionRows = getDrawRoomRegions(specification.room).length;
    const openingRows =
        specification.room.doors.length +
        specification.room.windows.length +
        (specification.room.radiators?.length ?? 0) +
        (specification.room.partitions?.length ?? 0);
    canvas.width = width;
    canvas.height =
        1450 + itemRowsHeight + removedRowsHeight + caveatHeight + (openingRows + regionRows) * 32;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог подготовить изображение.");

    context.fillStyle = "#f6efe2";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#2f2a24";
    context.font = "700 44px Georgia, serif";
    const drawing = specification.source === "drawing";
    context.fillText(
        drawing ? "StyleFinder · план квартиры" : "StyleFinder · план комнаты",
        80,
        78,
    );
    context.font = "24px Arial, sans-serif";
    context.fillStyle = "#6f6559";
    context.fillText(
        `${specification.room.width} × ${specification.room.depth} мм · ${specification.items.length} на плане${
            specification.removedItems.length > 0
                ? ` · ${specification.removedItems.length} удалено`
                : ""
        }`,
        80,
        120,
    );
    context.textAlign = "right";
    context.fillText(
        `Сформировано ${specification.generatedAt.replace("T", " ").replace(".000Z", " UTC")}`,
        1520,
        120,
    );
    context.textAlign = "left";

    const planX = 80;
    const planY = 165;
    const planMaxWidth = 1440;
    const planMaxHeight = 650;
    const scale = Math.min(
        planMaxWidth / specification.room.width,
        planMaxHeight / specification.room.depth,
    );
    const roomWidth = specification.room.width * scale;
    const roomDepth = specification.room.depth * scale;

    const roomVertices = getRoomVertices(specification.room);
    context.beginPath();
    roomVertices.forEach((vertex, index) => {
        const x = planX + vertex.x * scale;
        const y = planY + vertex.y * scale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = "#fffaf1";
    context.fill();
    context.strokeStyle = "#4e473f";
    context.lineWidth = 8;
    context.stroke();

    context.fillStyle = "#5a5145";
    getPartitionObstacleRects(specification.room).forEach((partition) => {
        context.fillRect(
            planX + partition.x * scale,
            planY + partition.y * scale,
            partition.width * scale,
            partition.depth * scale,
        );
    });

    specification.room.windows.forEach((window) =>
        drawOpening(context, window, specification.room, planX, planY, scale, "#4d91a6"),
    );
    specification.room.doors.forEach((door) =>
        drawOpening(context, door, specification.room, planX, planY, scale, "#d17c45"),
    );
    (specification.room.radiators ?? []).forEach((radiator) =>
        drawRadiator(context, radiator, specification.room, planX, planY, scale),
    );

    // Upper kitchen units overlie the base run: drawn last, dashed and see-through.
    const isUpper = (item: PlanSpecificationItem) =>
        getFurniture(item.definitionId).mounting === "upper";
    const drawingOrder = [...specification.items].sort(
        (first, second) => Number(isUpper(first)) - Number(isUpper(second)),
    );
    drawingOrder.forEach((item, index) => {
        const palette = ["#dfb77b", "#c8a989", "#afc2b5", "#d4b8ae"];
        const upper = isUpper(item);
        context.fillStyle = upper ? "rgba(255, 253, 248, 0.55)" : palette[index % palette.length];
        context.strokeStyle = "#6f5540";
        context.lineWidth = 2;
        context.setLineDash(upper ? [8, 6] : []);
        item.bodyRects.forEach((rect) => {
            const x = planX + rect.x * scale;
            const y = planY + rect.y * scale;
            const rectWidth = rect.width * scale;
            const rectDepth = rect.depth * scale;
            context.fillRect(x, y, rectWidth, rectDepth);
            context.strokeRect(x, y, rectWidth, rectDepth);
        });
        context.setLineDash([]);
        context.save();
        context.beginPath();
        context.rect(
            planX + item.x * scale,
            planY + item.y * scale,
            item.width * scale,
            item.depth * scale,
        );
        context.clip();
        context.fillStyle = "#2f2a24";
        context.font = "600 17px Arial, sans-serif";
        context.fillText(item.name, planX + item.x * scale + 8, planY + item.y * scale + 24);
        context.restore();
    });

    let cursorY = planY + roomDepth + 72;
    context.fillStyle = "#2f2a24";
    context.font = "700 28px Georgia, serif";
    context.fillText("Помещения, проёмы и отопление", 80, cursorY);
    cursorY += 40;
    context.font = "19px Arial, sans-serif";
    const openingDescriptions = [
        ...getDrawRoomRegions(specification.room).map(
            (region) =>
                `${region.name}: ${(region.areaSquareMillimeters / 1_000_000).toLocaleString(
                    "ru-RU",
                    {
                        maximumFractionDigits: 2,
                    },
                )} м²`,
        ),
        ...(specification.room.partitions ?? []).map(
            (partition, index) =>
                `Перегородка ${index + 1}: ${Math.abs(partition.end.x - partition.start.x) + Math.abs(partition.end.y - partition.start.y)} мм, толщина ${partition.thickness} мм`,
        ),
        ...specification.room.doors.map(
            (door, index) =>
                `${door.partitionId ? "Дверь в перегородке" : "Дверь"} ${index + 1}: ${door.partitionId ? "внутренний проём" : WALL_LABELS[door.wall]}, ширина ${door.width} мм, высота ${getDoorHeight(door)} мм, отступ ${door.offset} мм, ${
                    door.partitionId
                        ? `открывается по выбранной стороне на ${door.clearanceDepth} мм`
                        : (door.swingDirection ?? "inward") === "inward"
                          ? `открывается в комнату на ${door.clearanceDepth} мм`
                          : "открывается наружу"
                } · ${DOOR_KIND_LABELS[door.doorKind ?? "room"]}`,
        ),
        ...specification.room.windows.map(
            (window, index) =>
                `${window.windowKind === "floor-to-ceiling" ? "Панорамное окно" : "Окно"} ${index + 1}: ${WALL_LABELS[window.wall]}, ширина ${window.width} мм, высота ${getWindowHeight(window)} мм${window.windowKind === "floor-to-ceiling" ? "" : `, подоконник ${getWindowSillHeight(window)} мм`}, отступ ${window.offset} мм`,
        ),
        ...(specification.room.radiators ?? []).map(
            (radiator, index) =>
                `Радиатор ${index + 1}: ${WALL_LABELS[radiator.wall]}, ширина ${radiator.width} мм, отступ ${radiator.offset} мм, свободная зона ${radiator.clearanceDepth} мм`,
        ),
    ];
    openingDescriptions.forEach((description) => {
        cursorY += drawWrappedText(context, `• ${description}`, 80, cursorY, 1440, 26) + 5;
    });
    cursorY += 28;
    context.font = "700 28px Georgia, serif";
    context.fillText("Спецификация", 80, cursorY);
    cursorY += 42;
    context.font = "600 18px Arial, sans-serif";
    context.fillStyle = "#6f6559";
    context.fillText("Предмет", 80, cursorY);
    context.fillText("Размер", 650, cursorY);
    context.fillText(drawing ? "Помещение" : "Приоритет", 850, cursorY);
    context.fillText("Координаты и поворот", 1080, cursorY);
    cursorY += 32;

    context.font = "19px Arial, sans-serif";
    specification.items.forEach((item) => {
        context.fillStyle = "#2f2a24";
        context.fillText(item.name, 80, cursorY);
        context.fillText(`${item.width} × ${item.depth} мм`, 650, cursorY);
        context.fillText(
            drawing ? item.roomName ?? "—" : PRIORITY_LABELS[item.priority],
            850,
            cursorY,
        );
        context.fillText(`X ${item.x}, Y ${item.y}, ${item.rotation}°`, 1080, cursorY);
        context.strokeStyle = "#dccfbe";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(80, cursorY + 13);
        context.lineTo(1520, cursorY + 13);
        context.stroke();
        cursorY += 44;
    });

    if (specification.removedItems.length > 0) {
        cursorY += 28;
        context.fillStyle = "#2f2a24";
        context.font = "700 28px Georgia, serif";
        context.fillText("Удалено из проекта", 80, cursorY);
        cursorY += 40;
        context.font = "19px Arial, sans-serif";
        specification.removedItems.forEach((item) => {
            context.fillStyle = "#2f2a24";
            context.font = "600 19px Arial, sans-serif";
            context.fillText(
                `${item.name} · ${PRIORITY_LABELS[item.priority]} · ${item.method === "automatic" ? "по предложению планировщика" : "вручную"}`,
                80,
                cursorY,
            );
            context.font = "17px Arial, sans-serif";
            context.fillStyle = "#6f6559";
            cursorY += 26;
            cursorY += drawWrappedText(context, item.reason, 80, cursorY, 1150, 23);
            context.fillText(
                item.removedAt.replace("T", " ").replace(".000Z", " UTC"),
                1260,
                cursorY - 23,
            );
            cursorY += 20;
        });
    }

    cursorY += 28;
    context.fillStyle = "#2f2a24";
    context.font = "700 28px Georgia, serif";
    context.fillText("Проверено", 80, cursorY);
    cursorY += 38;
    context.font = "19px Arial, sans-serif";
    if (!specification.checks.length) {
        context.fillText(
            "— Исправьте отмеченные предметы, чтобы план прошёл проверки.",
            80,
            cursorY,
        );
        cursorY += 32;
    }
    specification.checks.forEach((check) => {
        context.fillText(`✓ ${check.label}`, 80, cursorY);
        cursorY += 32;
    });

    cursorY += 20;
    context.font = "700 24px Georgia, serif";
    context.fillText("Ограничения и допущения", 80, cursorY);
    cursorY += 34;
    context.font = "18px Arial, sans-serif";
    const caveats = specification.caveats.length
        ? specification.caveats
        : ["Дополнительных оговорок для этого варианта нет."];
    caveats.forEach((caveat) => {
        cursorY += drawWrappedText(context, `• ${caveat}`, 80, cursorY, 1440, 25);
        cursorY += 8;
    });

    context.fillStyle = "#6f6559";
    context.font = "16px Arial, sans-serif";
    context.fillText(
        `Алгоритм ${specification.algorithmVersion} · схема ${specification.schemaVersion} · каталог ${specification.catalogRevision}`,
        80,
        canvas.height - 42,
    );

    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Браузер не смог сохранить изображение PNG."));
        }, "image/png");
    });
};

export const describeOpening = (
    type: "Дверь" | "Окно" | "Радиатор",
    wall: Wall,
    width: number,
    offset: number,
): string => `${type}: ${WALL_LABELS[wall]}, ${width} мм, отступ ${offset} мм`;
