import { getFurniture, isSchematicFurnitureSource } from "./catalog";
import { getRotatedGeometry, getWorldBodyRects } from "./geometry";
import { validateRemovalRecords } from "./removal";
import {
    FurniturePriority,
    Placement,
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
    /** Flipped left to right before rotation, as on the drawing. */
    mirrored?: boolean;
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
    placements: (Placement & { roomName?: string; mirrored?: boolean })[];
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
    items: placements.map(({ roomName, mirrored, ...placement }) => ({
        ...toSpecificationItem(placement, "preferred"),
        ...(roomName ? { roomName } : {}),
        ...(mirrored ? { mirrored } : {}),
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
    )}.pdf`;
};

const WALL_LABELS: Record<Wall, string> = {
    top: "верх",
    right: "справа",
    bottom: "низ",
    left: "слева",
};

export const describeOpening = (
    type: "Дверь" | "Окно" | "Радиатор",
    wall: Wall,
    width: number,
    offset: number,
): string => `${type}: ${WALL_LABELS[wall]}, ${width} мм, отступ ${offset} мм`;
