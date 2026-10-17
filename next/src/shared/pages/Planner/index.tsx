import { drawingBlockingIssues } from "@/shared/lib/furniture-planner/draw-furniture-handoff";
import FurniturePhoto from "@/shared/components/FurniturePhoto";
import { getFurniturePhoto } from "@/shared/lib/furniture-planner/furniture-photos";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthEnabled, isBetaBadgeEnabled } from "@/shared/config/runtime";
import {
    plannerObservationService,
    type PlannerObservationCreateInput,
    type PlannerObservationResponse,
    type PlannerObservationVerdict,
} from "@/services/plannerObservationService";
import {
    createPlannerObservationRequests,
    WORKING_CORE_OBSERVATION_ID,
} from "./planner-observation";
import {
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    MANUAL_REMOVAL_REASON,
    DoorOpening,
    DesignLabFeedbackEntry,
    DesignLabVerdict,
    FURNITURE_CATALOG,
    FurnitureDefinition,
    FurnitureInstance,
    FurniturePriority,
    LayoutFailure,
    LayoutPreferences,
    LayoutResult,
    LayoutSuccess,
    LayoutVariant,
    MIN_ORTHOGONAL_SEGMENT_MM,
    MIN_CONNECTED_PASSAGE_WIDTH,
    Placement,
    PlanSpecification,
    RadiatorObstacle,
    Room,
    RoomBoundarySegment,
    RoomVertex,
    RemovalRecord,
    Wall,
    WindowOpening,
    buildFurnitureInstances,
    buildFurnitureInstancesExcludingRemoved,
    buildAutomaticRemovalReason,
    buildPrioritizedFurnitureSelection,
    buildPlanSpecification,
    canRedoPlacementHistory,
    canUndoPlacementHistory,
    alignStarterOpeningsToRoom,
    createDefaultRoom,
    createLRoomGeometry,
    applyRoomGeometry,
    createPlacementHistory,
    createRemovalRecord,
    explainLayoutForProfile,
    getDoorObstacle,
    getDoorSwingObstacle,
    getPartitionObstacleRects,
    getRoomBoundarySegments,
    getRoomPartitionSegments,
    getRoomArea,
    getLRoomNotch,
    getRoomSegment,
    getRoomVertices,
    getFurniture,
    getFurnitureAsset,
    getMaximumFurnitureCount,
    getPlanExportFilename,
    getRestoredRemovalRecordIds,
    getRadiatorBody,
    getRadiatorServiceObstacle,
    getRotatedGeometry,
    getWorldClearanceRects,
    projectPointToSegmentOffset,
    moveOrthogonalRoomVertex,
    splitOrthogonalRoomSegment,
    isSchematicFurnitureSource,
    QuestionnairePlannerInputV1,
    StyleFinderProjectDraft,
    createProjectDraft,
    readQuestionnairePlannerHandoff,
    readDrawRoomDraft,
    readProjectDraft,
    redoPlacementHistory,
    renderPlanSpecificationPng,
    resetProjectDraft,
    resetPlacementHistory,
    tryResizeRoomWithDefaultOpenings,
    saveProjectDraft,
    solveRoom,
    pushPlacementHistory,
    mergeRemovalRecords,
    reconcileRemovalRecordsWithPlacements,
    reconcileSelectionWithPlacementHistory,
    undoPlacementHistory,
    validateLayout,
    validatePlacement,
    validateProjectDraftLayout,
    validateRoomGeometry,
} from "@/shared/lib/furniture-planner";
import type {
    SolverWorkerRequest,
    SolverWorkerResponse,
} from "@/shared/lib/furniture-planner/solver.worker";
import {
    buildPlannerSelectionSignature as selectionSignature,
    canApplyAutomaticRemovalProposal,
    layoutMatchesFurnitureInstances,
    shouldShowPlannerLayout,
} from "./planner-state";
import { buildPlannerCaveats } from "./presentation";
import RemovalConfirmationDialog from "./RemovalConfirmationDialog";
import styles from "./index.module.scss";

type PlannerPhase = "ready" | "solving" | "result";
type Selection = Record<string, number>;
type WorkspaceTool = "room" | "furniture" | "inspection";
type CatalogFilter = "all" | "selected" | FurnitureDefinition["category"];
interface PlannerProps {
    /** undefined while the router hydrates, null for a direct planner visit. */
    handoffId?: string | null;
    /** A validated room drafted in the separate full-screen editor. */
    drawRoomDraft?: boolean;
}

interface HandoffBaseline {
    selection: Selection;
    priorities: Record<string, FurniturePriority>;
    tvTargetCategory?: "sleep" | "living";
    itemCount: number;
    styleKey?: string;
    styleLabel?: string;
}

interface HandoffSourceState extends HandoffBaseline {
    modified: boolean;
    origin: "questionnaire" | "draft";
}

interface AutomaticRemovalProposal {
    result: LayoutSuccess;
    removedItems: RemovalRecord[];
    signature: string;
}

type ObservationSaveState = "idle" | "saving" | "saved" | "failed";

interface ObservationReviewDraft {
    verdict: PlannerObservationVerdict;
    comment: string;
}

const CATALOG_FILTERS: ReadonlyArray<{ value: CatalogFilter; label: string }> = [
    { value: "all", label: "Все" },
    { value: "selected", label: "Выбрано" },
    ...CATEGORY_ORDER.map((category) => ({
        value: category,
        label: CATEGORY_LABELS[category],
    })),
];

const EMPTY_OBSERVATION_REVIEW: ObservationReviewDraft = {
    verdict: "needs-fix",
    comment: "",
};

type SolverWorkerPayload = SolverWorkerRequest extends infer Request
    ? Request extends { requestId: number }
        ? Omit<Request, "requestId">
        : never
    : never;

interface ActiveSolverWorker {
    requestId: number;
    worker: Worker;
    reject: (reason: Error) => void;
}

const SOLVER_CANCELLED = "solver-request-cancelled";
const SOLVER_ERROR_NOTICE = "Не удалось выполнить расчёт. Попробуйте ещё раз.";
const DIRECT_PLANNER_SENTINEL = "__direct_planner__";
const GRID_MM = 50;
const UNPLACED_FURNITURE_DRAG_TYPE = "application/x-stylefinder-unplaced-furniture";
const UNPLACED_FURNITURE_DRAG_TEXT_PREFIX = "stylefinder-unplaced:";
const MIN_ROOM_MM = 2400;
const MAX_ROOM_MM = 10000;
const WALL_LABELS: Record<Wall, string> = {
    top: "Сверху",
    right: "Справа",
    bottom: "Снизу",
    left: "Слева",
};
const WALLS = Object.keys(WALL_LABELS) as Wall[];

const DEFAULT_SELECTION: Selection = {
    "double-bed": 1,
    "wardrobe-medium": 1,
    desk: 1,
    "bedside-table": 1,
};
const DEFAULT_PRIORITIES: Record<string, FurniturePriority> = {
    "double-bed": "required",
    "wardrobe-medium": "required",
    desk: "required",
    "bedside-table": "required",
};
const DEFAULT_PREFERENCES: LayoutPreferences = {};

const DEFAULT_ROOM = createDefaultRoom(6000, 4600);
const PRESETS = [
    { label: "Компактная", width: 4200, depth: 3400 },
    { label: "Стандарт", width: 6000, depth: 4600 },
    { label: "Просторная", width: 7200, depth: 5200 },
];

const BED_IDS = ["single-bed", "double-bed"];
const SOFA_IDS = ["sofa-two", "sofa-three", "sofa-four-left"];
const WARDROBE_IDS = ["wardrobe-small", "wardrobe-medium", "wardrobe-large"];

const deriveRequiredDefinitionIds = (
    selection: Selection,
    priorities: Record<string, FurniturePriority>,
): Set<string> =>
    new Set(
        Object.entries(selection)
            .filter(([definitionId, count]) => count > 0 && priorities[definitionId] === "required")
            .map(([definitionId]) => definitionId),
    );

const getLayoutPreferences = (
    selection: Selection,
    requestedTarget?: "sleep" | "living",
): LayoutPreferences => {
    const hasTv = (selection.tv ?? 0) > 0;
    const hasBed = BED_IDS.some((id) => (selection[id] ?? 0) > 0);
    const hasSofa = SOFA_IDS.some((id) => (selection[id] ?? 0) > 0);
    if (!hasTv) return {};
    if (hasBed && !hasSofa) return { tvTargetCategory: "sleep" };
    if (hasSofa && !hasBed) return { tvTargetCategory: "living" };
    return requestedTarget ? { tvTargetCategory: requestedTarget } : {};
};

const getSelectionLimit = (definitionId: string, selection: Selection): number => {
    const definitionLimit = getMaximumFurnitureCount(definitionId);

    if (!WARDROBE_IDS.includes(definitionId)) return definitionLimit;

    const otherWardrobes = WARDROBE_IDS.filter((id) => id !== definitionId).reduce(
        (sum, id) => sum + (selection[id] ?? 0),
        0,
    );

    return Math.max(0, Math.min(definitionLimit, 2 - otherWardrobes));
};

const initialInstances = buildFurnitureInstances(
    buildPrioritizedFurnitureSelection(DEFAULT_SELECTION, DEFAULT_PRIORITIES),
);
const initialResult = solveRoom(DEFAULT_ROOM, initialInstances, DEFAULT_PREFERENCES);

const snapToGrid = (value: number) => Math.round(value / GRID_MM) * GRID_MM;
const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);
const normalizeRotation = (value: number) => ((value % 360) + 360) % 360;

// The plan needs a small drawing-frame margin for rulers and direct-edit handles.
// Keep these values in sync with .planZoomSurface so the fitted view never relies
// on clipping those controls.
const PLAN_FIT_FRAME_HORIZONTAL_PX = 70;
const PLAN_FIT_FRAME_VERTICAL_PX = 64;
const PLAN_FIT_EDITOR_FRAME_HORIZONTAL_PX = 132;
const PLAN_FIT_EDITOR_FRAME_VERTICAL_PX = 186;
// A mouse needs no 44px touch targets: the handles shrink and so do these lanes.
const PLAN_FIT_POINTER_EDITOR_FRAME_HORIZONTAL_PX = 85;
const PLAN_FIT_POINTER_EDITOR_FRAME_VERTICAL_PX = 124;
const POINTER_EDITOR_MEDIA_QUERY = "(min-width: 1060px) and (pointer: fine)";
const PLAN_FIT_OFFSCREEN_HEIGHT_PX = 280;
const PLAN_FIT_VIEWPORT_BOTTOM_GAP = 24;
/** The plan viewport's 1px focus-safe padding on both sides, plus rounding room. */
const PLAN_FIT_VIEWPORT_INSET_PX = 4;
// A fit is only meaningful once there is actual space left for the room.  In
// particular, do not trade the room itself for editor control lanes when the
// board is temporarily below the browser fold.
const PLAN_FIT_MINIMUM_ROOM_CONTENT_PX = 120;
/** Half the width of a wall length label such as "10.00 м" in the room editor. */
const WALL_DIMENSION_HALF_LENGTH_PX = 28;

interface DraftNumberInputProps
    extends Omit<
        React.InputHTMLAttributes<HTMLInputElement>,
        "type" | "value" | "min" | "max" | "step" | "inputMode" | "onChange" | "onBlur"
    > {
    value: number;
    min: number;
    max: number;
    step: number;
    onCommit: (value: number) => void;
}

const NUMBER_DRAFT_PATTERN = /^\d*(?:[.,]\d*)?$/;
const formatDraftNumber = (value: number) => String(Number(value.toFixed(6))).replace(".", ",");
const parseDraftNumber = (value: string) => Number(value.replace(",", "."));
const getDecimalPlaces = (value: number) => {
    const [, decimals = ""] = String(value).split(".");
    return decimals.length;
};
const normalizeDraftNumber = (value: number, minimum: number, maximum: number, step: number) => {
    const bounded = clamp(value, minimum, maximum);
    const snapped = minimum + Math.round((bounded - minimum) / step) * step;
    const precision = Math.min(6, Math.max(getDecimalPlaces(minimum), getDecimalPlaces(step)));
    return clamp(Number(snapped.toFixed(precision)), minimum, maximum);
};

const DraftNumberInput: React.FC<DraftNumberInputProps> = ({
    value,
    min,
    max,
    step,
    onCommit,
    onFocus,
    onKeyDown,
    ...inputProps
}) => {
    const effectiveMax = Math.max(min, max);
    const [draft, setDraft] = useState(() => formatDraftNumber(value));
    const [isEditing, setIsEditing] = useState(false);
    const cancelOnBlur = useRef(false);

    useEffect(() => {
        if (!isEditing) setDraft(formatDraftNumber(value));
    }, [isEditing, value]);

    useEffect(() => {
        if (!isEditing || draft === "") return;
        const parsed = parseDraftNumber(draft);
        if (Number.isFinite(parsed) && parsed > effectiveMax) {
            setDraft(formatDraftNumber(effectiveMax));
        }
    }, [draft, effectiveMax, isEditing]);

    const commit = () => {
        setIsEditing(false);

        if (cancelOnBlur.current) {
            cancelOnBlur.current = false;
            setDraft(formatDraftNumber(value));
            return;
        }

        const parsed = parseDraftNumber(draft);
        if (draft.trim() === "" || !Number.isFinite(parsed)) {
            setDraft(formatDraftNumber(value));
            return;
        }

        const normalized = normalizeDraftNumber(parsed, min, effectiveMax, step);
        setDraft(formatDraftNumber(normalized));
        onCommit(normalized);
    };

    return (
        <input
            {...inputProps}
            type="text"
            inputMode="decimal"
            value={draft}
            onFocus={(event) => {
                setIsEditing(true);
                setDraft(formatDraftNumber(value));
                onFocus?.(event);
            }}
            onChange={(event) => {
                const nextDraft = event.target.value;
                if (!NUMBER_DRAFT_PATTERN.test(nextDraft)) return;

                const parsed = parseDraftNumber(nextDraft);
                if (nextDraft !== "" && Number.isFinite(parsed) && parsed > effectiveMax) return;
                setDraft(nextDraft);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelOnBlur.current = true;
                    setDraft(formatDraftNumber(value));
                    event.currentTarget.blur();
                }
                onKeyDown?.(event);
            }}
            data-min={min}
            data-max={effectiveMax}
            data-step={step}
        />
    );
};

const clientPointToRoomMm = (
    element: HTMLDivElement,
    room: Room,
    clientX: number,
    clientY: number,
) => {
    const rect = element.getBoundingClientRect();
    const innerLeft = rect.left + element.clientLeft;
    const innerTop = rect.top + element.clientTop;

    return {
        x: ((clientX - innerLeft) / Math.max(element.clientWidth, 1)) * room.width,
        y: ((clientY - innerTop) / Math.max(element.clientHeight, 1)) * room.depth,
    };
};

const readUnplacedFurnitureDragInstanceId = (dataTransfer: DataTransfer) => {
    const typedInstanceId = dataTransfer.getData(UNPLACED_FURNITURE_DRAG_TYPE);
    if (typedInstanceId) return typedInstanceId;

    const plainText = dataTransfer.getData("text/plain");
    return plainText.startsWith(UNPLACED_FURNITURE_DRAG_TEXT_PREFIX)
        ? plainText.slice(UNPLACED_FURNITURE_DRAG_TEXT_PREFIX.length)
        : "";
};

const findNearestValidManualPlacement = (
    desiredPlacement: Placement,
    room: Room,
    existingPlacements: Placement[],
    preferences: LayoutPreferences,
): Placement | null => {
    const geometry = getRotatedGeometry(
        getFurniture(desiredPlacement.definitionId),
        desiredPlacement.rotation,
        desiredPlacement,
    );
    const maxX = Math.max(0, Math.floor((room.width - geometry.width) / GRID_MM) * GRID_MM);
    const maxY = Math.max(0, Math.floor((room.depth - geometry.depth) / GRID_MM) * GRID_MM);
    const searchedCoordinates = new Set<string>();

    for (let radius = 0; radius <= 20; radius += 1) {
        const candidates: Placement[] = [];

        for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
            for (let deltaY = -radius; deltaY <= radius; deltaY += 1) {
                if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) !== radius) continue;

                const candidate: Placement = {
                    ...desiredPlacement,
                    x: clamp(desiredPlacement.x + deltaX * GRID_MM, 0, maxX),
                    y: clamp(desiredPlacement.y + deltaY * GRID_MM, 0, maxY),
                };
                const coordinateKey = `${candidate.x}:${candidate.y}`;
                if (searchedCoordinates.has(coordinateKey)) continue;
                searchedCoordinates.add(coordinateKey);
                candidates.push(candidate);
            }
        }

        candidates.sort(
            (first, second) =>
                Math.hypot(first.x - desiredPlacement.x, first.y - desiredPlacement.y) -
                Math.hypot(second.x - desiredPlacement.x, second.y - desiredPlacement.y),
        );
        const validCandidate = candidates.find(
            (candidate) =>
                validatePlacement(candidate, room, existingPlacements).valid &&
                validateLayout(room, [...existingPlacements, candidate], preferences).valid,
        );
        if (validCandidate) return validCandidate;
    }

    return null;
};
const wallLength = (room: Room, wall: Wall, segmentId?: string, partitionId?: string) =>
    getRoomSegment(room, { wall, segmentId, partitionId })?.length ??
    (wall === "top" || wall === "bottom" ? room.width : room.depth);
const perpendicularWallLength = (room: Room, wall: Wall) =>
    wall === "top" || wall === "bottom" ? room.depth : room.width;
const clampWallItem = <T extends { wall: Wall; segmentId?: string; offset: number; width: number }>(
    item: T,
    room: Room,
    minimumWidth: number,
): T => {
    const length = wallLength(room, item.wall, item.segmentId);
    const width = clamp(snapToGrid(item.width), minimumWidth, length);
    return {
        ...item,
        width,
        offset: clamp(snapToGrid(item.offset), 0, Math.max(0, length - width)),
    };
};

const clampDoorOpening = (door: DoorOpening, room: Room): DoorOpening => {
    const maximumWidth = Math.min(
        wallLength(room, door.wall, door.segmentId, door.partitionId),
        door.partitionId
            ? Math.max(room.width, room.depth)
            : perpendicularWallLength(room, door.wall),
    );
    const width = clamp(snapToGrid(door.width), 600, maximumWidth);

    return {
        ...door,
        width,
        offset: clamp(
            snapToGrid(door.offset),
            0,
            Math.max(0, wallLength(room, door.wall, door.segmentId, door.partitionId) - width),
        ),
        clearanceDepth: clamp(
            snapToGrid(door.clearanceDepth),
            GRID_MM,
            door.partitionId
                ? Math.max(room.width, room.depth)
                : perpendicularWallLength(room, door.wall),
        ),
    };
};

const getWallItemBoundsIssue = (
    label: string,
    item: { wall: Wall; segmentId?: string; offset: number; width: number },
    room: Room,
): string | null => {
    const length = wallLength(room, item.wall, item.segmentId);
    if (item.width > length) {
        return `${label} шире выбранной стены на ${(item.width - length) / 10} см.`;
    }
    if (item.offset < 0 || item.offset + item.width > length) {
        return `${label} выходит за пределы стены. Уменьшите отступ или ширину.`;
    }
    return null;
};

const getDoorBoundsIssue = (door: DoorOpening, room: Room): string | null => {
    const length = wallLength(room, door.wall, door.segmentId, door.partitionId);
    const anchor = door.partitionId ? "перегородки" : "стены";
    const wallIssue =
        door.width > length
            ? `Дверь шире выбранной ${anchor} на ${(door.width - length) / 10} см.`
            : door.offset < 0 || door.offset + door.width > length
              ? `Дверь выходит за пределы выбранной ${anchor}. Уменьшите отступ или ширину.`
              : null;
    if (wallIssue) return wallIssue;

    const perpendicularLength = door.partitionId
        ? Math.max(room.width, room.depth)
        : perpendicularWallLength(room, door.wall);
    if (door.width > perpendicularLength) {
        return `Дверь шире доступной глубины комнаты на ${(door.width - perpendicularLength) / 10} см.`;
    }
    if (door.clearanceDepth > perpendicularLength) {
        return `Зона открывания двери выходит за пределы комнаты на ${(door.clearanceDepth - perpendicularLength) / 10} см.`;
    }
    return null;
};

const getRadiatorBoundsIssue = (radiator: RadiatorObstacle, room: Room): string | null => {
    const wallIssue = getWallItemBoundsIssue("Радиатор", radiator, room);
    if (wallIssue) return wallIssue;

    const availableDepth = perpendicularWallLength(room, radiator.wall);
    const occupiedDepth = radiator.depth + radiator.clearanceDepth;
    if (occupiedDepth > availableDepth) {
        return `Корпус и свободная зона радиатора выходят за пределы комнаты на ${(occupiedDepth - availableDepth) / 10} см.`;
    }
    return null;
};

const millimetersFromMeters = (value: number) => snapToGrid(value * 1000);
const millimetersFromCentimeters = (value: number) => snapToGrid(value * 10);

const baselineFromHandoff = (input: QuestionnairePlannerInputV1): HandoffBaseline => ({
    selection: Object.fromEntries(input.items.map((item) => [item.definitionId, item.count])),
    priorities: Object.fromEntries(
        input.items.map((item) => [
            item.definitionId,
            item.priority ?? (item.required ? "required" : "preferred"),
        ]),
    ),
    tvTargetCategory: input.preferences?.tvTargetCategory,
    itemCount: input.items.reduce((sum, item) => sum + item.count, 0),
    styleKey: input.meta?.styleKey,
    styleLabel: input.meta?.styleLabel,
});

const baselineFromProjectDraft = (draft: StyleFinderProjectDraft): HandoffBaseline => ({
    selection: Object.fromEntries(
        draft.questionnaire.items.map((item) => [item.definitionId, item.count]),
    ),
    priorities: Object.fromEntries(
        draft.questionnaire.items.map((item) => [item.definitionId, item.priority]),
    ),
    tvTargetCategory: draft.questionnaire.preferences?.tvTargetCategory,
    itemCount: draft.questionnaire.items.reduce((sum, item) => sum + item.count, 0),
    styleKey: draft.questionnaire.meta?.styleKey,
    styleLabel: draft.questionnaire.meta?.styleLabel,
});

const selectedCountsSignature = (selection: Selection) =>
    JSON.stringify(
        FURNITURE_CATALOG.map((definition) => [definition.id, selection[definition.id] ?? 0]),
    );

const getHandoffWarning = (
    status: "missing" | "expired" | "invalid" | "unsupported-version" | "unavailable",
) => {
    switch (status) {
        case "missing":
            return "Набор анкеты не найден. Открыт демонстрационный комплект.";
        case "expired":
            return "Срок хранения набора анкеты истёк. Пройдите анкету ещё раз.";
        case "unsupported-version":
            return "Этот набор создан в другой версии анкеты. Пройдите её ещё раз.";
        case "unavailable":
            return "Браузер не разрешил прочитать набор анкеты. Открыт демонстрационный комплект.";
        default:
            return "Набор анкеты повреждён или ссылка некорректна. Открыт демонстрационный комплект.";
    }
};

const formatArea = (room: Room) => (getRoomArea(room) / 1_000_000).toFixed(1);
const formatMeters = (millimeters: number) => `${(millimeters / 1000).toFixed(2)} м`;
const formatResultDate = (value: string) =>
    new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "long",
        timeStyle: "short",
    }).format(new Date(value));
const PRIORITY_LABELS: Record<FurniturePriority, string> = {
    required: "Обязательно",
    preferred: "Желательно",
    optional: "Можно убрать",
};
const DESIGN_LAB_VERDICT_LABELS: Record<DesignLabVerdict, string> = {
    good: "Хорошо",
    questionable: "Спорно",
    "needs-fix": "Нужно исправить",
};
const formatFurnitureCount = (count: number) => {
    const modulo100 = count % 100;
    const modulo10 = count % 10;
    if (modulo100 >= 11 && modulo100 <= 19) return `${count} предметов`;
    if (modulo10 === 1) return `${count} предмет`;
    if (modulo10 >= 2 && modulo10 <= 4) return `${count} предмета`;
    return `${count} предметов`;
};
const formatVariantCount = (count: number) => {
    if (count === 1) return "1 вариант";
    if (count >= 2 && count <= 4) return `${count} варианта`;
    return `${count} вариантов`;
};
const formatVariantMetric = (variant: LayoutVariant) => {
    switch (variant.profile.id) {
        case "daylight":
            return variant.profile.windowPreferredItems > 0
                ? `у окна: ${variant.profile.windowPreferredItems} предм.`
                : "световой сценарий";
        case "open-center":
            return `свободный центр ${(variant.profile.centerClearance / 1000).toFixed(1)} м`;
        case "perimeter":
            return `у стен: ${variant.profile.perimeterItems} из ${variant.placements.length}`;
        case "long-wall":
            return "ТВ-зона вдоль длинной стены";
        case "zoned":
            return "разделение зон сна и гостиной";
        default:
            return "баланс связей, стен и свободного центра";
    }
};

const getDefinitionDimensions = (definition: FurnitureDefinition) => {
    const geometry = getRotatedGeometry(definition, 0);
    return `${geometry.width} × ${geometry.depth}`;
};

const instanceNumber = (instanceId: string) => {
    const number = instanceId.match(/-(\d+)$/)?.[1];
    return number ? ` · ${number}` : "";
};

interface PlanCanvasProps {
    room: Room;
    placements: Placement[];
    unplacedInstances: FurnitureInstance[];
    selectedInstanceId: string | null;
    invalidInstanceIds: Set<string>;
    showClearances: boolean;
    isRoomEditing: boolean;
    phase: PlannerPhase;
    failure: LayoutFailure | null;
    onSelect: (instanceId: string) => void;
    onPreviewPlacement: (placement: Placement | null) => void;
    onCommitPlacement: (instanceId: string, placement: Placement) => void;
    onAddPlacement: (placement: Placement) => void;
    onNudgePlacement: (instanceId: string, deltaX: number, deltaY: number) => void;
    onRotatePlacement: (instanceId: string) => void;
    onMoveDoor: (doorId: string, offset: number) => void;
    onMoveWindow: (windowId: string, offset: number) => void;
    onMoveRadiator: (radiatorId: string, offset: number) => void;
    onResizeRoom: (width: number, depth: number) => void;
    onResizeRectangleBounds: (bounds: RectangleEditBounds) => void;
    onRestoreRoom: (room: Room) => void;
    onMoveRoomVertex: (vertexId: string, point: { x: number; y: number }) => void;
    onSplitRoomSegment: (segmentId: string, point: { x: number; y: number }) => void;
    onRoomEditGestureChange: (active: boolean) => void;
}

interface DragSession {
    pointerId: number;
    instanceId: string;
    element: HTMLButtonElement;
    startPlacement: Placement;
    latestPlacement: Placement;
    grabOffsetX: number;
    grabOffsetY: number;
    startClientX: number;
    startClientY: number;
    geometryWidth: number;
    geometryDepth: number;
    moved: boolean;
}

interface ManualSourceDragSession {
    instanceId: string;
    pointerId: number;
    source: HTMLButtonElement;
    startClientX: number;
    startClientY: number;
    moved: boolean;
}

interface OpeningDragSession {
    pointerId: number;
    openingId: string;
    kind: "door" | "window" | "radiator";
    wall: Wall;
    segmentId?: string;
    partitionId?: string;
    initialOffset: number;
    grabOffset: number;
    element: HTMLButtonElement;
}

interface RoomResizeDragSession {
    pointerId: number;
    dimension: "width" | "depth";
    initialWidth: number;
    initialDepth: number;
    startClientCoordinate: number;
    referencePixels: number;
    element: HTMLButtonElement;
}

interface RoomVertexDragSession {
    pointerId: number;
    vertexId: string;
    initialPoint: { x: number; y: number };
    initialRoom: Room;
    initialRectangleBounds: RectangleEditBounds | null;
    startClientX: number;
    startClientY: number;
    referenceWidth: number;
    referenceHeight: number;
    element: HTMLButtonElement;
}

/**
 * The solver keeps rectangular rooms in a local 0…width / 0…depth coordinate
 * system. The editor keeps these temporary drawing bounds while the room is
 * being edited, so moving the left/top corner moves that corner on screen
 * rather than making the opposite boundary appear to jump.
 */
interface RectangleEditBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface RectangleEditFitReference {
    width: number;
    depth: number;
    viewportWidth?: number;
    viewportHeight?: number;
    fittedWidth?: number;
}

const cloneRoomForEditor = (room: Room): Room => ({
    ...room,
    geometry:
        room.geometry?.kind === "orthogonal"
            ? {
                  ...room.geometry,
                  vertices: room.geometry.vertices.map((vertex) => ({ ...vertex })),
              }
            : room.geometry
              ? { ...room.geometry }
              : undefined,
    doors: room.doors.map((door) => ({ ...door })),
    partitions: room.partitions?.map((partition) => ({
        ...partition,
        start: { ...partition.start },
        end: { ...partition.end },
    })),
    windows: room.windows.map((window) => ({ ...window })),
    radiators: room.radiators?.map((radiator) => ({ ...radiator })),
});

const getRectangleEditBounds = (room: Room): RectangleEditBounds => ({
    left: 0,
    top: 0,
    right: room.width,
    bottom: room.depth,
});

const clampRectangleEditBounds = (bounds: RectangleEditBounds): RectangleEditBounds => {
    const right = clamp(snapToGrid(bounds.right), MIN_ROOM_MM, MAX_ROOM_MM);
    const bottom = clamp(snapToGrid(bounds.bottom), MIN_ROOM_MM, MAX_ROOM_MM);
    const left = clamp(snapToGrid(bounds.left), 0, right - MIN_ROOM_MM);
    const top = clamp(snapToGrid(bounds.top), 0, bottom - MIN_ROOM_MM);
    return { left, top, right, bottom };
};

const moveRectangleEditCorner = (
    bounds: RectangleEditBounds,
    vertexId: string,
    deltaX: number,
    deltaY: number,
): RectangleEditBounds => {
    const next = { ...bounds };
    if (vertexId === "rect-top-left" || vertexId === "rect-bottom-left") {
        next.left += deltaX;
    } else if (vertexId === "rect-top-right" || vertexId === "rect-bottom-right") {
        next.right += deltaX;
    }
    if (vertexId === "rect-top-left" || vertexId === "rect-top-right") {
        next.top += deltaY;
    } else if (vertexId === "rect-bottom-left" || vertexId === "rect-bottom-right") {
        next.bottom += deltaY;
    }
    return clampRectangleEditBounds(next);
};

interface RoomSegmentSplitDragSession {
    pointerId: number;
    segmentId: string;
    orientation: RoomBoundarySegment["orientation"];
    midpoint: { x: number; y: number };
    latestPoint: { x: number; y: number };
    startClientX: number;
    startClientY: number;
    referenceWidth: number;
    referenceHeight: number;
    roomWidth: number;
    roomDepth: number;
    element: HTMLButtonElement;
}

// Midpoint targets intentionally sit outside the wall so that the 44px hit
// area never hides a door or window.  Convert the *drag distance* from that
// target, rather than treating the target's outside-lane position as a room
// coordinate. Otherwise a short first move can look like a large, invalid
// offset before the pointer has even crossed the wall.
const getRoomSegmentSplitDragPoint = (
    session: RoomSegmentSplitDragSession,
    clientX: number,
    clientY: number,
) => ({
    x:
        session.midpoint.x +
        (session.orientation === "vertical"
            ? ((clientX - session.startClientX) / Math.max(session.referenceWidth, 1)) *
              session.roomWidth
            : 0),
    y:
        session.midpoint.y +
        (session.orientation === "horizontal"
            ? ((clientY - session.startClientY) / Math.max(session.referenceHeight, 1)) *
              session.roomDepth
            : 0),
});

const openingLinePresentation = (
    room: Room,
    opening: {
        wall: Wall;
        segmentId?: string;
        partitionId?: string;
        offset: number;
        width: number;
    },
): { horizontal: boolean; style: React.CSSProperties } => {
    if (room.geometry?.kind !== "orthogonal" && !opening.partitionId) {
        const horizontal = opening.wall === "top" || opening.wall === "bottom";
        return {
            horizontal,
            style: horizontal
                ? {
                      left: `${(opening.offset / room.width) * 100}%`,
                      width: `${(opening.width / room.width) * 100}%`,
                      top: opening.wall === "top" ? 0 : undefined,
                      bottom: opening.wall === "bottom" ? 0 : undefined,
                  }
                : {
                      top: `${(opening.offset / room.depth) * 100}%`,
                      height: `${(opening.width / room.depth) * 100}%`,
                      left: opening.wall === "left" ? 0 : undefined,
                      right: opening.wall === "right" ? 0 : undefined,
                  },
        };
    }

    const segment = getRoomSegment(room, opening);
    if (!segment) return { horizontal: true, style: { display: "none" } };
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
    const horizontal = segment.orientation === "horizontal";
    return {
        horizontal,
        style: horizontal
            ? {
                  left: `${(Math.min(start.x, end.x) / room.width) * 100}%`,
                  top: `${(start.y / room.depth) * 100}%`,
                  width: `${(Math.abs(end.x - start.x) / room.width) * 100}%`,
                  transform: "translateY(-50%)",
              }
            : {
                  left: `${(start.x / room.width) * 100}%`,
                  top: `${(Math.min(start.y, end.y) / room.depth) * 100}%`,
                  height: `${(Math.abs(end.y - start.y) / room.depth) * 100}%`,
                  transform: "translateX(-50%)",
              },
    };
};

interface SegmentEditorControlLayout {
    point: { x: number; y: number };
    /** The length label sits beside the handle, toward the longer part of the wall (+1 = toward its end). */
    labelSide: 1 | -1;
    /** The controls use an outside lane whenever the wall is occupied or short. */
    outsideLane: number;
    blocked: boolean;
    reason: string;
}

const getSegmentOpeningIntervals = (room: Room, segment: RoomBoundarySegment) =>
    [...room.doors, ...room.windows, ...(room.radiators ?? [])]
        .filter((opening) =>
            room.geometry?.kind === "orthogonal"
                ? opening.segmentId === segment.id
                : opening.wall === segment.wall,
        )
        .map((opening) => ({
            start: clamp(opening.offset, 0, segment.length),
            end: clamp(opening.offset + opening.width, 0, segment.length),
            kind: "hinge" in opening ? "дверь" : "depth" in opening ? "радиатор" : "окно",
        }));

const getSegmentPoint = (segment: RoomBoundarySegment, offset: number) => {
    const ratio = segment.length > 0 ? clamp(offset / segment.length, 0, 1) : 0;
    return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
    };
};

const chooseClearSegmentOffset = (
    segment: RoomBoundarySegment,
    intervals: Array<{ start: number; end: number }>,
    clearance: number,
) => {
    const midpoint = segment.length / 2;
    const candidates = [
        midpoint,
        ...intervals.flatMap((interval) => [interval.start - clearance, interval.end + clearance]),
        Math.min(clearance, segment.length / 2),
        Math.max(segment.length - clearance, segment.length / 2),
    ]
        .map((candidate) => clamp(candidate, 0, segment.length))
        .sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint));

    return (
        candidates.find(
            (candidate) =>
                candidate >= clearance &&
                candidate <= segment.length - clearance &&
                intervals.every(
                    (interval) =>
                        candidate + clearance < interval.start ||
                        candidate - clearance > interval.end,
                ),
        ) ?? midpoint
    );
};

const getSegmentEditorControlLayout = (
    room: Room,
    segment: RoomBoundarySegment,
    index: number,
    segmentCount: number,
): SegmentEditorControlLayout => {
    const intervals = getSegmentOpeningIntervals(room, segment);
    const opening = intervals[0];
    const blockedByOpening = intervals.length > 0;
    const blockedByLength = segment.length < 1500;
    const blockedByVertexLimit = segmentCount + 4 > 16;
    const blocked = blockedByOpening || blockedByLength || blockedByVertexLimit;
    const reason = blockedByOpening
        ? `На стене ${opening?.kind ?? "проём"}: перенесите его, чтобы добавить уступ.`
        : blockedByLength
          ? "Для уступа нужен отрезок стены длиной не менее 1,5 м."
          : blockedByVertexLimit
            ? "В контуре уже 16 вершин — это максимальное количество."
            : "Потяните перпендикулярно стене, чтобы добавить уступ.";
    const outsideLane = blockedByOpening || segment.length < 1850 ? 1 + (index % 3) : 0;
    const handleOffset = chooseClearSegmentOffset(segment, intervals, 360);

    return {
        point: getSegmentPoint(segment, handleOffset),
        labelSide: handleOffset <= segment.length / 2 ? 1 : -1,
        outsideLane,
        blocked,
        reason,
    };
};

const PlanCanvas: React.FC<PlanCanvasProps> = ({
    room,
    placements,
    unplacedInstances,
    selectedInstanceId,
    invalidInstanceIds,
    showClearances,
    isRoomEditing,
    phase,
    failure,
    onSelect,
    onPreviewPlacement,
    onCommitPlacement,
    onAddPlacement,
    onNudgePlacement,
    onRotatePlacement,
    onMoveDoor,
    onMoveWindow,
    onMoveRadiator,
    onResizeRoom,
    onResizeRectangleBounds,
    onRestoreRoom,
    onMoveRoomVertex,
    onSplitRoomSegment,
    onRoomEditGestureChange,
}) => {
    const gridLines = Array.from({ length: 9 }, (_, index) => index + 1);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const dragSessionRef = useRef<DragSession | null>(null);
    const openingDragSessionRef = useRef<OpeningDragSession | null>(null);
    const roomResizeDragSessionRef = useRef<RoomResizeDragSession | null>(null);
    const roomVertexDragSessionRef = useRef<RoomVertexDragSession | null>(null);
    const roomSegmentSplitDragSessionRef = useRef<RoomSegmentSplitDragSession | null>(null);
    const suppressClickRef = useRef<string | null>(null);
    const [draggingInstanceId, setDraggingInstanceId] = useState<string | null>(null);
    const [isUnplacedDropTarget, setIsUnplacedDropTarget] = useState(false);
    const [loadedAssetKeys, setLoadedAssetKeys] = useState<Set<string>>(() => new Set());
    const [failedAssetKeys, setFailedAssetKeys] = useState<Set<string>>(() => new Set());
    const [rectangleEditBounds, setRectangleEditBounds] = useState<RectangleEditBounds | null>(
        null,
    );
    const roomVertices = getRoomVertices(room);
    const boundarySegments = getRoomBoundarySegments(room);
    const polygonPoints = roomVertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" ");
    const polygonClip = `polygon(${roomVertices
        .map((vertex) => `${(vertex.x / room.width) * 100}% ${(vertex.y / room.depth) * 100}%`)
        .join(", ")})`;

    useEffect(() => {
        if (!isRoomEditing || room.geometry?.kind === "orthogonal") {
            setRectangleEditBounds(null);
            return;
        }
        setRectangleEditBounds((current) => current ?? getRectangleEditBounds(room));
    }, [isRoomEditing, room]);

    const cancelActiveDrag = useCallback(
        (pointerId?: number) => {
            const session = dragSessionRef.current;
            if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;

            dragSessionRef.current = null;
            onPreviewPlacement(null);
            setDraggingInstanceId(null);

            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onPreviewPlacement],
    );

    const moveOpening = useCallback(
        (kind: OpeningDragSession["kind"], openingId: string, offset: number) => {
            if (kind === "door") {
                onMoveDoor(openingId, offset);
                return;
            }
            if (kind === "window") {
                onMoveWindow(openingId, offset);
                return;
            }
            onMoveRadiator(openingId, offset);
        },
        [onMoveDoor, onMoveRadiator, onMoveWindow],
    );

    const cancelOpeningDrag = useCallback(
        (pointerId?: number) => {
            const session = openingDragSessionRef.current;
            if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;

            openingDragSessionRef.current = null;
            moveOpening(session.kind, session.openingId, session.initialOffset);
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [moveOpening, onRoomEditGestureChange],
    );

    const cancelRoomResizeDrag = useCallback(
        (pointerId?: number) => {
            const session = roomResizeDragSessionRef.current;
            if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;

            roomResizeDragSessionRef.current = null;
            onResizeRoom(session.initialWidth, session.initialDepth);
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onResizeRoom, onRoomEditGestureChange],
    );

    const cancelRoomVertexDrag = useCallback(
        (pointerId?: number) => {
            const session = roomVertexDragSessionRef.current;
            if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;
            roomVertexDragSessionRef.current = null;
            if (session.initialRoom.geometry?.kind === "orthogonal") {
                onMoveRoomVertex(session.vertexId, session.initialPoint);
            } else {
                onRestoreRoom(session.initialRoom);
                setRectangleEditBounds(session.initialRectangleBounds);
            }
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onMoveRoomVertex, onRestoreRoom, onRoomEditGestureChange],
    );

    const cancelRoomSegmentSplitDrag = useCallback(
        (pointerId?: number) => {
            const session = roomSegmentSplitDragSessionRef.current;
            if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;
            roomSegmentSplitDragSessionRef.current = null;
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onRoomEditGestureChange],
    );

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (
                event.key !== "Escape" ||
                (!dragSessionRef.current &&
                    !openingDragSessionRef.current &&
                    !roomResizeDragSessionRef.current &&
                    !roomVertexDragSessionRef.current &&
                    !roomSegmentSplitDragSessionRef.current)
            ) {
                return;
            }
            event.preventDefault();
            cancelActiveDrag();
            cancelOpeningDrag();
            cancelRoomResizeDrag();
            cancelRoomVertexDrag();
            cancelRoomSegmentSplitDrag();
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [
        cancelActiveDrag,
        cancelOpeningDrag,
        cancelRoomResizeDrag,
        cancelRoomSegmentSplitDrag,
        cancelRoomVertexDrag,
    ]);

    const beginRoomVertexDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>, vertex: RoomVertex) => {
            if (!isRoomEditing || !event.isPrimary) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const roomElement = roomRef.current;
            roomVertexDragSessionRef.current = {
                pointerId: event.pointerId,
                vertexId: vertex.id,
                initialPoint: { x: vertex.x, y: vertex.y },
                initialRoom: cloneRoomForEditor(room),
                initialRectangleBounds:
                    room.geometry?.kind === "orthogonal"
                        ? null
                        : rectangleEditBounds ?? getRectangleEditBounds(room),
                startClientX: event.clientX,
                startClientY: event.clientY,
                referenceWidth: Math.max(roomElement?.clientWidth ?? 0, 1),
                referenceHeight: Math.max(roomElement?.clientHeight ?? 0, 1),
                element: event.currentTarget,
            };
            onRoomEditGestureChange(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        },
        [isRoomEditing, onRoomEditGestureChange, rectangleEditBounds, room],
    );

    const moveRoomVertexDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomVertexDragSessionRef.current;
            const roomElement = roomRef.current;
            if (!session || !roomElement || session.pointerId !== event.pointerId) return;
            if (session.initialRoom.geometry?.kind !== "orthogonal") {
                const initialBounds = session.initialRectangleBounds;
                if (!initialBounds) return;
                const nextBounds = moveRectangleEditCorner(
                    initialBounds,
                    session.vertexId,
                    ((event.clientX - session.startClientX) / session.referenceWidth) *
                        session.initialRoom.width,
                    ((event.clientY - session.startClientY) / session.referenceHeight) *
                        session.initialRoom.depth,
                );
                setRectangleEditBounds(nextBounds);
                onResizeRectangleBounds(nextBounds);
                event.preventDefault();
                return;
            }
            onMoveRoomVertex(
                session.vertexId,
                clientPointToRoomMm(roomElement, room, event.clientX, event.clientY),
            );
            event.preventDefault();
        },
        [onMoveRoomVertex, onResizeRectangleBounds, room],
    );

    const finishRoomVertexDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomVertexDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            roomVertexDragSessionRef.current = null;
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onRoomEditGestureChange],
    );

    const handleRoomVertexKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLButtonElement>, vertex: RoomVertex) => {
            if (!isRoomEditing) return;
            const delta = {
                ArrowLeft: [-GRID_MM, 0],
                ArrowRight: [GRID_MM, 0],
                ArrowUp: [0, -GRID_MM],
                ArrowDown: [0, GRID_MM],
            }[event.key];
            if (!delta) return;
            event.preventDefault();
            if (room.geometry?.kind !== "orthogonal") {
                const nextBounds = moveRectangleEditCorner(
                    rectangleEditBounds ?? getRectangleEditBounds(room),
                    vertex.id,
                    delta[0],
                    delta[1],
                );
                setRectangleEditBounds(nextBounds);
                onResizeRectangleBounds(nextBounds);
                return;
            }
            onMoveRoomVertex(vertex.id, { x: vertex.x + delta[0], y: vertex.y + delta[1] });
        },
        [isRoomEditing, onMoveRoomVertex, onResizeRectangleBounds, rectangleEditBounds, room],
    );

    const beginRoomSegmentSplitDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>, segmentId: string) => {
            if (
                !isRoomEditing ||
                !event.isPrimary ||
                event.currentTarget.dataset.blocked === "true"
            ) {
                return;
            }
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const roomElement = roomRef.current;
            if (!roomElement) return;
            const segment = boundarySegments.find((candidate) => candidate.id === segmentId);
            if (!segment) return;
            const midpoint = {
                x: (segment.start.x + segment.end.x) / 2,
                y: (segment.start.y + segment.end.y) / 2,
            };
            roomSegmentSplitDragSessionRef.current = {
                pointerId: event.pointerId,
                segmentId,
                orientation: segment.orientation,
                midpoint,
                latestPoint: midpoint,
                startClientX: event.clientX,
                startClientY: event.clientY,
                referenceWidth: Math.max(roomElement.clientWidth, 1),
                referenceHeight: Math.max(roomElement.clientHeight, 1),
                roomWidth: room.width,
                roomDepth: room.depth,
                element: event.currentTarget,
            };
            const removeWindowPointerListeners = () => {
                window.removeEventListener("pointerup", handleWindowPointerUp);
                window.removeEventListener("pointercancel", handleWindowPointerCancel);
            };
            const handleWindowPointerUp = (pointerEvent: PointerEvent) => {
                removeWindowPointerListeners();
                const session = roomSegmentSplitDragSessionRef.current;
                const currentRoomElement = roomRef.current;
                if (!session || session.pointerId !== pointerEvent.pointerId) return;
                roomSegmentSplitDragSessionRef.current = null;
                onRoomEditGestureChange(false);
                onSplitRoomSegment(
                    session.segmentId,
                    currentRoomElement
                        ? getRoomSegmentSplitDragPoint(
                              session,
                              pointerEvent.clientX,
                              pointerEvent.clientY,
                          )
                        : session.latestPoint,
                );
                if (session.element.hasPointerCapture(session.pointerId)) {
                    session.element.releasePointerCapture(session.pointerId);
                }
            };
            const handleWindowPointerCancel = (pointerEvent: PointerEvent) => {
                removeWindowPointerListeners();
                cancelRoomSegmentSplitDrag(pointerEvent.pointerId);
            };
            window.addEventListener("pointerup", handleWindowPointerUp);
            window.addEventListener("pointercancel", handleWindowPointerCancel);
            onRoomEditGestureChange(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        },
        [
            cancelRoomSegmentSplitDrag,
            isRoomEditing,
            onRoomEditGestureChange,
            onSplitRoomSegment,
            room,
            boundarySegments,
        ],
    );

    const moveRoomSegmentSplitDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomSegmentSplitDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            const latestPoint = getRoomSegmentSplitDragPoint(session, event.clientX, event.clientY);
            session.latestPoint = latestPoint;
            const perpendicularDistance =
                session.orientation === "horizontal"
                    ? Math.abs(latestPoint.y - session.midpoint.y)
                    : Math.abs(latestPoint.x - session.midpoint.x);
            if (perpendicularDistance >= MIN_ORTHOGONAL_SEGMENT_MM) {
                roomSegmentSplitDragSessionRef.current = null;
                onRoomEditGestureChange(false);
                onSplitRoomSegment(session.segmentId, latestPoint);
                if (session.element.hasPointerCapture(session.pointerId)) {
                    session.element.releasePointerCapture(session.pointerId);
                }
            }
            event.preventDefault();
        },
        [onRoomEditGestureChange, onSplitRoomSegment],
    );

    const commitRoomSegmentSplit = useCallback(
        (session: RoomSegmentSplitDragSession, point: { x: number; y: number }) => {
            roomSegmentSplitDragSessionRef.current = null;
            onRoomEditGestureChange(false);
            onSplitRoomSegment(session.segmentId, point);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onRoomEditGestureChange, onSplitRoomSegment],
    );

    const finishRoomSegmentSplitDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomSegmentSplitDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            commitRoomSegmentSplit(
                session,
                getRoomSegmentSplitDragPoint(session, event.clientX, event.clientY),
            );
        },
        [commitRoomSegmentSplit],
    );

    const finishLostRoomSegmentSplitDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomSegmentSplitDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            commitRoomSegmentSplit(session, session.latestPoint);
        },
        [commitRoomSegmentSplit],
    );

    const handleRoomSegmentSplitKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLButtonElement>, segment: RoomBoundarySegment) => {
            if (!isRoomEditing || event.currentTarget.dataset.blocked === "true") return;
            const delta = {
                ArrowLeft: [-GRID_MM * 12, 0],
                ArrowRight: [GRID_MM * 12, 0],
                ArrowUp: [0, -GRID_MM * 12],
                ArrowDown: [0, GRID_MM * 12],
            }[event.key];
            if (!delta) return;
            event.preventDefault();
            onSplitRoomSegment(segment.id, {
                x: (segment.start.x + segment.end.x) / 2 + delta[0],
                y: (segment.start.y + segment.end.y) / 2 + delta[1],
            });
        },
        [isRoomEditing, onSplitRoomSegment],
    );

    const beginRoomResizeDrag = useCallback(
        (
            event: React.PointerEvent<HTMLButtonElement>,
            dimension: RoomResizeDragSession["dimension"],
        ) => {
            if (!isRoomEditing || !event.isPrimary) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const roomElement = roomRef.current;
            if (!roomElement) return;
            const bounds = roomElement.getBoundingClientRect();
            const referencePixels = dimension === "width" ? bounds.width : bounds.height;
            if (referencePixels <= 0) return;

            roomResizeDragSessionRef.current = {
                pointerId: event.pointerId,
                dimension,
                initialWidth: room.width,
                initialDepth: room.depth,
                startClientCoordinate: dimension === "width" ? event.clientX : event.clientY,
                referencePixels,
                element: event.currentTarget,
            };
            onRoomEditGestureChange(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        },
        [isRoomEditing, onRoomEditGestureChange, room.depth, room.width],
    );

    const moveRoomResizeDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomResizeDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;

            const clientCoordinate = session.dimension === "width" ? event.clientX : event.clientY;
            const initialSize =
                session.dimension === "width" ? session.initialWidth : session.initialDepth;
            const delta =
                ((clientCoordinate - session.startClientCoordinate) / session.referencePixels) *
                initialSize;
            const nextSize = initialSize + delta;
            onResizeRoom(
                session.dimension === "width" ? nextSize : session.initialWidth,
                session.dimension === "depth" ? nextSize : session.initialDepth,
            );
            event.preventDefault();
        },
        [onResizeRoom],
    );

    const finishRoomResizeDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = roomResizeDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;

            roomResizeDragSessionRef.current = null;
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onRoomEditGestureChange],
    );

    const handleRoomResizeKeyDown = useCallback(
        (
            event: React.KeyboardEvent<HTMLButtonElement>,
            dimension: RoomResizeDragSession["dimension"],
        ) => {
            if (!isRoomEditing) return;
            const delta =
                dimension === "width"
                    ? event.key === "ArrowLeft"
                        ? -GRID_MM
                        : event.key === "ArrowRight"
                          ? GRID_MM
                          : 0
                    : event.key === "ArrowUp"
                      ? -GRID_MM
                      : event.key === "ArrowDown"
                        ? GRID_MM
                        : 0;
            if (!delta) return;

            event.preventDefault();
            onResizeRoom(
                dimension === "width" ? room.width + delta : room.width,
                dimension === "depth" ? room.depth + delta : room.depth,
            );
        },
        [isRoomEditing, onResizeRoom, room.depth, room.width],
    );

    const beginOpeningDrag = useCallback(
        (
            event: React.PointerEvent<HTMLButtonElement>,
            kind: OpeningDragSession["kind"],
            opening: {
                id: string;
                wall: Wall;
                segmentId?: string;
                partitionId?: string;
                offset: number;
            },
        ) => {
            if (!isRoomEditing || !event.isPrimary) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const roomElement = roomRef.current;
            if (!roomElement) return;
            const point = clientPointToRoomMm(roomElement, room, event.clientX, event.clientY);
            const segment = getRoomSegment(room, opening);
            if (!segment) return;
            const wallOffset = projectPointToSegmentOffset(segment, point);

            openingDragSessionRef.current = {
                pointerId: event.pointerId,
                openingId: opening.id,
                kind,
                wall: opening.wall,
                segmentId: opening.segmentId,
                partitionId: opening.partitionId,
                initialOffset: opening.offset,
                grabOffset: wallOffset - opening.offset,
                element: event.currentTarget,
            };
            onRoomEditGestureChange(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        },
        [isRoomEditing, onRoomEditGestureChange, room],
    );

    const moveOpeningDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = openingDragSessionRef.current;
            const roomElement = roomRef.current;
            if (!session || !roomElement || session.pointerId !== event.pointerId) return;

            const point = clientPointToRoomMm(roomElement, room, event.clientX, event.clientY);
            const segment = getRoomSegment(room, session);
            if (!segment) return;
            const wallOffset = projectPointToSegmentOffset(segment, point);
            moveOpening(session.kind, session.openingId, wallOffset - session.grabOffset);
            event.preventDefault();
        },
        [moveOpening, room],
    );

    const finishOpeningDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = openingDragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;

            openingDragSessionRef.current = null;
            onRoomEditGestureChange(false);
            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onRoomEditGestureChange],
    );

    const handleOpeningKeyDown = useCallback(
        (
            event: React.KeyboardEvent<HTMLButtonElement>,
            kind: OpeningDragSession["kind"],
            opening: {
                id: string;
                wall: Wall;
                segmentId?: string;
                partitionId?: string;
                offset: number;
            },
        ) => {
            if (!isRoomEditing) return;

            const segment = getRoomSegment(room, opening);
            if (!segment) return;
            const horizontal = segment.orientation === "horizontal";
            const direction = horizontal
                ? (segment.end.x - segment.start.x) / segment.length
                : (segment.end.y - segment.start.y) / segment.length;
            const delta = horizontal
                ? event.key === "ArrowLeft"
                    ? -GRID_MM * direction
                    : event.key === "ArrowRight"
                      ? GRID_MM * direction
                      : 0
                : event.key === "ArrowUp"
                  ? -GRID_MM * direction
                  : event.key === "ArrowDown"
                    ? GRID_MM * direction
                    : 0;
            if (!delta) return;

            event.preventDefault();
            moveOpening(kind, opening.id, opening.offset + delta);
        },
        [isRoomEditing, moveOpening, room],
    );

    const beginDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>, placement: Placement) => {
            if (isRoomEditing || phase === "solving" || !event.isPrimary) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const roomElement = roomRef.current;
            if (!roomElement) return;

            const geometry = getRotatedGeometry(
                getFurniture(placement.definitionId),
                placement.rotation,
                placement,
            );
            const point = clientPointToRoomMm(roomElement, room, event.clientX, event.clientY);

            onSelect(placement.instanceId);
            dragSessionRef.current = {
                pointerId: event.pointerId,
                instanceId: placement.instanceId,
                element: event.currentTarget,
                startPlacement: placement,
                latestPlacement: placement,
                grabOffsetX: clamp(point.x - placement.x, 0, geometry.width),
                grabOffsetY: clamp(point.y - placement.y, 0, geometry.depth),
                startClientX: event.clientX,
                startClientY: event.clientY,
                geometryWidth: geometry.width,
                geometryDepth: geometry.depth,
                moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
        },
        [isRoomEditing, onSelect, phase, room],
    );

    const moveDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = dragSessionRef.current;
            const roomElement = roomRef.current;
            if (!session || !roomElement || session.pointerId !== event.pointerId) return;

            const distance = Math.hypot(
                event.clientX - session.startClientX,
                event.clientY - session.startClientY,
            );
            if (!session.moved && distance < 6) return;

            const point = clientPointToRoomMm(roomElement, room, event.clientX, event.clientY);
            const nextPlacement: Placement = {
                ...session.startPlacement,
                x: clamp(
                    snapToGrid(point.x - session.grabOffsetX),
                    0,
                    Math.max(
                        0,
                        Math.floor((room.width - session.geometryWidth) / GRID_MM) * GRID_MM,
                    ),
                ),
                y: clamp(
                    snapToGrid(point.y - session.grabOffsetY),
                    0,
                    Math.max(
                        0,
                        Math.floor((room.depth - session.geometryDepth) / GRID_MM) * GRID_MM,
                    ),
                ),
            };

            if (
                nextPlacement.x === session.latestPlacement.x &&
                nextPlacement.y === session.latestPlacement.y
            ) {
                return;
            }

            session.moved = true;
            session.latestPlacement = nextPlacement;
            setDraggingInstanceId(session.instanceId);
            event.preventDefault();
            onPreviewPlacement(nextPlacement);
        },
        [onPreviewPlacement, room],
    );

    const finishDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const session = dragSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;

            dragSessionRef.current = null;
            onPreviewPlacement(null);
            setDraggingInstanceId(null);

            const changedFromStart =
                session.latestPlacement.x !== session.startPlacement.x ||
                session.latestPlacement.y !== session.startPlacement.y;

            if (session.moved) {
                suppressClickRef.current = session.instanceId;
                window.setTimeout(() => {
                    if (suppressClickRef.current === session.instanceId) {
                        suppressClickRef.current = null;
                    }
                }, 0);
            }

            if (session.moved && changedFromStart) {
                onCommitPlacement(session.instanceId, session.latestPlacement);
            }

            if (session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        },
        [onCommitPlacement, onPreviewPlacement],
    );

    const handleFurnitureKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLButtonElement>, instanceId: string) => {
            if (isRoomEditing) return;
            if (event.key === "Escape") {
                if (dragSessionRef.current) {
                    event.preventDefault();
                    cancelActiveDrag();
                }
                return;
            }

            const directions: Record<string, [number, number]> = {
                ArrowLeft: [-GRID_MM, 0],
                ArrowRight: [GRID_MM, 0],
                ArrowUp: [0, -GRID_MM],
                ArrowDown: [0, GRID_MM],
            };
            const direction = directions[event.key];
            if (direction) {
                event.preventDefault();
                onSelect(instanceId);
                onNudgePlacement(instanceId, ...direction);
                return;
            }

            if (event.key.toLowerCase() === "r") {
                event.preventDefault();
                onSelect(instanceId);
                onRotatePlacement(instanceId);
            }
        },
        [cancelActiveDrag, isRoomEditing, onNudgePlacement, onRotatePlacement, onSelect],
    );

    const isUnplacedFurnitureDrag = useCallback(
        (event: React.DragEvent<HTMLDivElement>) =>
            Array.from(event.dataTransfer.types).some(
                (type) =>
                    type === UNPLACED_FURNITURE_DRAG_TYPE || type.toLowerCase() === "text/plain",
            ),
        [],
    );

    const createDroppedPlacement = useCallback(
        (instance: FurnitureInstance, clientX: number, clientY: number): Placement | null => {
            const roomElement = roomRef.current;
            if (!roomElement) return null;

            const geometry = getRotatedGeometry(getFurniture(instance.definitionId), 0);
            const point = clientPointToRoomMm(roomElement, room, clientX, clientY);

            return {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                rotation: 0,
                x: clamp(
                    snapToGrid(point.x - geometry.width / 2),
                    0,
                    Math.max(0, Math.floor((room.width - geometry.width) / GRID_MM) * GRID_MM),
                ),
                y: clamp(
                    snapToGrid(point.y - geometry.depth / 2),
                    0,
                    Math.max(0, Math.floor((room.depth - geometry.depth) / GRID_MM) * GRID_MM),
                ),
            };
        },
        [room],
    );

    const handleUnplacedDragOver = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            if (isRoomEditing || phase === "solving" || !isUnplacedFurnitureDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsUnplacedDropTarget(true);
        },
        [isRoomEditing, isUnplacedFurnitureDrag, phase],
    );

    const handleUnplacedDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsUnplacedDropTarget(false);
    }, []);

    const handleUnplacedDrop = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            if (isRoomEditing || !isUnplacedFurnitureDrag(event)) return;
            event.preventDefault();
            setIsUnplacedDropTarget(false);

            const instanceId = readUnplacedFurnitureDragInstanceId(event.dataTransfer);
            const instance = unplacedInstances.find(
                (candidate) => candidate.instanceId === instanceId,
            );
            if (!instance) return;

            const placement = createDroppedPlacement(instance, event.clientX, event.clientY);
            if (placement) onAddPlacement(placement);
        },
        [
            createDroppedPlacement,
            isRoomEditing,
            isUnplacedFurnitureDrag,
            onAddPlacement,
            unplacedInstances,
        ],
    );

    const rectangleEditorBounds =
        isRoomEditing && room.geometry?.kind !== "orthogonal"
            ? rectangleEditBounds ?? getRectangleEditBounds(room)
            : null;
    const rectangleEditorWidth = rectangleEditorBounds
        ? Math.max(rectangleEditorBounds.right, room.width)
        : room.width;
    const rectangleEditorDepth = rectangleEditorBounds
        ? Math.max(rectangleEditorBounds.bottom, room.depth)
        : room.depth;
    const rectangleEditorRoomStyle = rectangleEditorBounds
        ? {
              aspectRatio: `${Math.max(room.width, 1)} / ${Math.max(room.depth, 1)}`,
              left: `${(rectangleEditorBounds.left / rectangleEditorWidth) * 100}%`,
              top: `${(rectangleEditorBounds.top / rectangleEditorDepth) * 100}%`,
              // Keep the opposite wall physically anchored. Using a width
              // percentage next to a left percentage lets browser rounding
              // move the fixed right edge by a couple of pixels at small
              // fitted scales; an explicit right inset preserves it.
              right: `${
                  ((rectangleEditorWidth - rectangleEditorBounds.right) / rectangleEditorWidth) *
                  100
              }%`,
          }
        : { aspectRatio: `${Math.max(room.width, 1)} / ${Math.max(room.depth, 1)}` };
    return (
        <div
            className={`${styles.canvasViewport} ${
                rectangleEditorBounds ? styles.canvasViewportRectangleEditor : ""
            }`}
            style={
                rectangleEditorBounds
                    ? {
                          aspectRatio: `${rectangleEditorWidth} / ${rectangleEditorDepth}`,
                      }
                    : undefined
            }
        >
            {/* While editing, every wall carries its own length beside its handle;
                the overall rulers would only sit underneath those controls. */}
            {!isRoomEditing && (
                <>
                    <div className={styles.dimensionTop} aria-hidden="true">
                        <span>{formatMeters(room.width)}</span>
                    </div>
                    <div className={styles.dimensionSide} aria-hidden="true">
                        <span>{formatMeters(room.depth)}</span>
                    </div>
                </>
            )}
            <div
                ref={roomRef}
                className={`${styles.room} ${
                    rectangleEditorBounds ? styles.roomRectangleEditor : ""
                } ${isUnplacedDropTarget ? styles.roomDropTarget : ""}`}
                style={rectangleEditorRoomStyle}
                role="group"
                aria-label={`План комнаты ${room.width} на ${room.depth} миллиметров`}
                data-manual-drop-room="true"
                data-room-editing={isRoomEditing ? "true" : "false"}
                data-room-shape={room.geometry?.kind ?? "rect"}
                onDragOver={handleUnplacedDragOver}
                onDragLeave={handleUnplacedDragLeave}
                onDrop={handleUnplacedDrop}
            >
                <svg
                    className={styles.roomBoundary}
                    viewBox={`0 0 ${room.width} ${room.depth}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <polygon points={polygonPoints} />
                    {boundarySegments.map((segment) => (
                        <line
                            key={segment.id}
                            x1={segment.start.x}
                            y1={segment.start.y}
                            x2={segment.end.x}
                            y2={segment.end.y}
                            data-room-segment={segment.id}
                        />
                    ))}
                </svg>

                <div
                    className={styles.gridLayer}
                    style={{ clipPath: polygonClip }}
                    aria-hidden="true"
                >
                    {gridLines.map((line) => (
                        <React.Fragment key={line}>
                            <span
                                className={styles.gridVertical}
                                style={{ left: `${line * 10}%` }}
                            />
                            <span
                                className={styles.gridHorizontal}
                                style={{ top: `${line * 10}%` }}
                            />
                        </React.Fragment>
                    ))}
                </div>

                {room.geometry?.kind !== "orthogonal" && (
                    <div className={styles.roomWalls} aria-hidden="true">
                        <span
                            className={`${styles.roomWall} ${styles.roomWallTop}`}
                            data-room-wall="top"
                        />
                        <span
                            className={`${styles.roomWall} ${styles.roomWallRight}`}
                            data-room-wall="right"
                        />
                        <span
                            className={`${styles.roomWall} ${styles.roomWallBottom}`}
                            data-room-wall="bottom"
                        />
                        <span
                            className={`${styles.roomWall} ${styles.roomWallLeft}`}
                            data-room-wall="left"
                        />
                    </div>
                )}

                {getPartitionObstacleRects(room).map((partition, index) => (
                    <span
                        key={`partition-solid-${index}`}
                        className={styles.partition}
                        style={{
                            left: `${(partition.x / room.width) * 100}%`,
                            top: `${(partition.y / room.depth) * 100}%`,
                            width: `${(partition.width / room.width) * 100}%`,
                            height: `${(partition.depth / room.depth) * 100}%`,
                        }}
                        data-room-partition="true"
                        aria-label="Внутренняя перегородка"
                    />
                ))}

                {isRoomEditing && (
                    <>
                        <button
                            type="button"
                            className={`${styles.roomResizeHandle} ${styles.roomResizeWidth}`}
                            aria-label="Изменить ширину комнаты: тяните правую стену или используйте стрелки влево и вправо"
                            aria-keyshortcuts="ArrowLeft ArrowRight"
                            onPointerDown={(event) => beginRoomResizeDrag(event, "width")}
                            onPointerMove={moveRoomResizeDrag}
                            onPointerUp={finishRoomResizeDrag}
                            onPointerCancel={(event) => cancelRoomResizeDrag(event.pointerId)}
                            onLostPointerCapture={(event) => cancelRoomResizeDrag(event.pointerId)}
                            onKeyDown={(event) => handleRoomResizeKeyDown(event, "width")}
                        />
                        <button
                            type="button"
                            className={`${styles.roomResizeHandle} ${styles.roomResizeDepth}`}
                            aria-label="Изменить глубину комнаты: тяните нижнюю стену или используйте стрелки вверх и вниз"
                            aria-keyshortcuts="ArrowUp ArrowDown"
                            onPointerDown={(event) => beginRoomResizeDrag(event, "depth")}
                            onPointerMove={moveRoomResizeDrag}
                            onPointerUp={finishRoomResizeDrag}
                            onPointerCancel={(event) => cancelRoomResizeDrag(event.pointerId)}
                            onLostPointerCapture={(event) => cancelRoomResizeDrag(event.pointerId)}
                            onKeyDown={(event) => handleRoomResizeKeyDown(event, "depth")}
                        />
                    </>
                )}

                {isRoomEditing && (
                    <>
                        {boundarySegments.map((segment, index) => {
                            const horizontal = segment.orientation === "horizontal";
                            const controlLayout = getSegmentEditorControlLayout(
                                room,
                                segment,
                                index,
                                boundarySegments.length,
                            );
                            const outwardDistance = 34 + controlLayout.outsideLane * 18;
                            // The label shares the handle's lane and sits beside it along the
                            // wall: half the handle, half a label and a small gap away.
                            const alongSign =
                                controlLayout.labelSide *
                                Math.sign(
                                    horizontal
                                        ? segment.end.x - segment.start.x
                                        : segment.end.y - segment.start.y,
                                );
                            const alongShift = `calc(${alongSign} * (var(--editor-control-scale, 1) * 22px + ${WALL_DIMENSION_HALF_LENGTH_PX + 6}px))`;
                            const outwardShift = (normal: number) =>
                                `calc(var(--editor-control-scale, 1) * ${-normal * outwardDistance}px)`;
                            const dimensionStyle = horizontal
                                ? {
                                      left: `${(controlLayout.point.x / room.width) * 100}%`,
                                      top: `${(controlLayout.point.y / room.depth) * 100}%`,
                                      "--wall-dimension-shift-x": alongShift,
                                      "--wall-dimension-shift-y": outwardShift(
                                          segment.inwardNormal.y,
                                      ),
                                  }
                                : {
                                      left: `${(controlLayout.point.x / room.width) * 100}%`,
                                      top: `${(controlLayout.point.y / room.depth) * 100}%`,
                                      "--wall-dimension-shift-x": outwardShift(
                                          segment.inwardNormal.x,
                                      ),
                                      "--wall-dimension-shift-y": alongShift,
                                  };
                            const handleStyle = {
                                left: `${(controlLayout.point.x / room.width) * 100}%`,
                                top: `${(controlLayout.point.y / room.depth) * 100}%`,
                                "--segment-handle-shift-x": `calc(var(--editor-control-scale, 1) * ${
                                    -segment.inwardNormal.x * outwardDistance
                                }px)`,
                                "--segment-handle-shift-y": `calc(var(--editor-control-scale, 1) * ${
                                    -segment.inwardNormal.y * outwardDistance
                                }px)`,
                            } as React.CSSProperties;
                            return (
                                <React.Fragment key={`${segment.id}-editor`}>
                                    <span
                                        className={`${styles.wallDimension} ${
                                            horizontal
                                                ? styles.wallDimensionHorizontal
                                                : styles.wallDimensionVertical
                                        }`}
                                        style={dimensionStyle as React.CSSProperties}
                                        data-wall-dimension={segment.id}
                                        aria-hidden="true"
                                    >
                                        {formatMeters(segment.length)}
                                    </span>
                                    <button
                                        type="button"
                                        className={`${styles.roomSegmentHandle} ${
                                            horizontal
                                                ? styles.roomSegmentHandleHorizontal
                                                : styles.roomSegmentHandleVertical
                                        } ${controlLayout.blocked ? styles.roomSegmentHandleBlocked : ""}`}
                                        style={handleStyle}
                                        data-room-segment-handle={segment.id}
                                        data-blocked={controlLayout.blocked ? "true" : "false"}
                                        aria-disabled={controlLayout.blocked}
                                        aria-describedby={
                                            controlLayout.blocked
                                                ? "room-editor-blocked-summary"
                                                : undefined
                                        }
                                        aria-label={`Середина стены ${formatMeters(segment.length)}. ${controlLayout.reason}`}
                                        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
                                        title={
                                            controlLayout.blocked ? controlLayout.reason : undefined
                                        }
                                        onPointerDown={(event) =>
                                            beginRoomSegmentSplitDrag(event, segment.id)
                                        }
                                        onPointerMove={moveRoomSegmentSplitDrag}
                                        onPointerUp={finishRoomSegmentSplitDrag}
                                        onPointerCancel={(event) =>
                                            cancelRoomSegmentSplitDrag(event.pointerId)
                                        }
                                        onLostPointerCapture={finishLostRoomSegmentSplitDrag}
                                        onKeyDown={(event) =>
                                            handleRoomSegmentSplitKeyDown(event, segment)
                                        }
                                    />
                                </React.Fragment>
                            );
                        })}
                        {roomVertices.map((vertex) => {
                            const notch = getLRoomNotch(room);
                            const isNotch = notch?.x === vertex.x && notch.y === vertex.y;
                            return (
                                <button
                                    key={`${vertex.id}-vertex`}
                                    type="button"
                                    className={styles.roomVertexHandle}
                                    style={{
                                        left: `${(vertex.x / room.width) * 100}%`,
                                        top: `${(vertex.y / room.depth) * 100}%`,
                                    }}
                                    data-room-vertex={vertex.id}
                                    {...(isNotch ? { "data-room-notch": "true" } : {})}
                                    aria-label={
                                        isNotch
                                            ? `Внутренний угол комнаты: X ${vertex.x} мм, Y ${vertex.y} мм. Перетаскивайте или используйте стрелки.`
                                            : `Угол комнаты: X ${vertex.x} мм, Y ${vertex.y} мм. Перетаскивайте или используйте стрелки.`
                                    }
                                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
                                    onPointerDown={(event) => beginRoomVertexDrag(event, vertex)}
                                    onPointerMove={moveRoomVertexDrag}
                                    onPointerUp={finishRoomVertexDrag}
                                    onPointerCancel={(event) =>
                                        cancelRoomVertexDrag(event.pointerId)
                                    }
                                    onLostPointerCapture={(event) =>
                                        cancelRoomVertexDrag(event.pointerId)
                                    }
                                    onKeyDown={(event) => handleRoomVertexKeyDown(event, vertex)}
                                />
                            );
                        })}
                    </>
                )}

                {room.windows.map((window, index) => {
                    const { horizontal, style: windowStyle } = openingLinePresentation(
                        room,
                        window,
                    );

                    return (
                        <button
                            key={window.id}
                            type="button"
                            className={`${styles.window} ${
                                horizontal ? styles.horizontalOpening : styles.verticalOpening
                            }`}
                            style={windowStyle}
                            data-room-opening="window"
                            data-wall={window.wall}
                            data-window-kind={window.windowKind ?? "standard"}
                            aria-label={`Окно ${index + 1}: ${WALL_LABELS[window.wall]}, отступ ${
                                window.offset
                            } мм. ${
                                isRoomEditing
                                    ? "Перетаскивайте вдоль стены или используйте стрелки."
                                    : "Включите режим редактирования комнаты, чтобы сдвинуть окно."
                            }`}
                            aria-keyshortcuts={
                                horizontal ? "ArrowLeft ArrowRight" : "ArrowUp ArrowDown"
                            }
                            tabIndex={isRoomEditing ? 0 : -1}
                            onPointerDown={(event) => beginOpeningDrag(event, "window", window)}
                            onPointerMove={moveOpeningDrag}
                            onPointerUp={finishOpeningDrag}
                            onPointerCancel={(event) => cancelOpeningDrag(event.pointerId)}
                            onLostPointerCapture={(event) => cancelOpeningDrag(event.pointerId)}
                            onKeyDown={(event) => handleOpeningKeyDown(event, "window", window)}
                        />
                    );
                })}

                {room.doors.map((door, index) => {
                    const obstacle = getDoorObstacle(door, room);
                    const swingObstacle = getDoorSwingObstacle(door, room);
                    const { horizontal, style: lineStyle } = openingLinePresentation(room, door);

                    return (
                        <React.Fragment key={door.id}>
                            {showClearances && (
                                <span
                                    className={styles.doorClearance}
                                    style={{
                                        left: `${(obstacle.x / room.width) * 100}%`,
                                        top: `${(obstacle.y / room.depth) * 100}%`,
                                        width: `${(obstacle.width / room.width) * 100}%`,
                                        height: `${(obstacle.depth / room.depth) * 100}%`,
                                    }}
                                    aria-hidden="true"
                                />
                            )}
                            <span
                                className={styles.doorSwing}
                                data-wall={door.wall}
                                data-partition-door={door.partitionId ? "true" : undefined}
                                data-hinge={door.hinge ?? "start"}
                                data-swing-direction={door.swingDirection ?? "inward"}
                                style={{
                                    left: `${(swingObstacle.x / room.width) * 100}%`,
                                    top: `${(swingObstacle.y / room.depth) * 100}%`,
                                    width: `${(swingObstacle.width / room.width) * 100}%`,
                                    height: `${(swingObstacle.depth / room.depth) * 100}%`,
                                }}
                                aria-hidden="true"
                            />
                            <button
                                type="button"
                                className={`${styles.door} ${
                                    horizontal ? styles.horizontalOpening : styles.verticalOpening
                                }`}
                                style={lineStyle}
                                data-room-opening="door"
                                data-wall={door.wall}
                                data-partition-door={door.partitionId ? "true" : undefined}
                                data-swing-direction={door.swingDirection ?? "inward"}
                                data-door-kind={door.doorKind ?? "room"}
                                aria-label={`Дверь ${index + 1}: ${WALL_LABELS[door.wall]}, отступ ${
                                    door.offset
                                } мм. ${
                                    isRoomEditing
                                        ? "Перетаскивайте вдоль стены или используйте стрелки."
                                        : "Включите режим редактирования комнаты, чтобы сдвинуть дверь."
                                }`}
                                aria-keyshortcuts={
                                    horizontal ? "ArrowLeft ArrowRight" : "ArrowUp ArrowDown"
                                }
                                tabIndex={isRoomEditing ? 0 : -1}
                                onPointerDown={(event) => beginOpeningDrag(event, "door", door)}
                                onPointerMove={moveOpeningDrag}
                                onPointerUp={finishOpeningDrag}
                                onPointerCancel={(event) => cancelOpeningDrag(event.pointerId)}
                                onLostPointerCapture={(event) => cancelOpeningDrag(event.pointerId)}
                                onKeyDown={(event) => handleOpeningKeyDown(event, "door", door)}
                            />
                        </React.Fragment>
                    );
                })}

                {(room.radiators ?? []).map((radiator, index) => {
                    const body = getRadiatorBody(radiator, room);
                    const service = getRadiatorServiceObstacle(radiator, room);

                    return (
                        <React.Fragment key={radiator.id}>
                            {showClearances && (
                                <span
                                    className={styles.radiatorClearance}
                                    style={{
                                        left: `${(service.x / room.width) * 100}%`,
                                        top: `${(service.y / room.depth) * 100}%`,
                                        width: `${(service.width / room.width) * 100}%`,
                                        height: `${(service.depth / room.depth) * 100}%`,
                                    }}
                                    aria-hidden="true"
                                />
                            )}
                            <button
                                type="button"
                                className={styles.radiator}
                                style={{
                                    left: `${(body.x / room.width) * 100}%`,
                                    top: `${(body.y / room.depth) * 100}%`,
                                    width: `${(body.width / room.width) * 100}%`,
                                    height: `${(body.depth / room.depth) * 100}%`,
                                }}
                                data-room-obstacle="radiator"
                                data-wall={radiator.wall}
                                aria-label={`Радиатор ${index + 1}: ${
                                    WALL_LABELS[radiator.wall]
                                }, отступ ${radiator.offset} мм. ${
                                    isRoomEditing
                                        ? "Перетаскивайте вдоль стены или используйте стрелки."
                                        : "Включите режим редактирования комнаты, чтобы сдвинуть радиатор."
                                }`}
                                aria-keyshortcuts={
                                    radiator.wall === "top" || radiator.wall === "bottom"
                                        ? "ArrowLeft ArrowRight"
                                        : "ArrowUp ArrowDown"
                                }
                                tabIndex={isRoomEditing ? 0 : -1}
                                onPointerDown={(event) =>
                                    beginOpeningDrag(event, "radiator", radiator)
                                }
                                onPointerMove={moveOpeningDrag}
                                onPointerUp={finishOpeningDrag}
                                onPointerCancel={(event) => cancelOpeningDrag(event.pointerId)}
                                onLostPointerCapture={(event) => cancelOpeningDrag(event.pointerId)}
                                onKeyDown={(event) =>
                                    handleOpeningKeyDown(event, "radiator", radiator)
                                }
                            />
                        </React.Fragment>
                    );
                })}

                {showClearances &&
                    placements.flatMap((placement) =>
                        getWorldClearanceRects(placement).map((clearance, index) => (
                            <span
                                key={`${placement.instanceId}-clearance-${index}`}
                                className={styles.clearanceZone}
                                style={{
                                    left: `${(clearance.x / room.width) * 100}%`,
                                    top: `${(clearance.y / room.depth) * 100}%`,
                                    width: `${(clearance.width / room.width) * 100}%`,
                                    height: `${(clearance.depth / room.depth) * 100}%`,
                                }}
                                title={clearance.label}
                                aria-hidden="true"
                            />
                        )),
                    )}

                {placements.map((placement) => {
                    const definition = getFurniture(placement.definitionId);
                    const geometry = getRotatedGeometry(definition, placement.rotation, placement);
                    const baseGeometry = getRotatedGeometry(definition, 0, placement);
                    const photo = getFurniturePhoto(definition.id, placement.photoId);
                    const assetKey = photo?.id ?? definition.assetKey;
                    const asset = getFurnitureAsset(definition.id, placement.photoId);
                    const selected = placement.instanceId === selectedInstanceId;
                    const invalid = invalidInstanceIds.has(placement.instanceId);
                    const dragging = placement.instanceId === draggingInstanceId;
                    const assetFailed = assetKey ? failedAssetKeys.has(assetKey) : false;
                    const assetLoaded = Boolean(
                        asset && assetKey && loadedAssetKeys.has(assetKey) && !assetFailed,
                    );
                    const imageRectIndex = asset?.bodyRectIndex;
                    const imageRect =
                        imageRectIndex === undefined
                            ? { x: 0, y: 0, width: geometry.width, depth: geometry.depth }
                            : geometry.bodyRects[imageRectIndex];
                    const baseImageRect =
                        imageRectIndex === undefined
                            ? { x: 0, y: 0, width: baseGeometry.width, depth: baseGeometry.depth }
                            : baseGeometry.bodyRects[imageRectIndex];
                    const correctionSwapsAxes = asset ? asset.baseRotation % 180 !== 0 : false;
                    const sourceWidth = correctionSwapsAxes
                        ? baseImageRect?.depth
                        : baseImageRect?.width;
                    const sourceHeight = correctionSwapsAxes
                        ? baseImageRect?.width
                        : baseImageRect?.depth;
                    const totalImageRotation = asset
                        ? normalizeRotation(asset.baseRotation + placement.rotation)
                        : 0;

                    return (
                        <button
                            key={placement.instanceId}
                            type="button"
                            className={`${styles.furniture} ${
                                selected ? styles.selectedFurniture : ""
                            } ${invalid ? styles.invalidFurniture : ""} ${
                                definition.body.kind === "circle" ? styles.roundFurniture : ""
                            } ${dragging ? styles.draggingFurniture : ""}`}
                            data-visual={definition.visualKind}
                            style={{
                                left: `${(placement.x / room.width) * 100}%`,
                                top: `${(placement.y / room.depth) * 100}%`,
                                width: `${(geometry.width / room.width) * 100}%`,
                                height: `${(geometry.depth / room.depth) * 100}%`,
                            }}
                            onClick={(event) => {
                                if (suppressClickRef.current === placement.instanceId) {
                                    suppressClickRef.current = null;
                                    event.preventDefault();
                                    return;
                                }
                                onSelect(placement.instanceId);
                            }}
                            onFocus={() => onSelect(placement.instanceId)}
                            onPointerDown={(event) => beginDrag(event, placement)}
                            onPointerMove={moveDrag}
                            onPointerUp={finishDrag}
                            onPointerCancel={(event) => cancelActiveDrag(event.pointerId)}
                            onLostPointerCapture={(event) => {
                                if (
                                    dragSessionRef.current?.instanceId === placement.instanceId &&
                                    dragSessionRef.current.pointerId === event.pointerId
                                ) {
                                    cancelActiveDrag(event.pointerId);
                                }
                            }}
                            onKeyDown={(event) =>
                                handleFurnitureKeyDown(event, placement.instanceId)
                            }
                            draggable={false}
                            aria-label={`${definition.label}${instanceNumber(
                                placement.instanceId,
                            )}, координаты ${placement.x} на ${placement.y}, поворот ${
                                placement.rotation
                            } градусов${invalid ? ", есть ошибка" : ""}`}
                            aria-pressed={selected}
                            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight R Escape"
                        >
                            {geometry.bodyRects.map((rect, index) => (
                                <span
                                    key={`${placement.instanceId}-body-${index}`}
                                    className={`${styles.furniturePiece} ${
                                        (photo || assetLoaded) &&
                                        (imageRectIndex === undefined || imageRectIndex === index)
                                            ? styles.photographedPiece
                                            : ""
                                    }`}
                                    style={{
                                        left: `${(rect.x / geometry.width) * 100}%`,
                                        top: `${(rect.y / geometry.depth) * 100}%`,
                                        width: `${(rect.width / geometry.width) * 100}%`,
                                        height: `${(rect.depth / geometry.depth) * 100}%`,
                                    }}
                                />
                            ))}
                            {photo && (
                                <svg
                                    viewBox={`0 0 ${geometry.width} ${geometry.depth}`}
                                    width="100%"
                                    height="100%"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        pointerEvents: "none",
                                    }}
                                    aria-hidden="true"
                                >
                                    <g
                                        transform={
                                            placement.rotation === 90
                                                ? `translate(${baseGeometry.depth} 0) rotate(90)`
                                                : placement.rotation === 180
                                                  ? `translate(${baseGeometry.width} ${baseGeometry.depth}) rotate(180)`
                                                  : placement.rotation === 270
                                                    ? `translate(0 ${baseGeometry.width}) rotate(270)`
                                                    : undefined
                                        }
                                    >
                                        <svg width={baseGeometry.width} height={baseGeometry.depth}>
                                            <FurniturePhoto photo={photo} />
                                        </svg>
                                    </g>
                                </svg>
                            )}
                            {!photo &&
                                asset &&
                                !assetFailed &&
                                imageRect &&
                                baseImageRect &&
                                sourceWidth &&
                                sourceHeight && (
                                    <span
                                        className={`${styles.furnitureImageClip} ${
                                            definition.body.kind === "circle"
                                                ? styles.roundFurnitureImage
                                                : ""
                                        }`}
                                        style={{
                                            left: `${(imageRect.x / geometry.width) * 100}%`,
                                            top: `${(imageRect.y / geometry.depth) * 100}%`,
                                            width: `${(imageRect.width / geometry.width) * 100}%`,
                                            height: `${(imageRect.depth / geometry.depth) * 100}%`,
                                        }}
                                        aria-hidden="true"
                                    >
                                        {/* Optimized local cutouts intentionally bypass Next image transforms. */}
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            className={styles.furnitureImage}
                                            src={asset.src}
                                            alt=""
                                            draggable={false}
                                            onDragStart={(event) => event.preventDefault()}
                                            onLoad={() =>
                                                setLoadedAssetKeys((current) => {
                                                    if (!assetKey || current.has(assetKey))
                                                        return current;
                                                    return new Set(current).add(assetKey);
                                                })
                                            }
                                            onError={() =>
                                                setFailedAssetKeys((current) =>
                                                    assetKey
                                                        ? new Set(current).add(assetKey)
                                                        : current,
                                                )
                                            }
                                            style={{
                                                width: `${(sourceWidth / imageRect.width) * 100}%`,
                                                height: `${(sourceHeight / imageRect.depth) * 100}%`,
                                                transform: `translate(-50%, -50%) rotate(${totalImageRotation}deg)`,
                                            }}
                                        />
                                    </span>
                                )}
                            {selected && (
                                <>
                                    <span className={styles.furnitureLabel}>
                                        {definition.shortLabel}
                                    </span>
                                    <span className={styles.grabCue} aria-hidden="true" />
                                    <span className={styles.rotationMark} aria-hidden="true">
                                        {placement.rotation}°
                                    </span>
                                </>
                            )}
                        </button>
                    );
                })}

                {phase === "solving" && (
                    <div className={styles.canvasOverlay} role="status">
                        <span className={styles.loader} aria-hidden="true" />
                        <strong>Собираем планировку</strong>
                        <span>Проверяем стены, проходы и доступ к мебели.</span>
                    </div>
                )}
            </div>
        </div>
    );
};
const Planner: React.FC<PlannerProps> = ({ handoffId, drawRoomDraft = false }) => {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const [room, setRoom] = useState<Room>(DEFAULT_ROOM);
    const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);
    const [priorities, setPriorities] =
        useState<Record<string, FurniturePriority>>(DEFAULT_PRIORITIES);
    const [tvTargetCategory, setTvTargetCategory] = useState<"sleep" | "living" | undefined>();
    const [placements, setPlacements] = useState<Placement[]>(
        initialResult.status === "success" ? initialResult.placements : [],
    );
    const [placementHistory, setPlacementHistory] = useState(() =>
        createPlacementHistory(initialResult.status === "success" ? initialResult.placements : []),
    );
    const [previewPlacement, setPreviewPlacement] = useState<Placement | null>(null);
    const [variants, setVariants] = useState<LayoutVariant[]>([]);
    const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
    const [editedVariantIds, setEditedVariantIds] = useState<Set<string>>(() => new Set());
    const [lastResult, setLastResult] = useState<LayoutResult>(initialResult);
    const [phase, setPhase] = useState<PlannerPhase>("result");
    const [hasRequestedLayoutCalculation, setHasRequestedLayoutCalculation] = useState(false);
    const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
        initialResult.status === "success" ? initialResult.placements[0]?.instanceId ?? null : null,
    );
    const [showClearances, setShowClearances] = useState(false);
    const [isRoomEditing, setIsRoomEditing] = useState(false);
    const [isRoomEditGestureActive, setIsRoomEditGestureActive] = useState(false);
    const [generatedSignature, setGeneratedSignature] = useState<string | null>(
        selectionSignature(DEFAULT_ROOM, DEFAULT_SELECTION, DEFAULT_PRIORITIES, {}),
    );
    const [resultNotice, setResultNotice] = useState("");
    const [isManualScene, setIsManualScene] = useState(false);
    const [isDrawingLayout, setIsDrawingLayout] = useState(false);
    const [designLabFeedback, setDesignLabFeedback] = useState<DesignLabFeedbackEntry[]>([]);
    const [designLabVerdict, setDesignLabVerdict] = useState<DesignLabVerdict>("needs-fix");
    const [designLabNote, setDesignLabNote] = useState("");
    const [designLabNotice, setDesignLabNotice] = useState("");
    const [observationRequestsByVariant, setObservationRequestsByVariant] = useState<
        Record<string, PlannerObservationCreateInput>
    >({});
    const [observationIdsByVariant, setObservationIdsByVariant] = useState<Record<string, number>>(
        {},
    );
    const [observationStatesByVariant, setObservationStatesByVariant] = useState<
        Record<string, ObservationSaveState>
    >({});
    const [observationReviewDrafts, setObservationReviewDrafts] = useState<
        Record<string, ObservationReviewDraft>
    >({});
    const [observationNotice, setObservationNotice] = useState("");
    const [handoffSource, setHandoffSource] = useState<HandoffSourceState | null>(null);
    const [handoffWarning, setHandoffWarning] = useState("");
    const [draftReady, setDraftReady] = useState(false);
    const [draftWritable, setDraftWritable] = useState(false);
    const [draftCanReset, setDraftCanReset] = useState(false);
    const [draftNotice, setDraftNotice] = useState("");
    const [draftWarning, setDraftWarning] = useState("");
    const [automaticRemovalProposal, setAutomaticRemovalProposal] =
        useState<AutomaticRemovalProposal | null>(null);
    const [unplacedPreferredInstanceIds, setUnplacedPreferredInstanceIds] = useState<string[]>([]);
    const [removedItems, setRemovedItems] = useState<RemovalRecord[]>([]);
    const [manualRemovalTarget, setManualRemovalTarget] = useState<Placement | null>(null);
    const [generatedAt, setGeneratedAt] = useState<string | null>(null);
    const [exportStatus, setExportStatus] = useState("");
    const [planZoom, setPlanZoom] = useState(1);
    const [activeWorkspaceTool, setActiveWorkspaceTool] = useState<WorkspaceTool>("room");
    const [catalogSearch, setCatalogSearch] = useState("");
    const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("all");
    const [planFit, setPlanFit] = useState<{ width: number; maxHeight: number }>({
        width: 0,
        maxHeight: 0,
    });
    const [fullscreenSupported, setFullscreenSupported] = useState(false);
    const [planFullscreen, setPlanFullscreen] = useState(false);
    const activeSolverWorker = useRef<ActiveSolverWorker | null>(null);
    const solverRequestId = useRef(0);
    const handledHandoffId = useRef<string | null>(null);
    const draftRead = useRef(false);
    const drawRoomHandoffRead = useRef(false);
    const draftingBoardRef = useRef<HTMLDivElement | null>(null);
    const planPanViewportRef = useRef<HTMLDivElement | null>(null);
    const rectangleEditFitReferenceRef = useRef<RectangleEditFitReference | null>(null);
    const removalRecordArchiveRef = useRef<Map<string, RemovalRecord>>(new Map());
    const undoButtonRef = useRef<HTMLButtonElement | null>(null);
    const latestSignatureRef = useRef<string | null>(null);
    const manualSourceDragRef = useRef<ManualSourceDragSession | null>(null);
    const suppressManualSourceClickRef = useRef<string | null>(null);
    const manualPlacementSessionSignatureRef = useRef<string | null>(generatedSignature);
    const latestManualPlacementsRef = useRef<Placement[]>(placements);

    useEffect(() => {
        if (!isRoomEditing || room.geometry?.kind === "orthogonal") {
            rectangleEditFitReferenceRef.current = null;
        }
    }, [isRoomEditing, room.geometry?.kind]);

    const updatePlanFit = useCallback(() => {
        const viewport = planPanViewportRef.current;
        if (!viewport || typeof window === "undefined") return;

        const viewportRect = viewport.getBoundingClientRect();
        // The viewport has a 1px focus-safe inset on both sides. Keeping that
        // inset out of the fit calculation prevents the browser from exposing
        // a cosmetic horizontal scrollbar at the default 100% zoom.
        const availableWidth = Math.max(0, viewport.clientWidth - PLAN_FIT_VIEWPORT_INSET_PX);
        const browserViewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const topInsideViewport = Math.max(0, viewportRect.top);
        // On the desktop worktable the drawing viewport is a flex item whose
        // usable height can be smaller than the browser space below its top
        // edge. Fit against the stricter value: using only window height made
        // the calculated room taller than its own viewport, clipping the
        // bottom wall and direct-edit controls at laptop heights.
        // Read the full client height: the inset is taken from the content
        // budget below. Subtracting it here shrank a viewport capped by its own
        // previous fit by 4 px on every scroll event, and scroll anchoring on
        // long pages turned that into an endless shrinking loop.
        const constrainedViewportHeight = Math.max(0, viewport.clientHeight);
        // While the board is below the page fold it has no visible height to
        // measure. Give it a practical provisional size until it enters the
        // viewport; once visible, fit must honour the actual remaining height
        // and never use that minimum (which would reintroduce mobile scrolling).
        const rectangleFitReference =
            isRoomEditing && room.geometry?.kind !== "orthogonal"
                ? (rectangleEditFitReferenceRef.current ??= {
                      width: room.width,
                      depth: room.depth,
                  })
                : null;
        const roomForFit = rectangleFitReference ?? room;
        const roomAspect = Math.max(roomForFit.width, 1) / Math.max(roomForFit.depth, 1);
        const isCompactEditor = isRoomEditing && window.matchMedia("(max-width: 640px)").matches;
        const measuredAvailableHeight = Math.max(
            0,
            Math.floor(browserViewportHeight - topInsideViewport - PLAN_FIT_VIEWPORT_BOTTOM_GAP),
        );
        const browserAvailableHeight =
            !isCompactEditor && measuredAvailableHeight < 220
                ? PLAN_FIT_OFFSCREEN_HEIGHT_PX
                : measuredAvailableHeight;
        // A compact editor may be entered while its previous fitted surface
        // is still tiny (for example after the user opened it from the bottom
        // of the mobile catalogue). That prior surface is not a meaningful
        // height constraint: measuring against it would preserve the tiny
        // fit forever. The browser area below the editor is the reliable
        // constraint in this one explicit direct-edit mode.
        const availableHeight = isCompactEditor
            ? browserAvailableHeight
            : constrainedViewportHeight > 0
              ? Math.min(browserAvailableHeight, constrainedViewportHeight)
              : browserAvailableHeight;
        const isPointerEditor =
            isRoomEditing && window.matchMedia(POINTER_EDITOR_MEDIA_QUERY).matches;
        const frameHorizontal = isPointerEditor
            ? PLAN_FIT_POINTER_EDITOR_FRAME_HORIZONTAL_PX
            : isRoomEditing
              ? PLAN_FIT_EDITOR_FRAME_HORIZONTAL_PX
              : PLAN_FIT_FRAME_HORIZONTAL_PX;
        const frameVertical = isPointerEditor
            ? PLAN_FIT_POINTER_EDITOR_FRAME_VERTICAL_PX
            : isRoomEditing
              ? PLAN_FIT_EDITOR_FRAME_VERTICAL_PX
              : PLAN_FIT_FRAME_VERTICAL_PX;
        const roomWidthForAvailableHeight = Math.max(
            0,
            (availableHeight - PLAN_FIT_VIEWPORT_INSET_PX - frameVertical) * roomAspect,
        );
        const calculatedFittedWidth = Math.max(
            0,
            Math.min(availableWidth, roomWidthForAvailableHeight + frameHorizontal),
        );
        const canReuseRectangleFit =
            rectangleFitReference &&
            rectangleFitReference.fittedWidth !== undefined &&
            Math.abs((rectangleFitReference.viewportWidth ?? 0) - window.innerWidth) < 1 &&
            Math.abs((rectangleFitReference.viewportHeight ?? 0) - browserViewportHeight) < 1;
        const fittedWidth =
            canReuseRectangleFit && rectangleFitReference?.fittedWidth !== undefined
                ? rectangleFitReference.fittedWidth
                : calculatedFittedWidth;

        if (rectangleFitReference && !canReuseRectangleFit) {
            // Corner editing intentionally preserves the opposite drawing
            // boundary. Keep the fitted scale stable while the browser
            // viewport is stable too, so a 50 mm keyboard move cannot make
            // the entire canvas re-round underneath the corner. The canvas
            // is deliberately allowed to refit after an actual window resize.
            rectangleFitReference.viewportWidth = window.innerWidth;
            rectangleFitReference.viewportHeight = browserViewportHeight;
            rectangleFitReference.fittedWidth = calculatedFittedWidth;
        }

        const fittedRoomWidth = Math.max(0, fittedWidth - frameHorizontal);
        const minimumRoomHeight = PLAN_FIT_MINIMUM_ROOM_CONTENT_PX / roomAspect;
        const hasUsableEditorContent =
            fittedRoomWidth >= PLAN_FIT_MINIMUM_ROOM_CONTENT_PX &&
            availableHeight >= frameVertical + minimumRoomHeight;

        // The mobile editor reserves space around the drawing for 44px hit
        // targets.  When the page is scrolled so far down that this frame is
        // taller than the remaining browser viewport, keeping the previous
        // fit (or the natural 100% fallback on first paint) is safer than
        // writing a frame-only width.  A mobile edit-entry effect below moves
        // the board into view and the following scroll event recomputes the
        // proper zero-overflow fit.
        if (isCompactEditor && !hasUsableEditorContent) return;

        setPlanFit((current) =>
            Math.abs(current.width - fittedWidth) < 1 &&
            Math.abs(current.maxHeight - availableHeight) < 1
                ? current
                : { width: fittedWidth, maxHeight: availableHeight },
        );
    }, [isRoomEditing, room]);

    useEffect(() => {
        if (
            !isRoomEditing ||
            typeof window === "undefined" ||
            !window.matchMedia("(max-width: 640px)").matches
        ) {
            return;
        }

        let firstFrame = 0;
        let secondFrame = 0;

        // Entering direct room editing is an explicit mode change, so it is a
        // good time to bring the canvas—not an arbitrary page position—into a
        // measurable part of the viewport. This is one normal document scroll
        // only; after it completes browser page scrolling remains untouched.
        firstFrame = window.requestAnimationFrame(() => {
            const rectangleFitReference = rectangleEditFitReferenceRef.current;
            if (rectangleFitReference) rectangleFitReference.fittedWidth = undefined;
            planPanViewportRef.current?.scrollIntoView({
                behavior: "auto",
                block: "center",
                inline: "nearest",
            });
            secondFrame = window.requestAnimationFrame(() => {
                const settledRectangleFitReference = rectangleEditFitReferenceRef.current;
                if (settledRectangleFitReference) {
                    settledRectangleFitReference.fittedWidth = undefined;
                }
                updatePlanFit();
            });
        });

        return () => {
            window.cancelAnimationFrame(firstFrame);
            window.cancelAnimationFrame(secondFrame);
        };
    }, [isRoomEditing, updatePlanFit]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        let animationFrame = 0;
        const schedulePlanFit = () => {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(updatePlanFit);
        };

        // Do not observe the plan viewport itself. Applying `planFit` changes
        // that element's box, so a ResizeObserver here becomes a resize → fit
        // → resize feedback loop and keeps unrelated controls in motion.
        // Window/visual viewport changes, room-mode changes and document
        // scrolling are sufficient triggers for a new fit.
        window.addEventListener("resize", schedulePlanFit);
        window.addEventListener("scroll", schedulePlanFit, { passive: true });
        window.visualViewport?.addEventListener("resize", schedulePlanFit);
        schedulePlanFit();

        return () => {
            window.cancelAnimationFrame(animationFrame);
            window.removeEventListener("resize", schedulePlanFit);
            window.removeEventListener("scroll", schedulePlanFit);
            window.visualViewport?.removeEventListener("resize", schedulePlanFit);
        };
    }, [updatePlanFit]);

    useEffect(() => {
        if (planZoom !== 1) return;
        planPanViewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "auto" });
    }, [planFit.width, planZoom]);

    const requiredDefinitionIds = useMemo(
        () => deriveRequiredDefinitionIds(selection, priorities),
        [priorities, selection],
    );

    const instances = useMemo(
        () => buildFurnitureInstancesExcludingRemoved(selection, priorities, removedItems),
        [priorities, removedItems, selection],
    );
    const normalizedCatalogSearch = catalogSearch.trim().toLocaleLowerCase("ru-RU");
    const visibleCatalogGroups = useMemo(
        () =>
            CATEGORY_ORDER.map((category) => ({
                category,
                definitions: FURNITURE_CATALOG.filter((definition) => {
                    const isSelected = (selection[definition.id] ?? 0) > 0;
                    const matchesFilter =
                        catalogFilter === "all" ||
                        (catalogFilter === "selected"
                            ? isSelected
                            : definition.category === catalogFilter);
                    const searchableText = [
                        definition.label,
                        definition.shortLabel,
                        CATEGORY_LABELS[definition.category],
                        getDefinitionDimensions(definition),
                    ]
                        .join(" ")
                        .toLocaleLowerCase("ru-RU");

                    return (
                        definition.category === category &&
                        matchesFilter &&
                        searchableText.includes(normalizedCatalogSearch)
                    );
                }),
            })).filter((group) => group.definitions.length > 0),
        [catalogFilter, normalizedCatalogSearch, selection],
    );
    const visibleCatalogItemCount = useMemo(
        () => visibleCatalogGroups.reduce((total, group) => total + group.definitions.length, 0),
        [visibleCatalogGroups],
    );
    const hasOptionalInstances = instances.some((instance) => instance.priority === "optional");
    const hasTv = (selection.tv ?? 0) > 0;
    const hasBed = BED_IDS.some((id) => (selection[id] ?? 0) > 0);
    const hasSofa = SOFA_IDS.some((id) => (selection[id] ?? 0) > 0);
    const blockedRoomEditorSegments = useMemo(() => {
        if (!isRoomEditing) return [];
        const segments = getRoomBoundarySegments(room);
        return segments.filter(
            (segment, index) =>
                getSegmentEditorControlLayout(room, segment, index, segments.length).blocked,
        );
    }, [isRoomEditing, room]);
    const tvTargetMissing = hasTv && !hasBed && !hasSofa;
    const tvTargetChoiceRequired = hasTv && hasBed && hasSofa && !tvTargetCategory;
    const tvGenerationBlocked = tvTargetMissing || tvTargetChoiceRequired;
    const effectivePreferences = useMemo<LayoutPreferences>(
        () => getLayoutPreferences(selection, tvTargetCategory),
        [selection, tvTargetCategory],
    );
    const currentSignature = useMemo(
        () =>
            selectionSignature(
                room,
                selection,
                priorities,
                effectivePreferences,
                removedItems.map((record) => record.instanceId),
            ),
        [effectivePreferences, priorities, removedItems, room, selection],
    );
    const isStale = currentSignature !== generatedSignature;
    const activeVariant = useMemo(
        () => variants.find((variant) => variant.variantId === activeVariantId) ?? null,
        [activeVariantId, variants],
    );
    const activeObservationId =
        activeVariant?.variantId ??
        (!isManualScene && observationRequestsByVariant[WORKING_CORE_OBSERVATION_ID]
            ? WORKING_CORE_OBSERVATION_ID
            : null);
    const isReviewingWorkingCore = activeObservationId === WORKING_CORE_OBSERVATION_ID;
    const activeObservationRequest = activeObservationId
        ? observationRequestsByVariant[activeObservationId]
        : undefined;
    const activeObservationState = activeObservationId
        ? observationStatesByVariant[activeObservationId] ?? "idle"
        : "idle";
    const activeObservationReview = activeObservationId
        ? observationReviewDrafts[activeObservationId] ?? EMPTY_OBSERVATION_REVIEW
        : EMPTY_OBSERVATION_REVIEW;
    const activeVariantHighlights = useMemo(
        () =>
            activeVariant
                ? explainLayoutForProfile(
                      room,
                      activeVariant.placements,
                      activeVariant.profile.id,
                      effectivePreferences,
                  )
                : [],
        [activeVariant, effectivePreferences, room],
    );

    useEffect(() => {
        latestSignatureRef.current = currentSignature;
        setAutomaticRemovalProposal((proposal) =>
            proposal && proposal.signature !== currentSignature ? null : proposal,
        );
    }, [currentSignature]);

    useEffect(() => {
        latestManualPlacementsRef.current = placements;
    }, [placements]);

    useEffect(() => {
        if (!draftReady) return;
        setRoom((current) => alignStarterOpeningsToRoom(current));
    }, [draftReady]);

    useEffect(() => {
        if (!isStale) return;
        setPlacementHistory(resetPlacementHistory(placements));
        setPreviewPlacement(null);
        setSelectedInstanceId(null);
        setManualRemovalTarget(null);
        setUnplacedPreferredInstanceIds([]);
        // A fresh room or questionnaire hand-off has no earlier layout to hide.
        if (generatedSignature === null) return;
        setResultNotice("Параметры изменены. Прежняя расстановка скрыта — уместите набор заново.");
    }, [generatedSignature, isStale, placements]);
    const displayedPlacements = useMemo(() => {
        if (!shouldShowPlannerLayout({ isStale, result: lastResult })) return [];
        return previewPlacement
            ? placements.map((placement) =>
                  placement.instanceId === previewPlacement.instanceId
                      ? previewPlacement
                      : placement,
              )
            : placements;
    }, [isStale, lastResult, placements, previewPlacement]);
    const validation = useMemo(
        () => validateLayout(room, displayedPlacements, effectivePreferences),
        [displayedPlacements, effectivePreferences, room],
    );
    const layoutMatchesSelection = useMemo(
        () => layoutMatchesFurnitureInstances(instances, placements),
        [instances, placements],
    );
    const unplacedPreferredInstances = useMemo(
        () =>
            unplacedPreferredInstanceIds
                .map((instanceId) =>
                    instances.find((instance) => instance.instanceId === instanceId),
                )
                .filter((instance): instance is FurnitureInstance => Boolean(instance)),
        [instances, unplacedPreferredInstanceIds],
    );
    const manualPlacementInstances = useMemo(() => {
        const placedInstanceIds = new Set(
            (isStale ? [] : placements).map((placement) => placement.instanceId),
        );
        return instances.filter((instance) => !placedInstanceIds.has(instance.instanceId));
    }, [instances, isStale, placements]);
    const hasPreferredFallback = !isStale && unplacedPreferredInstances.length > 0;
    const hasRequiredFallback = unplacedPreferredInstances.some(
        (instance) => instance.priority === "required",
    );
    const invalidInstanceIds = useMemo(
        () => new Set(validation.issues.flatMap((issue) => issue.instanceIds)),
        [validation.issues],
    );
    const activeValidationMessages = useMemo(
        () => Array.from(new Set(validation.issues.map((issue) => issue.message))),
        [validation.issues],
    );
    const roomGeometryError = useMemo(() => validateRoomGeometry(room), [room]);
    const designLabStatus = isManualScene
        ? validation.valid
            ? { label: "Рабочая сцена", tone: "working" }
            : { label: "Есть замечания", tone: "invalid" }
        : !hasRequestedLayoutCalculation
          ? roomGeometryError
              ? { label: "Контур требует исправления", tone: "invalid" }
              : { label: "Расстановка не рассчитана", tone: "idle" }
          : validation.valid
            ? { label: "Расстановка допустима", tone: "valid" }
            : { label: "Есть замечания", tone: "invalid" };
    const selectedPlacement = displayedPlacements.find(
        (placement) => placement.instanceId === selectedInstanceId,
    );
    const selectedDefinition = selectedPlacement
        ? getFurniture(selectedPlacement.definitionId)
        : null;
    const selectedAsset = selectedDefinition
        ? getFurnitureAsset(selectedDefinition.id, selectedPlacement?.photoId)
        : undefined;
    const selectedIssues = selectedInstanceId
        ? validation.issues.filter((issue) => issue.instanceIds.includes(selectedInstanceId))
        : [];
    const failure = useMemo<LayoutFailure | null>(
        () =>
            roomGeometryError
                ? {
                      status: "failure",
                      placements: [],
                      exploredNodes: 0,
                      blockingInstanceIds: [],
                      reason: "invalid-room",
                      message: roomGeometryError,
                  }
                : lastResult.status === "failure"
                  ? lastResult
                  : null,
        [lastResult, roomGeometryError],
    );
    const hasCompleteGeneratedPlan =
        !isStale &&
        Boolean(generatedAt) &&
        !previewPlacement &&
        !failure &&
        lastResult.status === "success" &&
        layoutMatchesSelection &&
        validation.valid;
    const hasFullVariants = hasCompleteGeneratedPlan && variants.length > 0;
    const resultNotes = useMemo(
        () => (lastResult.status === "success" ? lastResult.notes : []),
        [lastResult],
    );
    const radiatorCount = room.radiators?.length ?? 0;
    const partitionCount = room.partitions?.length ?? 0;
    const roomSegments = useMemo(() => getRoomBoundarySegments(room), [room]);
    const roomDoorSegments = useMemo(
        () => [...roomSegments, ...getRoomPartitionSegments(room)],
        [room, roomSegments],
    );
    const doorBoundsIssues = useMemo(
        () => new Map(room.doors.map((door) => [door.id, getDoorBoundsIssue(door, room)])),
        [room],
    );
    const windowBoundsIssues = useMemo(
        () =>
            new Map(
                room.windows.map((window) => [
                    window.id,
                    getWallItemBoundsIssue("Окно", window, room),
                ]),
            ),
        [room],
    );
    const radiatorBoundsIssues = useMemo(
        () =>
            new Map(
                (room.radiators ?? []).map((radiator) => [
                    radiator.id,
                    getRadiatorBoundsIssue(radiator, room),
                ]),
            ),
        [room],
    );
    const hasSpecificOpeningIssue =
        Array.from(doorBoundsIssues.values()).some(Boolean) ||
        Array.from(windowBoundsIssues.values()).some(Boolean) ||
        Array.from(radiatorBoundsIssues.values()).some(Boolean);
    const resultSpecification = useMemo<PlanSpecification | null>(() => {
        if (
            !generatedAt ||
            phase !== "result" ||
            isStale ||
            !layoutMatchesSelection ||
            failure ||
            placements.length === 0 ||
            !validation.valid ||
            previewPlacement
        ) {
            return null;
        }

        return buildPlanSpecification({
            room,
            placements,
            priorities,
            validation,
            removedItems,
            generatedAt,
            caveats: buildPlannerCaveats(resultNotes, isBetaBadgeEnabled, {
                hasDoorOpening: room.doors.length > 0,
                hasCircularFurniture: placements.some(
                    ({ definitionId }) => getFurniture(definitionId).body.kind === "circle",
                ),
            }),
        });
    }, [
        failure,
        generatedAt,
        isStale,
        layoutMatchesSelection,
        phase,
        placements,
        previewPlacement,
        priorities,
        removedItems,
        resultNotes,
        room,
        validation,
    ]);

    useEffect(() => {
        if (
            generatedAt ||
            phase !== "result" ||
            isStale ||
            lastResult.status !== "success" ||
            placements.length === 0 ||
            !validation.valid
        ) {
            return;
        }

        setGeneratedAt(new Date().toISOString());
    }, [generatedAt, isStale, lastResult.status, phase, placements.length, validation.valid]);

    useEffect(() => {
        setExportStatus("");
    }, [generatedAt]);

    useEffect(() => {
        const board = draftingBoardRef.current;
        setFullscreenSupported(Boolean(board?.requestFullscreen));

        const handleFullscreenChange = () => {
            setPlanFullscreen(document.fullscreenElement === draftingBoardRef.current);
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    useEffect(() => {
        if (!planFullscreen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const closeCssFullscreen = (event: KeyboardEvent) => {
            if (event.key === "Escape" && document.fullscreenElement !== draftingBoardRef.current) {
                event.preventDefault();
                setPlanFullscreen(false);
            }
        };
        document.addEventListener("keydown", closeCssFullscreen);

        return () => {
            document.removeEventListener("keydown", closeCssFullscreen);
            document.body.style.overflow = previousOverflow;
        };
    }, [planFullscreen]);

    const exportResultAsPng = useCallback(async () => {
        if (!resultSpecification) {
            setExportStatus("Сначала получите допустимый вариант расстановки.");
            return;
        }

        setExportStatus("Готовим PNG…");
        try {
            const blob = await renderPlanSpecificationPng(resultSpecification);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = getPlanExportFilename(resultSpecification.generatedAt);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            setExportStatus("PNG сохранён.");
        } catch (error) {
            setExportStatus(
                error instanceof Error
                    ? error.message
                    : "Не удалось сохранить PNG. Попробуйте ещё раз.",
            );
        }
    }, [resultSpecification]);

    const printResult = useCallback(() => {
        if (!resultSpecification) {
            setExportStatus("Сначала получите допустимый вариант расстановки.");
            return;
        }
        setExportStatus("Открываем системный диалог печати…");
        window.print();
    }, [resultSpecification]);

    const togglePlanFullscreen = useCallback(async () => {
        const board = draftingBoardRef.current;
        if (!board) return;

        if (planFullscreen && document.fullscreenElement !== board) {
            setPlanFullscreen(false);
            return;
        }

        try {
            if (document.fullscreenElement === board) {
                await document.exitFullscreen();
            } else if (fullscreenSupported) {
                await board.requestFullscreen();
            } else {
                setPlanFullscreen(true);
            }
        } catch {
            setPlanFullscreen(true);
            setResultNotice("Открыт полноэкранный режим внутри страницы.");
        }
    }, [fullscreenSupported, planFullscreen]);

    const updateSelection = useCallback(
        (definitionId: string, nextCount: number) => {
            setHandoffSource((current) => (current ? { ...current, modified: true } : current));
            const nextSelection = { ...selection };
            const limit = getSelectionLimit(definitionId, selection);
            const count = Math.max(0, Math.min(limit, nextCount));
            const previousCount = selection[definitionId] ?? 0;

            if (count > 0 && BED_IDS.includes(definitionId)) {
                BED_IDS.forEach((id) => {
                    if (id !== definitionId) nextSelection[id] = 0;
                });
            }

            if (count > 0 && SOFA_IDS.includes(definitionId)) {
                SOFA_IDS.forEach((id) => {
                    if (id !== definitionId) nextSelection[id] = 0;
                });
            }

            nextSelection[definitionId] = count;
            const nextPriorities: Record<string, FurniturePriority> = priorities[definitionId]
                ? priorities
                : { ...priorities, [definitionId]: "required" };

            const restoredIds = getRestoredRemovalRecordIds(
                removedItems,
                definitionId,
                previousCount,
                count,
            );
            const restoredSet = new Set(restoredIds);
            const nextRemovedItems =
                restoredSet.size > 0
                    ? removedItems.filter((record) => !restoredSet.has(record.instanceId))
                    : removedItems;
            const changedDefinitionIds = FURNITURE_CATALOG.filter(
                (definition) =>
                    (nextSelection[definition.id] ?? 0) !== (selection[definition.id] ?? 0),
            );
            const keepsGeneratedPlan =
                hasCompleteGeneratedPlan &&
                count > previousCount &&
                changedDefinitionIds.length === 1;

            setSelection(nextSelection);
            setPriorities(nextPriorities);
            setRemovedItems(nextRemovedItems);
            setAutomaticRemovalProposal(null);

            if (!keepsGeneratedPlan) {
                setResultNotice("Набор мебели изменён. Уместите набор заново.");
                return;
            }

            const nextSignature = selectionSignature(
                room,
                nextSelection,
                nextPriorities,
                getLayoutPreferences(nextSelection, tvTargetCategory),
                nextRemovedItems.map((record) => record.instanceId),
            );
            setVariants([]);
            setActiveVariantId(null);
            setEditedVariantIds(new Set());
            setUnplacedPreferredInstanceIds([]);
            setObservationRequestsByVariant({});
            setObservationIdsByVariant({});
            setObservationStatesByVariant({});
            setObservationReviewDrafts({});
            setPlacementHistory(resetPlacementHistory(placements));
            latestManualPlacementsRef.current = placements;
            manualPlacementSessionSignatureRef.current = nextSignature;
            setGeneratedSignature(nextSignature);
            setResultNotice(
                "Готовая расстановка сохранена. Добавьте новый предмет на свободное место на плане.",
            );
        },
        [
            hasCompleteGeneratedPlan,
            placements,
            priorities,
            removedItems,
            room,
            selection,
            tvTargetCategory,
        ],
    );

    const updatePriority = useCallback((definitionId: string, priority: FurniturePriority) => {
        setPriorities((current) => ({ ...current, [definitionId]: priority }));
        setHandoffSource((current) =>
            current
                ? {
                      ...current,
                      priorities: { ...current.priorities, [definitionId]: priority },
                      modified: true,
                  }
                : current,
        );
        setAutomaticRemovalProposal(null);
        setResultNotice(
            priority === "required"
                ? "Предмет отмечен как обязательный — автоматически он не удаляется."
                : priority === "optional"
                  ? "Предмет можно предложить к удалению только после доказанной невозможности и вашего подтверждения."
                  : "Предмет отмечен как желательный — планировщик постарается сохранить его.",
        );
    }, []);

    const updateRoomDimension = useCallback((dimension: "width" | "depth", value: number) => {
        setRoom((current) => {
            const result = tryResizeRoomWithDefaultOpenings(
                current,
                dimension === "width" ? value : current.width,
                dimension === "depth" ? value : current.depth,
            );
            if (result.status === "invalid") {
                setResultNotice(`Размер не применён: ${result.message}`);
                return current;
            }
            setResultNotice("");
            return result.room;
        });
    }, []);

    const resizeRoomDirectly = useCallback((width: number, depth: number) => {
        setRoom((current) => {
            const result = tryResizeRoomWithDefaultOpenings(current, width, depth);
            if (result.status === "invalid") {
                setResultNotice(`Размер не применён: ${result.message}`);
                return current;
            }
            setResultNotice("");
            return result.room;
        });
    }, []);

    const resizeRectangleBoundsDirectly = useCallback((bounds: RectangleEditBounds) => {
        setRoom((current) => {
            if (current.geometry?.kind === "orthogonal") return current;
            const nextWidth = bounds.right - bounds.left;
            const nextDepth = bounds.bottom - bounds.top;
            const result = tryResizeRoomWithDefaultOpenings(current, nextWidth, nextDepth);
            if (result.status === "invalid") {
                setResultNotice(`Угол не перемещён: ${result.message}`);
                return current;
            }
            setResultNotice("");
            return result.room;
        });
    }, []);

    const restoreRoomDirectly = useCallback((snapshot: Room) => {
        setRoom(cloneRoomForEditor(snapshot));
        setResultNotice("");
    }, []);

    const moveRoomVertexDirectly = useCallback(
        (vertexId: string, point: { x: number; y: number }) => {
            setRoom((current) => {
                if (current.geometry?.kind !== "orthogonal") {
                    const nextWidth =
                        vertexId === "rect-top-left" || vertexId === "rect-bottom-left"
                            ? current.width - point.x
                            : point.x;
                    const nextDepth =
                        vertexId === "rect-top-left" || vertexId === "rect-top-right"
                            ? current.depth - point.y
                            : point.y;
                    const result = tryResizeRoomWithDefaultOpenings(current, nextWidth, nextDepth);
                    if (result.status === "invalid") {
                        setResultNotice(`Угол не перемещён: ${result.message}`);
                        return current;
                    }
                    setResultNotice("");
                    return result.room;
                }
                const result = moveOrthogonalRoomVertex(current, vertexId, point);
                if (result.status === "invalid") {
                    setResultNotice(`Угол не перемещён: ${result.message}`);
                    return current;
                }
                const candidate = { ...current, geometry: result.geometry };
                const error = validateRoomGeometry(candidate);
                if (error) {
                    setResultNotice(`Угол не перемещён: ${error}`);
                    return current;
                }
                setResultNotice("");
                return candidate;
            });
        },
        [],
    );

    const splitRoomSegmentDirectly = useCallback(
        (segmentId: string, point: { x: number; y: number }) => {
            setRoom((current) => {
                const result = splitOrthogonalRoomSegment(current, segmentId, point);
                if (result.status === "invalid") {
                    setResultNotice(`Уступ не добавлен: ${result.message}`);
                    return current;
                }
                const candidate =
                    current.geometry?.kind === "orthogonal"
                        ? { ...current, geometry: result.geometry }
                        : applyRoomGeometry(
                              { ...current, geometry: result.geometry },
                              result.geometry,
                          );
                const error = validateRoomGeometry(candidate);
                if (error) {
                    setResultNotice(`Уступ не добавлен: ${error}`);
                    return current;
                }
                setResultNotice(
                    "Добавлен ортогональный уступ. Новые ручки появились на каждой части стены.",
                );
                return candidate;
            });
        },
        [],
    );

    const updateRoomShape = useCallback((shape: "rect" | "l-left" | "l-right") => {
        setRoom((current) =>
            applyRoomGeometry(
                current,
                shape === "rect"
                    ? { version: 1, kind: "rect" }
                    : createLRoomGeometry(
                          current.width,
                          current.depth,
                          shape === "l-left" ? "left" : "right",
                      ),
            ),
        );
        setIsRoomEditing(true);
        setResultNotice(
            shape === "rect"
                ? "Прямоугольная форма применена."
                : "Г-образная форма применена. Проверьте сегменты проёмов и пересчитайте план.",
        );
    }, []);

    const updateDoor = useCallback((doorId: string, patch: Partial<DoorOpening>) => {
        setRoom((current) => ({
            ...current,
            doors: current.doors.map((door) =>
                door.id === doorId ? clampDoorOpening({ ...door, ...patch }, current) : door,
            ),
        }));
        setResultNotice("");
    }, []);

    const convertWindowToBalconyDoor = useCallback((windowId: string) => {
        setRoom((current) => {
            const window = current.windows.find((item) => item.id === windowId);
            if (!window) return current;

            const door = clampDoorOpening(
                {
                    id: `door-balcony-${Date.now()}`,
                    wall: window.wall,
                    segmentId: window.segmentId,
                    offset: window.offset,
                    width: window.width,
                    clearanceDepth: window.width,
                    hinge: "start",
                    swingDirection: "inward",
                    doorKind: "balcony",
                },
                current,
            );

            return {
                ...current,
                doors: [...current.doors, door],
                windows: current.windows.filter((item) => item.id !== windowId),
            };
        });
        setResultNotice("Окно стало балконной дверью. Уточните петли и направление открывания.");
    }, []);

    const convertBalconyDoorToWindow = useCallback((doorId: string) => {
        setRoom((current) => {
            const door = current.doors.find((item) => item.id === doorId);
            if (
                !door ||
                door.partitionId ||
                door.doorKind !== "balcony" ||
                current.windows.length >= 2
            ) {
                return current;
            }

            return {
                ...current,
                doors: current.doors.filter((item) => item.id !== doorId),
                windows: [
                    ...current.windows,
                    {
                        id: `window-${Date.now()}`,
                        wall: door.wall,
                        segmentId: door.segmentId,
                        offset: door.offset,
                        width: door.width,
                        windowKind: "standard",
                    },
                ],
            };
        });
        setResultNotice("");
    }, []);

    const addWindow = useCallback(() => {
        setRoom((current) => {
            if (current.windows.length >= 2) return current;
            const occupiedSegments = new Set([
                ...current.doors.map((opening) => opening.segmentId),
                ...current.windows.map((opening) => opening.segmentId),
                ...(current.radiators ?? []).map((opening) => opening.segmentId),
            ]);
            const orthogonalSegments =
                current.geometry?.kind === "orthogonal"
                    ? getRoomBoundarySegments(current)
                          .filter((segment) => segment.length >= 1200)
                          .sort(
                              (first, second) =>
                                  second.length - first.length || first.id.localeCompare(second.id),
                          )
                    : [];
            const orthogonalSegment =
                orthogonalSegments.find((segment) => !occupiedSegments.has(segment.id)) ??
                orthogonalSegments[0];
            const candidate: WindowOpening = {
                id: `window-${Date.now()}`,
                wall:
                    orthogonalSegment?.wall ??
                    (current.windows[0]?.wall === "top" ? "right" : "top"),
                ...(orthogonalSegment ? { segmentId: orthogonalSegment.id } : {}),
                offset: 500,
                width: 1200,
                windowKind: "standard",
            };
            return {
                ...current,
                windows: [...current.windows, clampWallItem(candidate, current, 500)],
            };
        });
        setResultNotice("");
    }, []);

    const updateWindow = useCallback((id: string, patch: Partial<WindowOpening>) => {
        setRoom((current) => ({
            ...current,
            windows: current.windows.map((window) =>
                window.id === id ? clampWallItem({ ...window, ...patch }, current, 500) : window,
            ),
        }));
        setResultNotice("");
    }, []);

    const removeWindow = useCallback((id: string) => {
        setRoom((current) => ({
            ...current,
            windows: current.windows.filter((window) => window.id !== id),
        }));
        setResultNotice("");
    }, []);

    const addRadiator = useCallback(() => {
        setRoom((current) => {
            const radiators = current.radiators ?? [];
            if (radiators.length >= 2) return current;
            const occupiedSegments = new Set([
                ...current.doors.map((opening) => opening.segmentId),
                ...current.windows.map((opening) => opening.segmentId),
                ...radiators.map((opening) => opening.segmentId),
            ]);
            const orthogonalSegments =
                current.geometry?.kind === "orthogonal"
                    ? getRoomBoundarySegments(current)
                          .filter((segment) => segment.length >= 1000)
                          .sort(
                              (first, second) =>
                                  second.length - first.length || first.id.localeCompare(second.id),
                          )
                    : [];
            const orthogonalSegment =
                orthogonalSegments.find((segment) => !occupiedSegments.has(segment.id)) ??
                orthogonalSegments[0];
            const candidate: RadiatorObstacle = {
                id: `radiator-${Date.now()}`,
                wall:
                    orthogonalSegment?.wall ??
                    (radiators[0]?.wall === "bottom" ? "left" : "bottom"),
                ...(orthogonalSegment ? { segmentId: orthogonalSegment.id } : {}),
                offset: 1200,
                width: 1000,
                depth: 100,
                clearanceDepth: 300,
            };
            return {
                ...current,
                radiators: [...radiators, clampWallItem(candidate, current, 300)],
            };
        });
        setResultNotice("");
    }, []);

    const updateRadiator = useCallback((id: string, patch: Partial<RadiatorObstacle>) => {
        setRoom((current) => ({
            ...current,
            radiators: (current.radiators ?? []).map((radiator) =>
                radiator.id === id
                    ? clampWallItem(
                          {
                              ...radiator,
                              ...patch,
                              clearanceDepth: clamp(
                                  snapToGrid(patch.clearanceDepth ?? radiator.clearanceDepth),
                                  0,
                                  2000,
                              ),
                          },
                          current,
                          300,
                      )
                    : radiator,
            ),
        }));
        setResultNotice("");
    }, []);

    const removeRadiator = useCallback((id: string) => {
        setRoom((current) => ({
            ...current,
            radiators: (current.radiators ?? []).filter((radiator) => radiator.id !== id),
        }));
        setResultNotice("");
    }, []);

    const cancelActiveSolver = useCallback(() => {
        const activeRequest = activeSolverWorker.current;
        if (!activeRequest) return;

        activeSolverWorker.current = null;
        activeRequest.worker.terminate();
        activeRequest.reject(new Error(SOLVER_CANCELLED));
    }, []);

    const applyHandoffBaseline = useCallback(
        (baseline: HandoffBaseline) => {
            cancelActiveSolver();
            setSelection({ ...baseline.selection });
            setPriorities({ ...baseline.priorities });
            setTvTargetCategory(baseline.tvTargetCategory);
            setVariants([]);
            setActiveVariantId(null);
            setEditedVariantIds(new Set());
            setUnplacedPreferredInstanceIds([]);
            setPlacements([]);
            setPlacementHistory(resetPlacementHistory([]));
            setPreviewPlacement(null);
            setLastResult(initialResult);
            setGeneratedSignature(null);
            setSelectedInstanceId(null);
            setShowClearances(false);
            setResultNotice("");
            setIsManualScene(false);
            setDesignLabFeedback([]);
            setDesignLabNote("");
            setDesignLabNotice("");
            setObservationRequestsByVariant({});
            setObservationIdsByVariant({});
            setObservationStatesByVariant({});
            setObservationReviewDrafts({});
            setObservationNotice("");
            setGeneratedAt(null);
            setExportStatus("");
            setAutomaticRemovalProposal(null);
            setRemovedItems([]);
            setManualRemovalTarget(null);
            removalRecordArchiveRef.current.clear();
            setHasRequestedLayoutCalculation(false);
            setPhase("ready");
            setHandoffSource({
                ...baseline,
                selection: { ...baseline.selection },
                priorities: { ...baseline.priorities },
                modified: false,
                origin: "questionnaire",
            });
        },
        [cancelActiveSolver],
    );

    const restoreDemoState = useCallback(() => {
        cancelActiveSolver();
        const restoredPlacements =
            initialResult.status === "success" ? initialResult.placements : [];
        setRoom(DEFAULT_ROOM);
        setSelection(DEFAULT_SELECTION);
        setPriorities(DEFAULT_PRIORITIES);
        setTvTargetCategory(undefined);
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setUnplacedPreferredInstanceIds([]);
        setPlacements(restoredPlacements);
        setPlacementHistory(resetPlacementHistory(restoredPlacements));
        setPreviewPlacement(null);
        setLastResult(initialResult);
        setGeneratedSignature(
            selectionSignature(
                DEFAULT_ROOM,
                DEFAULT_SELECTION,
                DEFAULT_PRIORITIES,
                DEFAULT_PREFERENCES,
            ),
        );
        setSelectedInstanceId(
            initialResult.status === "success"
                ? initialResult.placements[0]?.instanceId ?? null
                : null,
        );
        setShowClearances(false);
        setResultNotice("");
        setIsManualScene(false);
        setDesignLabFeedback([]);
        setDesignLabNote("");
        setDesignLabNotice("");
        setObservationRequestsByVariant({});
        setObservationIdsByVariant({});
        setObservationStatesByVariant({});
        setObservationReviewDrafts({});
        setObservationNotice("");
        setGeneratedAt(null);
        setExportStatus("");
        setAutomaticRemovalProposal(null);
        setRemovedItems([]);
        setManualRemovalTarget(null);
        removalRecordArchiveRef.current.clear();
        setHasRequestedLayoutCalculation(false);
        setPhase("result");
        setHandoffSource(null);
    }, [cancelActiveSolver]);

    useEffect(() => {
        if (handoffId === undefined) return;

        if (handoffId === null) {
            if (handledHandoffId.current !== DIRECT_PLANNER_SENTINEL) {
                handledHandoffId.current = DIRECT_PLANNER_SENTINEL;
                restoreDemoState();
            }
            setHandoffWarning("");
            return;
        }

        if (handledHandoffId.current === handoffId) return;
        handledHandoffId.current = handoffId;

        const result = readQuestionnairePlannerHandoff(handoffId);
        if (result.status === "success") {
            setHandoffWarning("");
            applyHandoffBaseline(baselineFromHandoff(result.value));
            return;
        }

        restoreDemoState();
        setHandoffWarning(getHandoffWarning(result.status));
    }, [applyHandoffBaseline, handoffId, restoreDemoState]);

    useEffect(() => {
        if (handoffId === undefined || draftRead.current) return;
        draftRead.current = true;

        const result = readProjectDraft();
        if (result.status === "success") {
            const baseline = baselineFromProjectDraft(result.value);
            let matchesRequestedHandoff = true;

            if (handoffId) {
                const requested = readQuestionnairePlannerHandoff(handoffId);
                const selectionBeforeRemovals = { ...baseline.selection };
                result.value.planner?.removedItems?.forEach((record) => {
                    selectionBeforeRemovals[record.definitionId] =
                        (selectionBeforeRemovals[record.definitionId] ?? 0) + 1;
                });
                matchesRequestedHandoff =
                    requested.status !== "success" ||
                    selectedCountsSignature(selectionBeforeRemovals) ===
                        selectedCountsSignature(baselineFromHandoff(requested.value).selection);
            }

            const shouldRestoreDraft =
                baseline.itemCount + (result.value.planner?.removedItems?.length ?? 0) > 0 &&
                matchesRequestedHandoff &&
                (!handoffId || Boolean(result.value.planner));

            if (shouldRestoreDraft) {
                applyHandoffBaseline(baseline);
                setHandoffSource((current) =>
                    current ? { ...current, origin: "draft", modified: false } : current,
                );
                const restoredPlanner = result.value.planner;
                setIsManualScene(restoredPlanner?.designLab?.manualScene ?? false);
                setDesignLabFeedback(restoredPlanner?.designLab?.feedback ?? []);
                setDesignLabNote("");
                setDesignLabNotice("");
                setObservationRequestsByVariant({});
                setObservationIdsByVariant({});
                setObservationStatesByVariant({});
                setObservationReviewDrafts({});
                setObservationNotice("");
                if (restoredPlanner?.room) {
                    setRoom(restoredPlanner.room);
                }
                const restoredRemovedItems = restoredPlanner?.removedItems ?? [];
                const restoredRemovalArchive =
                    restoredPlanner?.removalArchive ?? restoredRemovedItems;
                setRemovedItems(restoredRemovedItems);
                removalRecordArchiveRef.current = new Map(
                    restoredRemovalArchive.map((record) => [record.instanceId, record]),
                );
                setHandoffWarning("");

                const layoutValidation = validateProjectDraftLayout(restoredPlanner);
                if (layoutValidation.status === "valid" && restoredPlanner?.layout) {
                    const restoredLayout = restoredPlanner.layout;
                    setIsDrawingLayout(restoredLayout.origin === "drawing");
                    const restoredPreferences =
                        restoredPlanner.preferences ??
                        getLayoutPreferences(baseline.selection, baseline.tvTargetCategory);
                    setVariants(restoredLayout.variants);
                    setActiveVariantId(restoredLayout.activeVariantId);
                    setEditedVariantIds(new Set(restoredLayout.editedVariantIds));
                    setPlacements(restoredLayout.placements);
                    setPlacementHistory(restoredLayout.history);
                    setPreviewPlacement(null);
                    setLastResult({
                        status: "success",
                        placements: restoredLayout.placements,
                        exploredNodes: restoredLayout.exploredNodes,
                        score: restoredLayout.score,
                        notes: restoredLayout.notes,
                    });
                    setGeneratedSignature(
                        selectionSignature(
                            restoredPlanner.room,
                            baseline.selection,
                            baseline.priorities,
                            restoredPreferences,
                            restoredRemovedItems.map((record) => record.instanceId),
                        ),
                    );
                    setSelectedInstanceId(restoredLayout.placements[0]?.instanceId ?? null);
                    setGeneratedAt(restoredLayout.generatedAt);
                    setHasRequestedLayoutCalculation(true);
                    setPhase("result");
                    setDraftNotice(
                        result.migratedFromVersion === 1
                            ? "Черновик перенесён в новую версию и восстановлен."
                            : "Локальный черновик проекта и расстановка восстановлены.",
                    );
                } else {
                    const restoredRoom = restoredPlanner?.room ?? DEFAULT_ROOM;
                    const restoredPreferences =
                        restoredPlanner?.preferences ??
                        getLayoutPreferences(baseline.selection, baseline.tvTargetCategory);
                    setVariants([]);
                    setActiveVariantId(null);
                    setEditedVariantIds(new Set());
                    setUnplacedPreferredInstanceIds([]);
                    setPlacements([]);
                    setPlacementHistory(resetPlacementHistory([]));
                    setPreviewPlacement(null);
                    setLastResult({
                        status: "success",
                        placements: [],
                        exploredNodes: 0,
                        score: 0,
                        notes: [],
                    });
                    setGeneratedSignature(
                        selectionSignature(
                            restoredRoom,
                            baseline.selection,
                            baseline.priorities,
                            restoredPreferences,
                            restoredRemovedItems.map((record) => record.instanceId),
                        ),
                    );
                    setSelectedInstanceId(null);
                    setGeneratedAt(null);
                    setPhase("ready");
                    setDraftNotice(
                        result.migratedFromVersion === 1
                            ? "Черновик перенесён в новую версию. Создайте варианты расстановки заново."
                            : "Локальный черновик проекта восстановлен.",
                    );
                    if (result.discardedLayout) {
                        setDraftWarning(
                            "Сохранённая расстановка была повреждена. Мебель и параметры комнаты сохранены, план нужно построить заново.",
                        );
                    } else if (layoutValidation.status === "invalid") {
                        setDraftWarning(
                            `Сохранённая расстановка больше не проходит проверку (${layoutValidation.message}). Мебель и параметры комнаты сохранены, план нужно построить заново.`,
                        );
                    }
                }
            } else if (handoffId && matchesRequestedHandoff) {
                setDraftNotice("Новый комплект из анкеты сохранён локально.");
            } else if (!matchesRequestedHandoff) {
                setDraftNotice(
                    "Открыт новый комплект из анкеты. Предыдущий локальный черновик будет заменён.",
                );
            }
            setDraftWritable(true);
            setDraftReady(true);
            return;
        }

        if (result.status === "missing") {
            setDraftWritable(true);
        } else if (result.status === "unsupported-version") {
            setDraftCanReset(true);
            setDraftWarning(
                `Локальный черновик создан в другой версии (${result.version}) и не был загружен.`,
            );
        } else if (result.status === "unavailable") {
            setDraftWarning(
                "Браузер запретил локальное хранение. Изменения сохранятся только до закрытия страницы.",
            );
        } else {
            setDraftCanReset(true);
            setDraftWarning(
                "Локальный черновик повреждён. Его параметры комнаты и приоритеты не использованы.",
            );
        }
        setDraftReady(true);
    }, [applyHandoffBaseline, handoffId]);

    useEffect(() => {
        if (!drawRoomDraft || !draftReady || drawRoomHandoffRead.current) return;
        drawRoomHandoffRead.current = true;

        const result = readDrawRoomDraft();
        if (result.status !== "success") {
            setDraftWarning("Не удалось открыть контур из редактора комнаты.");
            return;
        }

        const imported = result.placements;
        setIsDrawingLayout(imported.length > 0);
        const nextSelection: Selection = {};
        const nextPriorities: Record<string, FurniturePriority> = {};
        imported.forEach((item) => {
            nextSelection[item.definitionId] = (nextSelection[item.definitionId] ?? 0) + 1;
            nextPriorities[item.definitionId] = "preferred";
        });
        if (imported.length) {
            setSelection(nextSelection);
            setPriorities(nextPriorities);
            setRemovedItems([]);
            removalRecordArchiveRef.current = new Map();
            setIsManualScene(false);
            setTvTargetCategory("sleep");
            setGeneratedSignature(
                selectionSignature(
                    result.value,
                    nextSelection,
                    nextPriorities,
                    getLayoutPreferences(nextSelection, "sleep"),
                ),
            );
        } else {
            setGeneratedSignature(null);
        }
        setRoom(result.value);
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setUnplacedPreferredInstanceIds([]);
        setPlacements(imported);
        setPlacementHistory(resetPlacementHistory(imported));
        setPreviewPlacement(null);
        setLastResult({
            status: "success",
            placements: imported,
            exploredNodes: 0,
            score: 0,
            notes: [],
        });
        setSelectedInstanceId(null);
        setGeneratedAt(imported.length ? new Date().toISOString() : null);
        setHasRequestedLayoutCalculation(false);
        setPhase(imported.length ? "result" : "ready");
        setIsRoomEditing(false);
        setResultNotice(
            imported.length
                ? "Комната и расстановка мебели перенесены."
                : "Контур из отдельного редактора перенесён. Добавьте мебель или рассчитайте план.",
        );
        setDraftNotice("Контур комнаты сохранён в локальном черновике.");
        void router.replace("/planner", undefined, { shallow: true });
    }, [drawRoomDraft, draftReady, router]);

    useEffect(() => {
        if (!draftReady || !draftWritable || phase === "solving" || isRoomEditGestureActive) {
            return;
        }

        const hasUserProject =
            Boolean(handoffSource) ||
            isManualScene ||
            designLabFeedback.length > 0 ||
            currentSignature !==
                selectionSignature(
                    DEFAULT_ROOM,
                    DEFAULT_SELECTION,
                    DEFAULT_PRIORITIES,
                    DEFAULT_PREFERENCES,
                );
        if (!hasUserProject) return;

        const items = FURNITURE_CATALOG.flatMap((definition) => {
            const count = selection[definition.id] ?? 0;
            if (count <= 0) return [];
            return [
                {
                    definitionId: definition.id,
                    count,
                    priority: priorities[definition.id] ?? "preferred",
                },
            ];
        });
        const questionnaire = {
            items,
            ...(effectivePreferences.tvTargetCategory ? { preferences: effectivePreferences } : {}),
            ...(handoffSource?.styleKey || handoffSource?.styleLabel
                ? {
                      meta: {
                          ...(handoffSource.styleKey ? { styleKey: handoffSource.styleKey } : {}),
                          ...(handoffSource.styleLabel
                              ? { styleLabel: handoffSource.styleLabel }
                              : {}),
                      },
                  }
                : {}),
        };
        const hasUncommittedOrInvalidLayout =
            phase === "result" &&
            !isStale &&
            lastResult.status === "success" &&
            placements.length > 0 &&
            (Boolean(previewPlacement) || !validation.valid);
        if (hasUncommittedOrInvalidLayout && !isManualScene && !isDrawingLayout) return;

        const layout =
            !isManualScene &&
            phase === "result" &&
            !isStale &&
            lastResult.status === "success" &&
            placements.length > 0 &&
            layoutMatchesSelection &&
            (isDrawingLayout
                ? drawingBlockingIssues(validation.issues).length === 0
                : validation.valid) &&
            !previewPlacement &&
            generatedAt
                ? {
                      ...(isDrawingLayout ? { origin: "drawing" as const } : {}),
                      variants,
                      activeVariantId,
                      editedVariantIds: Array.from(editedVariantIds),
                      placements,
                      history: placementHistory,
                      exploredNodes: lastResult.exploredNodes,
                      score: lastResult.score,
                      notes: lastResult.notes,
                      generatedAt,
                  }
                : undefined;
        const planner = {
            room,
            selection: Object.fromEntries(items.map((item) => [item.definitionId, item.count])),
            priorities: Object.fromEntries(items.map((item) => [item.definitionId, item.priority])),
            ...(effectivePreferences.tvTargetCategory ? { preferences: effectivePreferences } : {}),
            ...(layout ? { layout } : {}),
            ...(isManualScene || designLabFeedback.length > 0
                ? {
                      designLab: {
                          manualScene: isManualScene,
                          feedback: designLabFeedback,
                      },
                  }
                : {}),
            ...(removedItems.length > 0 ? { removedItems } : {}),
            ...(removalRecordArchiveRef.current.size > 0
                ? {
                      removalArchive: Array.from(removalRecordArchiveRef.current.values()).sort(
                          (first, second) => first.instanceId.localeCompare(second.instanceId),
                      ),
                  }
                : {}),
        };
        if (layout && validateProjectDraftLayout(planner).status !== "valid") return;

        const result = saveProjectDraft(createProjectDraft(questionnaire, planner));

        if (result.status === "unavailable") {
            setDraftWarning("Не удалось обновить локальный черновик проекта.");
        }
    }, [
        currentSignature,
        draftReady,
        draftWritable,
        designLabFeedback,
        activeVariantId,
        editedVariantIds,
        effectivePreferences,
        generatedAt,
        hasPreferredFallback,
        handoffSource,
        isManualScene,
        isDrawingLayout,
        isRoomEditGestureActive,
        isStale,
        lastResult,
        layoutMatchesSelection,
        phase,
        placementHistory,
        placements,
        previewPlacement,
        priorities,
        removedItems,
        room,
        selection,
        validation.valid,
        validation.issues,
        variants,
    ]);

    const requestSolver = useCallback(
        (request: SolverWorkerPayload): Promise<SolverWorkerResponse> => {
            cancelActiveSolver();

            if (typeof window === "undefined" || typeof Worker === "undefined") {
                return Promise.reject(new Error("Web Worker недоступен."));
            }

            const requestId = solverRequestId.current + 1;
            solverRequestId.current = requestId;

            return new Promise((resolve, reject) => {
                const worker = new Worker(
                    new URL("../../lib/furniture-planner/solver.worker.ts", import.meta.url),
                );

                const clearWorker = () => {
                    if (activeSolverWorker.current?.worker === worker) {
                        activeSolverWorker.current = null;
                    }
                    worker.terminate();
                };

                activeSolverWorker.current = { requestId, worker, reject };

                worker.onmessage = (event: MessageEvent<SolverWorkerResponse>) => {
                    if (event.data.requestId !== requestId) return;

                    clearWorker();
                    if (!event.data.ok) {
                        reject(new Error(event.data.error));
                        return;
                    }
                    resolve(event.data);
                };
                worker.onerror = (event) => {
                    clearWorker();
                    reject(new Error(event.message || "Ошибка Web Worker."));
                };
                worker.onmessageerror = () => {
                    clearWorker();
                    reject(new Error("Не удалось прочитать результат расчёта."));
                };

                const workerRequest: SolverWorkerRequest = { ...request, requestId };
                worker.postMessage(workerRequest);
            });
        },
        [cancelActiveSolver],
    );

    const persistVariantObservation = useCallback(
        async (
            variantId: string,
            request: PlannerObservationCreateInput,
        ): Promise<PlannerObservationResponse> => {
            const savedId = observationIdsByVariant[variantId];
            if (savedId) {
                return {
                    id: savedId,
                    clientObservationId: request.clientObservationId,
                    review: null,
                    createdAt: "",
                    updatedAt: "",
                };
            }

            if (!isAuthEnabled || !isAuthenticated) {
                throw new Error("Войдите, чтобы сохранить наблюдение в базе данных.");
            }

            setObservationStatesByVariant((current) => ({
                ...current,
                [variantId]: "saving",
            }));
            try {
                const response = await plannerObservationService.create(request);
                setObservationIdsByVariant((current) => ({
                    ...current,
                    [variantId]: response.id,
                }));
                setObservationStatesByVariant((current) => ({
                    ...current,
                    [variantId]: "saved",
                }));
                return response;
            } catch (error) {
                setObservationStatesByVariant((current) => ({
                    ...current,
                    [variantId]: "failed",
                }));
                throw error;
            }
        },
        [isAuthenticated, observationIdsByVariant],
    );

    const persistGeneratedObservations = useCallback(
        async (requests: Record<string, PlannerObservationCreateInput>) => {
            const entries = Object.entries(requests);
            if (entries.length === 0) return;

            if (!isAuthEnabled || !isAuthenticated) {
                setObservationNotice("Войдите, чтобы результаты сохранялись в базе для разбора.");
                return;
            }

            const results = await Promise.allSettled(
                entries.map(([variantId, request]) =>
                    persistVariantObservation(variantId, request),
                ),
            );
            const savedCount = results.filter((result) => result.status === "fulfilled").length;
            const failedCount = results.length - savedCount;
            setObservationNotice(
                failedCount === 0
                    ? `В базе сохранено вариантов: ${savedCount}.`
                    : `В базе сохранено вариантов: ${savedCount}. Не сохранилось: ${failedCount}; повторите отправку комментария.`,
            );
        },
        [isAuthenticated, persistVariantObservation],
    );

    const updateActiveObservationReview = useCallback(
        (change: Partial<ObservationReviewDraft>) => {
            if (!activeObservationId) return;
            setObservationReviewDrafts((current) => ({
                ...current,
                [activeObservationId]: {
                    ...(current[activeObservationId] ?? EMPTY_OBSERVATION_REVIEW),
                    ...change,
                },
            }));
        },
        [activeObservationId],
    );

    const saveActiveObservationReview = useCallback(async () => {
        if (!activeObservationId || !activeObservationRequest) {
            setObservationNotice("Сначала рассчитайте и выберите вариант расстановки.");
            return;
        }

        if (!isAuthEnabled || !isAuthenticated) {
            setObservationNotice("Войдите, чтобы сохранить наблюдение в базе данных.");
            return;
        }

        const comment = activeObservationReview.comment.trim();
        if (!comment) {
            setObservationNotice("Опишите наблюдение перед сохранением.");
            return;
        }

        try {
            const observation = await persistVariantObservation(
                activeObservationId,
                activeObservationRequest,
            );
            const response = await plannerObservationService.saveReview(observation.id, {
                verdict: activeObservationReview.verdict,
                comment,
            });
            const review = response.review;
            if (review) {
                setObservationReviewDrafts((current) => ({
                    ...current,
                    [activeObservationId]: {
                        verdict: review.verdict,
                        comment: review.comment,
                    },
                }));
            }
            setObservationNotice(
                isReviewingWorkingCore
                    ? "Отзыв сохранён в базе и привязан к этому неполному рабочему ядру."
                    : "Наблюдение сохранено в базе и привязано к этому варианту.",
            );
        } catch (error) {
            setObservationNotice(
                error instanceof Error
                    ? error.message
                    : "Не удалось сохранить наблюдение в базе данных.",
            );
        }
    }, [
        activeObservationId,
        activeObservationRequest,
        activeObservationReview,
        isAuthenticated,
        isReviewingWorkingCore,
        persistVariantObservation,
    ]);

    useEffect(() => () => cancelActiveSolver(), [cancelActiveSolver]);

    const runSolver = useCallback(async () => {
        if (tvTargetMissing) {
            setResultNotice(
                "Для телевизора добавьте диван или кровать — так мы поймём, куда направить экран.",
            );
            return;
        }
        if (tvTargetChoiceRequired) {
            setResultNotice("Выберите, напротив чего поставить телевизор: дивана или кровати.");
            return;
        }

        setPreviewPlacement(null);
        setAutomaticRemovalProposal(null);
        setUnplacedPreferredInstanceIds([]);
        setIsManualScene(false);
        setObservationRequestsByVariant({});
        setObservationIdsByVariant({});
        setObservationStatesByVariant({});
        setObservationReviewDrafts({});
        setObservationNotice("");
        setHasRequestedLayoutCalculation(true);
        setIsDrawingLayout(false);
        setPhase("solving");
        setResultNotice("");

        try {
            const response = await requestSolver({
                action: "solve-variants",
                room,
                instances,
                preferences: effectivePreferences,
                limit: 3,
            });
            if (!response.ok || response.action !== "solve-variants") return;

            const result = response.result;
            if (result.status === "failure") {
                const shouldKeepWorkingPlan =
                    result.reason !== "invalid-room" && result.reason !== "invalid-request";
                if (shouldKeepWorkingPlan) {
                    const fallbackResponse = await requestSolver({
                        action: "solve-preferred-fallback",
                        room,
                        instances,
                        preferences: effectivePreferences,
                    });

                    if (
                        fallbackResponse.ok &&
                        fallbackResponse.action === "solve-preferred-fallback"
                    ) {
                        const fallback = fallbackResponse.result;
                        const fallbackResult = fallback.result;
                        if (
                            fallbackResult.status === "success" &&
                            fallbackResult.placements.length > 0
                        ) {
                            const unplacedIds = fallback.unplacedInstances.map(
                                (instance) => instance.instanceId,
                            );
                            const generatedAt = new Date().toISOString();
                            const observationRequests = createPlannerObservationRequests({
                                room,
                                selection,
                                priorities,
                                preferences: effectivePreferences,
                                instances,
                                targets: [
                                    {
                                        id: WORKING_CORE_OBSERVATION_ID,
                                        placements: fallbackResult.placements,
                                        exploredNodes: fallbackResult.exploredNodes,
                                        score: fallbackResult.score,
                                        notes: fallbackResult.notes,
                                        solverStatus: "partial",
                                        workingCore: {
                                            requestedItemCount: instances.length,
                                            unplacedInstanceIds: unplacedIds,
                                        },
                                    },
                                ],
                                generatedAt,
                                inputSignature: currentSignature,
                            });

                            setVariants([]);
                            setActiveVariantId(null);
                            setEditedVariantIds(new Set());
                            setLastResult(fallbackResult);
                            setPlacements(fallbackResult.placements);
                            setPlacementHistory(resetPlacementHistory(fallbackResult.placements));
                            setGeneratedAt(generatedAt);
                            setUnplacedPreferredInstanceIds(unplacedIds);
                            setObservationRequestsByVariant(observationRequests);
                            setGeneratedSignature(currentSignature);
                            setSelectedInstanceId(fallbackResult.placements[0]?.instanceId ?? null);
                            setResultNotice(
                                unplacedIds.length === 0
                                    ? "Весь набор размещён без конфликтов."
                                    : result.reason === "search-exhausted"
                                      ? `Быстрый поиск остановился по лимиту. На плане оставлены ${fallbackResult.placements.length} из ${instances.length} предметов без конфликтов; остальные перечислены ниже.`
                                      : `Полный набор пока не собрался. На плане оставлены ${fallbackResult.placements.length} из ${instances.length} предметов без конфликтов; остальные перечислены ниже.`,
                            );
                            setPhase("result");
                            void persistGeneratedObservations(observationRequests);
                            return;
                        }
                    }
                }

                setVariants([]);
                setActiveVariantId(null);
                setEditedVariantIds(new Set());
                setLastResult(result);
                setPlacements([]);
                setPlacementHistory(resetPlacementHistory([]));
                setGeneratedAt(null);
                setObservationRequestsByVariant({});
                setObservationIdsByVariant({});
                setObservationStatesByVariant({});
                setObservationReviewDrafts({});
                setSelectedInstanceId(null);
                setGeneratedSignature(currentSignature);
                setPhase("result");
                return;
            }

            const firstVariant = result.variants[0];
            const generatedAt = new Date().toISOString();
            const observationRequests = createPlannerObservationRequests({
                room,
                selection,
                priorities,
                preferences: effectivePreferences,
                instances,
                targets: result.variants.map((variant) => ({
                    id: variant.variantId,
                    placements: variant.placements,
                    exploredNodes: variant.exploredNodes,
                    score: variant.score,
                    notes: variant.notes,
                    solverStatus: "success",
                    profile: variant.profile,
                })),
                generatedAt,
                inputSignature: currentSignature,
            });
            setVariants(result.variants);
            setActiveVariantId(firstVariant?.variantId ?? null);
            setEditedVariantIds(new Set());
            setUnplacedPreferredInstanceIds([]);
            setObservationRequestsByVariant(observationRequests);
            setLastResult(firstVariant ?? initialResult);
            const firstPlacements = firstVariant?.placements ?? [];
            setPlacements(firstPlacements);
            setPlacementHistory(resetPlacementHistory(firstPlacements));
            setGeneratedAt(firstVariant ? generatedAt : null);
            setGeneratedSignature(currentSignature);
            setSelectedInstanceId(firstVariant?.placements[0]?.instanceId ?? null);
            setResultNotice(
                result.variants.length === 1
                    ? "Весь набор размещён без конфликтов. Похожие перестановки не дублируем."
                    : `Найдены ${formatVariantCount(
                          result.variants.length,
                      )} полных планировок. Первый вариант — «Уместить всё»; остальные — дополнительные сценарии.`,
            );
            setPhase("result");
            void persistGeneratedObservations(observationRequests);
        } catch (error) {
            if (error instanceof Error && error.message === SOLVER_CANCELLED) return;
            setResultNotice(SOLVER_ERROR_NOTICE);
            setPhase("result");
        }
    }, [
        currentSignature,
        effectivePreferences,
        instances,
        persistGeneratedObservations,
        priorities,
        requestSolver,
        room,
        selection,
        tvTargetChoiceRequired,
        tvTargetMissing,
    ]);

    const persistDesignLabState = useCallback(
        (manualScene: boolean, feedback: DesignLabFeedbackEntry[]) => {
            const items = FURNITURE_CATALOG.flatMap((definition) => {
                const count = selection[definition.id] ?? 0;
                return count > 0
                    ? [
                          {
                              definitionId: definition.id,
                              count,
                              priority: priorities[definition.id] ?? "preferred",
                          },
                      ]
                    : [];
            });
            const questionnaire = {
                items,
                ...(effectivePreferences.tvTargetCategory
                    ? { preferences: effectivePreferences }
                    : {}),
                ...(handoffSource?.styleKey || handoffSource?.styleLabel
                    ? {
                          meta: {
                              ...(handoffSource.styleKey
                                  ? { styleKey: handoffSource.styleKey }
                                  : {}),
                              ...(handoffSource.styleLabel
                                  ? { styleLabel: handoffSource.styleLabel }
                                  : {}),
                          },
                      }
                    : {}),
            };
            const planner = {
                room,
                selection: Object.fromEntries(items.map((item) => [item.definitionId, item.count])),
                priorities: Object.fromEntries(
                    items.map((item) => [item.definitionId, item.priority]),
                ),
                ...(effectivePreferences.tvTargetCategory
                    ? { preferences: effectivePreferences }
                    : {}),
                designLab: { manualScene, feedback },
                ...(removedItems.length > 0 ? { removedItems } : {}),
                ...(removalRecordArchiveRef.current.size > 0
                    ? {
                          removalArchive: Array.from(removalRecordArchiveRef.current.values()).sort(
                              (first, second) => first.instanceId.localeCompare(second.instanceId),
                          ),
                      }
                    : {}),
            };
            const result = saveProjectDraft(createProjectDraft(questionnaire, planner));
            if (result.status === "unavailable") {
                setDraftWarning("Не удалось сохранить наблюдение в локальном черновике.");
            }
        },
        [effectivePreferences, handoffSource, priorities, removedItems, room, selection],
    );

    const startManualScene = useCallback(() => {
        cancelActiveSolver();
        // The lab lives below the canvas. Once a user starts a manual scene,
        // return them to the worktable rather than leaving its first action
        // above the visible part of the document.
        draftingBoardRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setUnplacedPreferredInstanceIds([]);
        setPlacements([]);
        setPlacementHistory(resetPlacementHistory([]));
        setPreviewPlacement(null);
        setLastResult({
            status: "success",
            placements: [],
            exploredNodes: 0,
            score: 0,
            notes: ["Ручная сцена: расставьте предметы и следите за живой проверкой."],
        });
        setGeneratedAt(null);
        setGeneratedSignature(currentSignature);
        manualPlacementSessionSignatureRef.current = currentSignature;
        latestManualPlacementsRef.current = [];
        setSelectedInstanceId(null);
        setAutomaticRemovalProposal(null);
        setManualRemovalTarget(null);
        setIsManualScene(true);
        setShowClearances(true);
        persistDesignLabState(true, designLabFeedback);
        setResultNotice(
            "Ручная сцена начата. Все выбранные предметы доступны в кнопках «На план» слева.",
        );
        setPhase("result");
    }, [cancelActiveSolver, currentSignature, designLabFeedback, persistDesignLabState]);

    const saveDesignLabFeedback = useCallback(() => {
        const note = designLabNote.trim();
        if (!note) {
            setDesignLabNotice("Опишите наблюдение перед сохранением.");
            return;
        }
        if (note.length > 1200) {
            setDesignLabNotice("Сократите заметку до 1200 символов.");
            return;
        }

        const entry: DesignLabFeedbackEntry = {
            id: `lab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            verdict: designLabVerdict,
            note,
            createdAt: new Date().toISOString(),
        };
        const nextFeedback = [entry, ...designLabFeedback].slice(0, 8);
        setDesignLabFeedback(nextFeedback);
        persistDesignLabState(isManualScene, nextFeedback);
        setDesignLabNote("");
        setDesignLabNotice("Наблюдение сохранено в локальном черновике.");
    }, [designLabFeedback, designLabNote, designLabVerdict, isManualScene, persistDesignLabState]);

    const deleteDesignLabFeedback = useCallback(
        (entryId: string) => {
            const nextFeedback = designLabFeedback.filter((entry) => entry.id !== entryId);
            setDesignLabFeedback(nextFeedback);
            persistDesignLabState(isManualScene, nextFeedback);
            setDesignLabNotice("Наблюдение удалено из локального черновика.");
        },
        [designLabFeedback, isManualScene, persistDesignLabState],
    );

    const copyDesignLabFeedback = useCallback(
        async (entry: DesignLabFeedbackEntry) => {
            const openings = [
                ...(room.partitions ?? []).map(
                    (partition, index) =>
                        `Перегородка ${index + 1}: ${Math.abs(partition.end.x - partition.start.x) + Math.abs(partition.end.y - partition.start.y)} мм, толщина ${partition.thickness} мм`,
                ),
                ...room.doors.map(
                    (door, index) =>
                        `${(door.doorKind ?? "room") === "balcony" ? "Балконная дверь" : door.partitionId ? "Дверь в перегородке" : "Дверь"} ${index + 1}: ${door.partitionId ? "внутренний проём" : WALL_LABELS[door.wall].toLowerCase()}, ${door.width} мм, отступ ${door.offset} мм, открывание ${door.clearanceDepth} мм`,
                ),
                ...room.windows.map(
                    (window, index) =>
                        `${window.windowKind === "floor-to-ceiling" ? "Панорамное окно" : "Окно"} ${index + 1}: ${WALL_LABELS[window.wall].toLowerCase()}, ${window.width} мм, отступ ${window.offset} мм`,
                ),
                ...(room.radiators ?? []).map(
                    (radiator, index) =>
                        `Радиатор ${index + 1}: ${WALL_LABELS[radiator.wall].toLowerCase()}, ${radiator.width} мм, отступ ${radiator.offset} мм`,
                ),
            ];
            const furniture = instances.map((instance) => ({
                id: instance.instanceId,
                name: `${getFurniture(instance.definitionId).shortLabel}${instanceNumber(instance.instanceId)}`,
                priority: PRIORITY_LABELS[instance.priority],
            }));
            const placedItems = placements.map((placement) => ({
                id: placement.instanceId,
                name: `${getFurniture(placement.definitionId).shortLabel}${instanceNumber(placement.instanceId)}`,
                x: placement.x,
                y: placement.y,
                rotation: placement.rotation,
            }));
            const context = {
                verdict: DESIGN_LAB_VERDICT_LABELS[entry.verdict],
                note: entry.note,
                createdAt: entry.createdAt,
                room: {
                    width: room.width,
                    depth: room.depth,
                    openings,
                },
                furniture,
                placements: placedItems,
                issues: activeValidationMessages,
            };
            const humanReadable = [
                "STYLEFINDER · ЛАБОРАТОРИЯ РАССТАНОВКИ",
                `Вердикт: ${context.verdict}`,
                `Наблюдение: ${entry.note}`,
                `Время: ${formatResultDate(entry.createdAt)}`,
                `Комната: ${room.width} × ${room.depth} мм`,
                `Проёмы: ${openings.length > 0 ? openings.join("; ") : "не заданы"}`,
                `Мебель: ${furniture.map((item) => `${item.name} — ${item.priority}`).join("; ") || "не выбрана"}`,
                `Расстановка: ${placedItems.length > 0 ? placedItems.map((item) => `${item.name}: X ${item.x}, Y ${item.y}, ${item.rotation}°`).join("; ") : "ещё не размещена"}`,
                `Проверка: ${activeValidationMessages.length > 0 ? activeValidationMessages.join("; ") : "замечаний нет"}`,
                "--- JSON ---",
                JSON.stringify(context),
            ].join("\n");

            try {
                if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
                await navigator.clipboard.writeText(humanReadable);
                setDesignLabNotice("Контекст скопирован — вставьте его в обсуждение.");
            } catch {
                if (typeof window !== "undefined") {
                    window.prompt("Скопируйте контекст для разбора:", humanReadable);
                    setDesignLabNotice(
                        "Браузер открыл текст для ручного копирования — данные не потеряны.",
                    );
                }
            }
        },
        [activeValidationMessages, instances, placements, room],
    );

    const applyPreset = useCallback((width: number, depth: number) => {
        setRoom((current) => {
            const result = tryResizeRoomWithDefaultOpenings(current, width, depth);
            if (result.status === "invalid") {
                setResultNotice(`Размер не применён: ${result.message}`);
                return current;
            }
            setResultNotice("");
            return result.room;
        });
    }, []);

    const resetPlanner = useCallback(() => {
        cancelActiveSolver();

        if (handoffSource) {
            setRoom(DEFAULT_ROOM);
            applyHandoffBaseline({
                selection: { ...handoffSource.selection },
                priorities: { ...handoffSource.priorities },
                tvTargetCategory: handoffSource.tvTargetCategory,
                itemCount: handoffSource.itemCount,
                styleKey: handoffSource.styleKey,
                styleLabel: handoffSource.styleLabel,
            });
            return;
        }

        const result = solveRoom(DEFAULT_ROOM, initialInstances, DEFAULT_PREFERENCES);
        setRoom(DEFAULT_ROOM);
        setSelection(DEFAULT_SELECTION);
        setPriorities(DEFAULT_PRIORITIES);
        setTvTargetCategory(undefined);
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setUnplacedPreferredInstanceIds([]);
        setPlacements(result.placements);
        setPlacementHistory(resetPlacementHistory(result.placements));
        setPreviewPlacement(null);
        setLastResult(result);
        setGeneratedSignature(
            selectionSignature(
                DEFAULT_ROOM,
                DEFAULT_SELECTION,
                DEFAULT_PRIORITIES,
                DEFAULT_PREFERENCES,
            ),
        );
        setSelectedInstanceId(result.placements[0]?.instanceId ?? null);
        setShowClearances(false);
        setResultNotice("");
        setIsManualScene(false);
        setDesignLabFeedback([]);
        setDesignLabNote("");
        setDesignLabNotice("");
        setObservationRequestsByVariant({});
        setObservationIdsByVariant({});
        setObservationStatesByVariant({});
        setObservationReviewDrafts({});
        setObservationNotice("");
        setGeneratedAt(result.status === "success" ? new Date().toISOString() : null);
        setExportStatus("");
        setAutomaticRemovalProposal(null);
        setRemovedItems([]);
        setManualRemovalTarget(null);
        removalRecordArchiveRef.current.clear();
        setHasRequestedLayoutCalculation(true);
        setPhase("result");
    }, [applyHandoffBaseline, cancelActiveSolver, handoffSource]);

    const confirmResetPlanner = useCallback(() => {
        if (
            typeof window !== "undefined" &&
            !window.confirm(
                "Сбросить размеры комнаты, проёмы и текущую расстановку? Комплект мебели останется.",
            )
        ) {
            return;
        }
        resetPlanner();
        setDraftNotice("План комнаты сброшен к исходным параметрам комплекта.");
    }, [resetPlanner]);

    const startNewProject = useCallback(async () => {
        if (
            typeof window !== "undefined" &&
            !window.confirm(
                "Начать новый проект? Текущий комплект, размеры комнаты и локальный черновик будут удалены.",
            )
        ) {
            return;
        }

        const result = resetProjectDraft();
        if (result.status === "unavailable") {
            setDraftWarning("Браузер не разрешил удалить локальный черновик.");
            return;
        }
        setDraftWritable(false);
        cancelActiveSolver();
        await router.push({ pathname: "/questionnaire", query: { new: "1" } });
    }, [cancelActiveSolver, router]);

    const discardBrokenDraft = useCallback(() => {
        const result = resetProjectDraft();
        if (result.status === "unavailable") {
            setDraftWarning("Браузер не разрешил удалить локальный черновик.");
            return;
        }
        setDraftWarning("");
        setDraftCanReset(false);
        setDraftNotice("Несовместимый черновик удалён.");
        setDraftWritable(true);
    }, []);

    const calculateAutomaticRemovalProposal = useCallback(async () => {
        if (isStale || !failure || failure.reason !== "proven-impossible") {
            setAutomaticRemovalProposal(null);
            setResultNotice(
                isStale
                    ? "Параметры изменились. Сначала заново уместите набор."
                    : "Удаление можно рассматривать только после доказанной невозможности.",
            );
            return;
        }
        setAutomaticRemovalProposal(null);
        setPhase("solving");
        setResultNotice("");
        const proposalSignature = currentSignature;

        try {
            const response = await requestSolver({
                action: "solve-with-removal",
                room,
                instances,
                preferences: effectivePreferences,
            });
            if (!response.ok || response.action !== "solve-with-removal") return;
            if (latestSignatureRef.current !== proposalSignature) {
                setAutomaticRemovalProposal(null);
                setResultNotice("Параметры изменились во время расчёта. Ничего не изменено.");
                setPhase("result");
                return;
            }

            const automatic = response.result;
            const isValidProposal =
                automatic.result.status === "success" &&
                automatic.removedInstances.length > 0 &&
                automatic.removedInstances.every((instance) => instance.priority === "optional");

            if (!isValidProposal || automatic.result.status !== "success") {
                setResultNotice(
                    automatic.result.status === "failure" &&
                        automatic.result.reason === "search-exhausted"
                        ? "Лимит проверки предложений исчерпан. Ничего не изменено и удаление не предложено."
                        : "Предложение не найдено. Автоматически можно убрать только предметы с приоритетом «Можно убрать».",
                );
                setPhase("result");
                return;
            }

            const removedAt = new Date().toISOString();
            const proposalItems = automatic.removedInstances.map((instance) =>
                createRemovalRecord({
                    instanceId: instance.instanceId,
                    definitionId: instance.definitionId,
                    priority: instance.priority,
                    method: "automatic",
                    reason: buildAutomaticRemovalReason(
                        instances.length,
                        automatic.removedInstances.length,
                    ),
                    removedAt,
                }),
            );
            setAutomaticRemovalProposal({
                result: automatic.result,
                removedItems: proposalItems,
                signature: proposalSignature,
            });
            setResultNotice(
                "Предложение рассчитано. Комплект и текущая расстановка не изменены — проверьте список и подтвердите отдельно.",
            );
            setPhase("result");
        } catch (error) {
            if (error instanceof Error && error.message === SOLVER_CANCELLED) return;
            setResultNotice(SOLVER_ERROR_NOTICE);
            setPhase("result");
        }
    }, [currentSignature, effectivePreferences, failure, instances, isStale, requestSolver, room]);

    const cancelAutomaticRemovalProposal = useCallback(() => {
        setAutomaticRemovalProposal(null);
        setResultNotice("Предложение отменено. Комплект и расстановка не изменены.");
    }, []);

    const applyAutomaticRemovalProposal = useCallback(() => {
        const proposal = automaticRemovalProposal;
        if (!proposal || proposal.signature !== currentSignature) {
            setAutomaticRemovalProposal(null);
            setResultNotice("Параметры проекта изменились. Рассчитайте предложение заново.");
            return;
        }
        if (
            !canApplyAutomaticRemovalProposal({
                proposalSignature: proposal.signature,
                currentSignature,
                removedItems: proposal.removedItems,
                priorities,
            })
        ) {
            setAutomaticRemovalProposal(null);
            setResultNotice(
                "Приоритеты изменились. Автоматическое удаление отменено; рассчитайте предложение заново.",
            );
            return;
        }

        const nextSelection = { ...selection };
        proposal.removedItems.forEach((record) => {
            nextSelection[record.definitionId] = Math.max(
                0,
                (nextSelection[record.definitionId] ?? 0) - 1,
            );
            removalRecordArchiveRef.current.set(record.instanceId, record);
        });
        const nextRemovedItems = mergeRemovalRecords(removedItems, proposal.removedItems);
        const nextPreferences = getLayoutPreferences(nextSelection, tvTargetCategory);

        setSelection(nextSelection);
        setRemovedItems(nextRemovedItems);
        setHandoffSource((current) => (current ? { ...current, modified: true } : current));
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setUnplacedPreferredInstanceIds([]);
        setLastResult(proposal.result);
        setPlacements(proposal.result.placements);
        setPlacementHistory(resetPlacementHistory(proposal.result.placements));
        setGeneratedAt(new Date().toISOString());
        setGeneratedSignature(
            selectionSignature(
                room,
                nextSelection,
                priorities,
                nextPreferences,
                nextRemovedItems.map((record) => record.instanceId),
            ),
        );
        setSelectedInstanceId(proposal.result.placements[0]?.instanceId ?? null);
        setAutomaticRemovalProposal(null);
        setResultNotice(
            `Из проекта убрано: ${proposal.removedItems
                .map((record) => getFurniture(record.definitionId).shortLabel)
                .join(", ")}. Запись добавлена в итоговую спецификацию.`,
        );
        setPhase("result");
    }, [
        automaticRemovalProposal,
        currentSignature,
        priorities,
        removedItems,
        room,
        selection,
        tvTargetCategory,
    ]);

    const activateVariant = useCallback(
        (variantId: string) => {
            const variant = variants.find((candidate) => candidate.variantId === variantId);
            if (!variant) return;
            setActiveVariantId(variantId);
            setIsManualScene(false);
            setPreviewPlacement(null);
            setUnplacedPreferredInstanceIds([]);
            setPlacements(variant.placements);
            setPlacementHistory(resetPlacementHistory(variant.placements));
            setLastResult(variant);
            setGeneratedAt(new Date().toISOString());
            setSelectedInstanceId(variant.placements[0]?.instanceId ?? null);
        },
        [variants],
    );

    const updatePlacement = useCallback(
        (instanceId: string, updater: (placement: Placement) => Placement) => {
            const currentPlacement = placements.find(
                (placement) => placement.instanceId === instanceId,
            );
            if (!currentPlacement) return false;

            const updatedPlacement = updater(currentPlacement);
            const doorIssue = validatePlacement(
                updatedPlacement,
                room,
                placements.filter((item) => item.instanceId !== instanceId),
            ).issues.find((issue) => issue.code === "door-blocked");
            if (doorIssue) {
                setPreviewPlacement(null);
                setResultNotice("Мебель перекрывает дверной проём или мешает открыванию двери.");
                return false;
            }
            const nextPlacements = placements.map((placement) =>
                placement.instanceId === instanceId ? updatedPlacement : placement,
            );
            setPreviewPlacement(null);
            setPlacements(nextPlacements);
            setPlacementHistory((current) => pushPlacementHistory(current, nextPlacements));
            setGeneratedAt(new Date().toISOString());
            if (activeVariantId) {
                setEditedVariantIds((current) => new Set(current).add(activeVariantId));
                setVariants((current) =>
                    current.map((variant) =>
                        variant.variantId === activeVariantId
                            ? {
                                  ...variant,
                                  placements: nextPlacements,
                              }
                            : variant,
                    ),
                );
            }
            setResultNotice("");
            return true;
        },
        [activeVariantId, placements, room],
    );

    const applyHistorySnapshot = useCallback(
        (nextHistory: ReturnType<typeof createPlacementHistory>, notice: string) => {
            const previousInstanceIds = new Set(
                placements.map((placement) => placement.instanceId),
            );
            const restoredInstanceId = nextHistory.present.find(
                (placement) => !previousInstanceIds.has(placement.instanceId),
            )?.instanceId;
            const removalHistoryPlacements = (historyPlacements: Placement[]) =>
                historyPlacements.filter((placement) =>
                    removalRecordArchiveRef.current.has(placement.instanceId),
                );
            const nextSelection = reconcileSelectionWithPlacementHistory(
                selection,
                removalHistoryPlacements(placements),
                removalHistoryPlacements(nextHistory.present),
            );
            const nextRemovedItems = reconcileRemovalRecordsWithPlacements(
                removedItems,
                placements,
                nextHistory.present,
                removalRecordArchiveRef.current,
            );
            const nextPreferences = getLayoutPreferences(nextSelection, tvTargetCategory);
            setPlacementHistory(nextHistory);
            setPlacements(nextHistory.present);
            setSelection(nextSelection);
            setRemovedItems(nextRemovedItems);
            setGeneratedSignature(
                selectionSignature(
                    room,
                    nextSelection,
                    priorities,
                    nextPreferences,
                    nextRemovedItems.map((record) => record.instanceId),
                ),
            );
            setLastResult((current) =>
                current.status === "success"
                    ? { ...current, placements: nextHistory.present }
                    : current,
            );
            setPreviewPlacement(null);
            setSelectedInstanceId((current) =>
                current && nextHistory.present.some((placement) => placement.instanceId === current)
                    ? current
                    : restoredInstanceId ?? nextHistory.present[0]?.instanceId ?? null,
            );
            if (activeVariantId) {
                setEditedVariantIds((current) => new Set(current).add(activeVariantId));
                setVariants((current) =>
                    current.map((variant) =>
                        variant.variantId === activeVariantId
                            ? { ...variant, placements: nextHistory.present }
                            : variant,
                    ),
                );
            }
            setGeneratedAt(new Date().toISOString());
            setResultNotice(notice);
        },
        [activeVariantId, placements, priorities, removedItems, room, selection, tvTargetCategory],
    );

    const undoPlacement = useCallback(() => {
        if (isStale) {
            setResultNotice("Сначала перестройте вариант после изменения параметров проекта.");
            return;
        }
        const nextHistory = undoPlacementHistory(placementHistory);
        if (nextHistory === placementHistory) return;
        applyHistorySnapshot(nextHistory, "Последнее ручное изменение отменено.");
    }, [applyHistorySnapshot, isStale, placementHistory]);

    const redoPlacement = useCallback(() => {
        if (isStale) {
            setResultNotice("Сначала перестройте вариант после изменения параметров проекта.");
            return;
        }
        const nextHistory = redoPlacementHistory(placementHistory);
        if (nextHistory === placementHistory) return;
        applyHistorySnapshot(nextHistory, "Отменённое ручное изменение возвращено.");
    }, [applyHistorySnapshot, isStale, placementHistory]);

    const nudgePlacement = useCallback(
        (instanceId: string, deltaX: number, deltaY: number) => {
            updatePlacement(instanceId, (placement) => ({
                ...placement,
                x: placement.x + deltaX,
                y: placement.y + deltaY,
            }));
        },
        [updatePlacement],
    );

    const rotatePlacement = useCallback(
        (instanceId: string) => {
            updatePlacement(instanceId, (placement) => {
                const rotations = getFurniture(placement.definitionId).rotations;
                const currentRotationIndex = rotations.indexOf(placement.rotation);
                const nextRotationIndex =
                    currentRotationIndex < 0 ? 0 : (currentRotationIndex + 1) % rotations.length;

                return {
                    ...placement,
                    rotation: rotations[nextRotationIndex],
                };
            });
        },
        [updatePlacement],
    );

    const nudgeSelected = useCallback(
        (deltaX: number, deltaY: number) => {
            if (!selectedInstanceId) return;
            nudgePlacement(selectedInstanceId, deltaX, deltaY);
        },
        [nudgePlacement, selectedInstanceId],
    );

    const rotateSelected = useCallback(() => {
        if (!selectedInstanceId) return;
        rotatePlacement(selectedInstanceId);
    }, [rotatePlacement, selectedInstanceId]);

    const commitDraggedPlacement = useCallback(
        (instanceId: string, placement: Placement) => {
            if (!updatePlacement(instanceId, () => placement)) return;
            const definition = getFurniture(placement.definitionId);
            setResultNotice(
                `${definition.shortLabel} перемещён: X ${placement.x} мм, Y ${placement.y} мм.`,
            );
        },
        [updatePlacement],
    );

    const addUnplacedPlacement = useCallback(
        (placement: Placement) => {
            const instance = manualPlacementInstances.find(
                (candidate) => candidate.instanceId === placement.instanceId,
            );
            if (!instance || instance.definitionId !== placement.definitionId) {
                setResultNotice("Этот предмет уже добавлен на план или набор был изменён.");
                return;
            }

            const startsFreshManualScene =
                isStale && manualPlacementSessionSignatureRef.current !== currentSignature;
            const basePlacements = startsFreshManualScene ? [] : latestManualPlacementsRef.current;
            const resolvedPlacement = findNearestValidManualPlacement(
                placement,
                room,
                basePlacements,
                effectivePreferences,
            );
            const definition = getFurniture(placement.definitionId);

            if (!resolvedPlacement) {
                const nextValidation = validateLayout(
                    room,
                    [...basePlacements, placement],
                    effectivePreferences,
                );
                setResultNotice(
                    `Не удалось поставить «${definition.shortLabel}»: ${
                        nextValidation.issues[0]?.message ?? "проверьте свободное место"
                    }`,
                );
                return;
            }

            const nextPlacements = [...basePlacements, resolvedPlacement];
            const wasMovedNearDropPoint =
                resolvedPlacement.x !== placement.x || resolvedPlacement.y !== placement.y;

            setPreviewPlacement(null);
            latestManualPlacementsRef.current = nextPlacements;
            manualPlacementSessionSignatureRef.current = currentSignature;
            setPlacements(nextPlacements);
            setPlacementHistory((current) =>
                isStale
                    ? resetPlacementHistory(nextPlacements)
                    : pushPlacementHistory(current, nextPlacements),
            );
            setLastResult((current) =>
                current.status === "success" && !isStale
                    ? { ...current, placements: nextPlacements }
                    : {
                          status: "success",
                          placements: nextPlacements,
                          exploredNodes: 0,
                          score: 0,
                          notes: [
                              "Расстановка начата вручную. Добавляйте предметы из списка или запустите автоподбор.",
                          ],
                      },
            );
            setVariants([]);
            setActiveVariantId(null);
            setEditedVariantIds(new Set());
            setUnplacedPreferredInstanceIds((current) =>
                current.filter((instanceId) => instanceId !== placement.instanceId),
            );
            setSelectedInstanceId(placement.instanceId);
            setGeneratedSignature(currentSignature);
            setPhase("result");
            setGeneratedAt(new Date().toISOString());
            setResultNotice(
                wasMovedNearDropPoint
                    ? `${definition.shortLabel}${instanceNumber(
                          placement.instanceId,
                      )} добавлен рядом с точкой сброса: ближайшее свободное место найдено автоматически.`
                    : `${definition.shortLabel}${instanceNumber(
                          placement.instanceId,
                      )} добавлен в точку сброса. Его можно дальше перетаскивать и поворачивать на плане.`,
            );
        },
        [currentSignature, effectivePreferences, isStale, manualPlacementInstances, room],
    );

    const addUnplacedAtCenter = useCallback(
        (instance: FurnitureInstance) => {
            const geometry = getRotatedGeometry(getFurniture(instance.definitionId), 0);
            addUnplacedPlacement({
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                rotation: 0,
                x: clamp(
                    snapToGrid((room.width - geometry.width) / 2),
                    0,
                    Math.max(0, Math.floor((room.width - geometry.width) / GRID_MM) * GRID_MM),
                ),
                y: clamp(
                    snapToGrid((room.depth - geometry.depth) / 2),
                    0,
                    Math.max(0, Math.floor((room.depth - geometry.depth) / GRID_MM) * GRID_MM),
                ),
            });
        },
        [addUnplacedPlacement, room],
    );

    const addUnplacedAtPointer = useCallback(
        (
            instance: FurnitureInstance,
            roomElement: HTMLDivElement,
            clientX: number,
            clientY: number,
        ) => {
            const geometry = getRotatedGeometry(getFurniture(instance.definitionId), 0);
            const point = clientPointToRoomMm(roomElement, room, clientX, clientY);

            addUnplacedPlacement({
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                rotation: 0,
                x: clamp(
                    snapToGrid(point.x - geometry.width / 2),
                    0,
                    Math.max(0, Math.floor((room.width - geometry.width) / GRID_MM) * GRID_MM),
                ),
                y: clamp(
                    snapToGrid(point.y - geometry.depth / 2),
                    0,
                    Math.max(0, Math.floor((room.depth - geometry.depth) / GRID_MM) * GRID_MM),
                ),
            });
        },
        [addUnplacedPlacement, room],
    );

    const finishManualSourceDrag = useCallback(
        (pointerId: number, clientX: number, clientY: number) => {
            const session = manualSourceDragRef.current;
            if (!session || session.pointerId !== pointerId) return;

            manualSourceDragRef.current = null;
            if (session.source.hasPointerCapture(pointerId)) {
                session.source.releasePointerCapture(pointerId);
            }
            const moved =
                session.moved ||
                Math.hypot(clientX - session.startClientX, clientY - session.startClientY) >= 6;
            if (!moved) return;

            suppressManualSourceClickRef.current = session.instanceId;
            const target = document.elementFromPoint(clientX, clientY);
            const roomElement = target?.closest('[data-manual-drop-room="true"]');
            if (!(roomElement instanceof HTMLDivElement)) {
                setResultNotice("Перетащите предмет внутрь видимой области комнаты.");
                return;
            }

            const instance = manualPlacementInstances.find(
                (candidate) => candidate.instanceId === session.instanceId,
            );
            if (!instance) {
                setResultNotice("Этот предмет уже добавлен на план или набор был изменён.");
                return;
            }
            addUnplacedAtPointer(instance, roomElement, clientX, clientY);
        },
        [addUnplacedAtPointer, manualPlacementInstances],
    );

    const cancelManualSourceDrag = useCallback((pointerId: number) => {
        const session = manualSourceDragRef.current;
        if (!session || session.pointerId !== pointerId) return;

        manualSourceDragRef.current = null;
        if (session.source.hasPointerCapture(pointerId)) {
            session.source.releasePointerCapture(pointerId);
        }
    }, []);

    const beginManualSourceDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>, instance: FurnitureInstance) => {
            if (phase === "solving" || !event.isPrimary) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            event.currentTarget.setPointerCapture(event.pointerId);
            manualSourceDragRef.current = {
                instanceId: instance.instanceId,
                pointerId: event.pointerId,
                source: event.currentTarget,
                startClientX: event.clientX,
                startClientY: event.clientY,
                moved: false,
            };

            const removeWindowPointerListeners = () => {
                window.removeEventListener("pointerup", handleWindowPointerUp);
                window.removeEventListener("pointercancel", handleWindowPointerCancel);
            };
            const handleWindowPointerUp = (pointerEvent: PointerEvent) => {
                removeWindowPointerListeners();
                finishManualSourceDrag(
                    pointerEvent.pointerId,
                    pointerEvent.clientX,
                    pointerEvent.clientY,
                );
            };
            const handleWindowPointerCancel = (pointerEvent: PointerEvent) => {
                removeWindowPointerListeners();
                cancelManualSourceDrag(pointerEvent.pointerId);
            };
            window.addEventListener("pointerup", handleWindowPointerUp);
            window.addEventListener("pointercancel", handleWindowPointerCancel);
        },
        [cancelManualSourceDrag, finishManualSourceDrag, phase],
    );

    const updateManualSourceDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const session = manualSourceDragRef.current;
        if (!session || session.pointerId !== event.pointerId) return;

        session.moved =
            session.moved ||
            Math.hypot(
                event.clientX - session.startClientX,
                event.clientY - session.startClientY,
            ) >= 6;
    }, []);

    const openManualRemovalConfirmation = useCallback(() => {
        if (!selectedPlacement) return;
        setManualRemovalTarget({ ...selectedPlacement });
    }, [selectedPlacement]);

    const cancelManualRemoval = useCallback(() => setManualRemovalTarget(null), []);

    const applyManualRemoval = useCallback(() => {
        const target = manualRemovalTarget;
        if (!target || !placements.some((item) => item.instanceId === target.instanceId)) {
            setManualRemovalTarget(null);
            setResultNotice("Предмет уже отсутствует на плане.");
            return;
        }

        const record = createRemovalRecord({
            instanceId: target.instanceId,
            definitionId: target.definitionId,
            priority: priorities[target.definitionId] ?? "preferred",
            method: "manual",
            reason: MANUAL_REMOVAL_REASON,
        });
        const nextSelection = {
            ...selection,
            [target.definitionId]: Math.max(0, (selection[target.definitionId] ?? 0) - 1),
        };
        const nextPlacements = placements.filter(
            (placement) => placement.instanceId !== target.instanceId,
        );
        const nextRemovedItems = mergeRemovalRecords(removedItems, [record]);
        const nextPreferences = getLayoutPreferences(nextSelection, tvTargetCategory);
        removalRecordArchiveRef.current.set(record.instanceId, record);
        setHandoffSource((current) => (current ? { ...current, modified: true } : current));
        setPreviewPlacement(null);
        setPlacements(nextPlacements);
        setPlacementHistory((current) => pushPlacementHistory(current, nextPlacements));
        setRemovedItems(nextRemovedItems);
        setGeneratedAt(new Date().toISOString());
        setGeneratedSignature(
            selectionSignature(
                room,
                nextSelection,
                priorities,
                nextPreferences,
                nextRemovedItems.map((item) => item.instanceId),
            ),
        );
        setLastResult((current) =>
            current.status === "success" ? { ...current, placements: nextPlacements } : current,
        );
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setUnplacedPreferredInstanceIds([]);
        setSelection(nextSelection);
        setSelectedInstanceId(null);
        setManualRemovalTarget(null);
        setAutomaticRemovalProposal(null);
        setResultNotice(
            `${getFurniture(target.definitionId).shortLabel} убран из проекта. Действие можно отменить кнопкой «Отменить» над планом.`,
        );
    }, [
        manualRemovalTarget,
        placements,
        priorities,
        removedItems,
        room,
        selection,
        tvTargetCategory,
    ]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const editingSelector =
                "input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='spinbutton']";
            const editingValue = target instanceof Element && target.closest(editingSelector);
            const shortcut = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();

            if (shortcut && !editingValue) {
                if (key === "z" && event.shiftKey) {
                    event.preventDefault();
                    redoPlacement();
                    return;
                }
                if (key === "z") {
                    event.preventDefault();
                    undoPlacement();
                    return;
                }
                if (key === "y") {
                    event.preventDefault();
                    redoPlacement();
                    return;
                }
            }
            const interactiveSelector = [
                "a[href]",
                "button",
                "input",
                "select",
                "textarea",
                "[contenteditable]:not([contenteditable='false'])",
                "[role='button']",
                "[role='link']",
                "[role='menuitem']",
                "[role='option']",
                "[role='slider']",
                "[role='spinbutton']",
                "[role='textbox']",
                "[tabindex]:not([tabindex='-1'])",
            ].join(",");

            if (target instanceof Element && target.closest(interactiveSelector)) return;
            if (!selectedInstanceId) return;

            const directions: Record<string, [number, number]> = {
                ArrowLeft: [-50, 0],
                ArrowRight: [50, 0],
                ArrowUp: [0, -50],
                ArrowDown: [0, 50],
            };
            const direction = directions[event.key];
            if (!direction) return;

            event.preventDefault();
            nudgeSelected(...direction);
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [nudgeSelected, redoPlacement, selectedInstanceId, undoPlacement]);

    const planState =
        phase === "solving"
            ? { label: "Идёт расчёт", tone: "working" }
            : isManualScene
              ? designLabStatus
              : !hasRequestedLayoutCalculation
                ? roomGeometryError
                    ? { label: "Проверьте контур", tone: "invalid" }
                    : { label: "Комната готова", tone: "ready" }
                : hasPreferredFallback
                  ? { label: "Рабочее ядро", tone: "partial" }
                  : hasFullVariants
                    ? { label: `Варианты: ${formatVariantCount(variants.length)}`, tone: "valid" }
                    : hasCompleteGeneratedPlan
                      ? { label: "Полный комплект", tone: "valid" }
                      : failure
                        ? {
                              label:
                                  failure.reason === "search-exhausted"
                                      ? "Лимит расчёта исчерпан"
                                      : failure.reason === "access-unverified"
                                        ? "Проход 700 мм не подтверждён"
                                        : failure.reason === "invalid-room"
                                          ? "Ошибка параметров комнаты"
                                          : failure.reason === "invalid-request"
                                            ? "Проверьте набор мебели"
                                            : "Набор не помещается",
                              tone: "invalid",
                          }
                        : isStale
                          ? { label: "Нужно перестроить", tone: "stale" }
                          : validation.valid
                            ? { label: "Планировка допустима", tone: "valid" }
                            : { label: "Есть конфликт", tone: "invalid" };

    const activateWorkspaceTool = useCallback((tool: WorkspaceTool) => {
        setActiveWorkspaceTool(tool);
        if (typeof window === "undefined") return;

        window.requestAnimationFrame(() => {
            document.getElementById(`planner-tool-${tool}`)?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest",
            });
        });
    }, []);

    return (
        <div className={styles.page}>
            <Navigation />
            <main id="main-content" className={styles.main} tabIndex={-1}>
                <header className={styles.plannerHeader} data-planner-app-bar="true">
                    <div className={styles.plannerIdentity}>
                        <span className={styles.eyebrow}>StyleFinder · планировщик</span>
                        <h1>Проект комнаты</h1>
                        <p>Контур, мебель и проверка проходов — в одном рабочем поле.</p>
                    </div>
                    <div className={styles.headerMetrics} aria-live="polite">
                        <span className={styles.areaMetric}>
                            <strong>{formatArea(room)} м²</strong>
                            площадь комнаты
                        </span>
                        <span className={styles.statusMetric} data-tone={planState.tone}>
                            <span aria-hidden="true" />
                            {planState.label}
                        </span>
                    </div>
                    <div className={styles.appBarUtilities}>
                        <span className={styles.draftState} role="status">
                            <i aria-hidden="true" />
                            {draftNotice || "Черновик в этом браузере"}
                        </span>

                        <div
                            className={styles.appBarHistory}
                            role="group"
                            aria-label="История ручных изменений"
                        >
                            <button
                                ref={undoButtonRef}
                                type="button"
                                onClick={undoPlacement}
                                disabled={isStale || !canUndoPlacementHistory(placementHistory)}
                                aria-keyshortcuts="Control+Z Meta+Z"
                                title="Отменить ручное изменение"
                            >
                                ↶ <span>Отменить</span>
                            </button>
                            <button
                                type="button"
                                onClick={redoPlacement}
                                disabled={isStale || !canRedoPlacementHistory(placementHistory)}
                                aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z"
                                title="Вернуть отменённое изменение"
                            >
                                ↷ <span>Вернуть</span>
                            </button>
                        </div>

                        <button
                            type="button"
                            className={styles.appBarNewProject}
                            onClick={startNewProject}
                        >
                            Новый проект
                        </button>
                        <Link className={styles.backToSite} href="/">
                            К сайту
                        </Link>
                    </div>
                </header>

                {handoffSource && (
                    <div className={styles.handoffBanner} role="status" aria-live="polite">
                        <span className={styles.handoffMark} aria-hidden="true">
                            ✓
                        </span>
                        <div>
                            <strong>
                                {handoffSource.modified
                                    ? "Набор анкеты изменён вручную"
                                    : handoffSource.origin === "draft"
                                      ? `Черновик проекта восстановлен · ${formatFurnitureCount(
                                            instances.length,
                                        )}`
                                      : `Набор получен из анкеты · ${formatFurnitureCount(
                                            instances.length,
                                        )}`}
                            </strong>
                            <p>
                                {handoffSource.styleLabel && (
                                    <>Стиль: {handoffSource.styleLabel}. </>
                                )}
                                Проверьте размеры комнаты и уместите выбранный набор.
                            </p>
                        </div>
                        <Link
                            href={{
                                pathname: "/questionnaire",
                                query: {
                                    ...(handoffSource.styleKey
                                        ? { style: handoffSource.styleKey }
                                        : {}),
                                    ...(handoffSource.styleLabel
                                        ? { styleLabel: handoffSource.styleLabel }
                                        : {}),
                                    restore: "1",
                                },
                            }}
                        >
                            Изменить ответы
                        </Link>
                    </div>
                )}

                {handoffWarning && (
                    <div className={styles.handoffWarning} role="alert">
                        <strong>Не удалось загрузить анкету</strong>
                        <span>{handoffWarning}</span>
                        <Link href="/questionnaire">Пройти анкету</Link>
                    </div>
                )}

                <div className={styles.projectStatus} data-project-status="true" aria-live="polite">
                    <span>
                        {draftNotice ||
                            "Черновик сохраняется только в этом браузере, без облачной синхронизации."}
                    </span>
                    <button type="button" onClick={startNewProject}>
                        Новый проект
                    </button>
                </div>

                {draftWarning && (
                    <div className={styles.draftWarning} role="alert">
                        <span>{draftWarning}</span>
                        {draftReady && draftCanReset && (
                            <button type="button" onClick={discardBrokenDraft}>
                                Удалить несовместимый черновик
                            </button>
                        )}
                    </div>
                )}

                <div className={styles.workspace} data-planner-workspace="true">
                    <nav className={styles.toolRail} aria-label="Разделы рабочего пространства">
                        <button
                            type="button"
                            aria-pressed={activeWorkspaceTool === "room"}
                            aria-controls="planner-tool-room"
                            onClick={() => activateWorkspaceTool("room")}
                        >
                            <span aria-hidden="true">01</span>
                            Комната
                        </button>
                        <button
                            type="button"
                            aria-pressed={activeWorkspaceTool === "furniture"}
                            aria-controls="planner-tool-furniture"
                            onClick={() => activateWorkspaceTool("furniture")}
                        >
                            <span aria-hidden="true">02</span>
                            Мебель
                        </button>
                        <button
                            type="button"
                            aria-pressed={activeWorkspaceTool === "inspection"}
                            aria-controls="planner-tool-inspection"
                            onClick={() => activateWorkspaceTool("inspection")}
                        >
                            <span aria-hidden="true">03</span>
                            Проверка
                        </button>
                    </nav>
                    <aside className={styles.setupPanel} aria-label="Настройка комнаты">
                        <div className={styles.panelHeading} id="planner-tool-room">
                            <span>01</span>
                            <div>
                                <h2>Комната</h2>
                                <p>Размеры в метрах</p>
                            </div>
                        </div>

                        <div className={styles.roomShapeControl}>
                            <span>Форма комнаты</span>
                            <div role="group" aria-label="Форма комнаты">
                                <button
                                    type="button"
                                    aria-pressed={room.geometry?.kind !== "orthogonal"}
                                    onClick={() => updateRoomShape("rect")}
                                >
                                    Прямоугольная
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={
                                        room.geometry?.kind === "orthogonal" &&
                                        room.geometry.vertices[0]?.x > 0
                                    }
                                    onClick={() => updateRoomShape("l-left")}
                                >
                                    Г слева
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={
                                        room.geometry?.kind === "orthogonal" &&
                                        room.geometry.vertices[0]?.x === 0
                                    }
                                    onClick={() => updateRoomShape("l-right")}
                                >
                                    Г справа
                                </button>
                                <button
                                    type="button"
                                    aria-label="Открыть отдельный редактор контура комнаты"
                                    onClick={() => void router.push("/planner/draw")}
                                >
                                    Нарисовать
                                </button>
                            </div>
                            <small>
                                Откройте большой редактор: он сохраняет совместимый контур и вернёт
                                вас сюда.
                            </small>
                        </div>

                        <div className={styles.dimensionFields}>
                            <div className={styles.dimensionField}>
                                <span>Ширина</span>
                                <span className={styles.dimensionStepper}>
                                    <button
                                        type="button"
                                        aria-label="Уменьшить ширину комнаты на 0,05 м"
                                        onClick={() =>
                                            updateRoomDimension("width", room.width - 50)
                                        }
                                        disabled={room.width <= 2400}
                                    >
                                        −
                                    </button>
                                    <span className={styles.inputWithUnit}>
                                        <DraftNumberInput
                                            name="room-width"
                                            aria-label="Ширина м"
                                            min={2.4}
                                            max={10}
                                            step={0.05}
                                            value={room.width / 1000}
                                            onCommit={(value) =>
                                                updateRoomDimension(
                                                    "width",
                                                    millimetersFromMeters(value),
                                                )
                                            }
                                            aria-describedby="room-range"
                                        />
                                        <span>м</span>
                                    </span>
                                    <button
                                        type="button"
                                        aria-label="Увеличить ширину комнаты на 0,05 м"
                                        onClick={() =>
                                            updateRoomDimension("width", room.width + 50)
                                        }
                                        disabled={room.width >= 10_000}
                                    >
                                        +
                                    </button>
                                </span>
                            </div>
                            <div className={styles.dimensionField}>
                                <span>Глубина</span>
                                <span className={styles.dimensionStepper}>
                                    <button
                                        type="button"
                                        aria-label="Уменьшить глубину комнаты на 0,05 м"
                                        onClick={() =>
                                            updateRoomDimension("depth", room.depth - 50)
                                        }
                                        disabled={room.depth <= 2400}
                                    >
                                        −
                                    </button>
                                    <span className={styles.inputWithUnit}>
                                        <DraftNumberInput
                                            name="room-depth"
                                            aria-label="Глубина м"
                                            min={2.4}
                                            max={10}
                                            step={0.05}
                                            value={room.depth / 1000}
                                            onCommit={(value) =>
                                                updateRoomDimension(
                                                    "depth",
                                                    millimetersFromMeters(value),
                                                )
                                            }
                                            aria-describedby="room-range"
                                        />
                                        <span>м</span>
                                    </span>
                                    <button
                                        type="button"
                                        aria-label="Увеличить глубину комнаты на 0,05 м"
                                        onClick={() =>
                                            updateRoomDimension("depth", room.depth + 50)
                                        }
                                        disabled={room.depth >= 10_000}
                                    >
                                        +
                                    </button>
                                </span>
                            </div>
                        </div>
                        <p id="room-range" className={styles.fieldHint}>
                            От 2,4 до 10 м, шаг 0,05 м.
                        </p>

                        <div className={styles.presets} aria-label="Готовые размеры комнаты">
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    className={
                                        room.width === preset.width && room.depth === preset.depth
                                            ? styles.activePreset
                                            : ""
                                    }
                                    onClick={() => applyPreset(preset.width, preset.depth)}
                                >
                                    <span>{preset.label}</span>
                                    <small>
                                        {preset.width / 1000} × {preset.depth / 1000} м
                                    </small>
                                </button>
                            ))}
                        </div>

                        <details className={styles.openingsDetails}>
                            <summary>
                                <span>
                                    <strong>Проёмы и отопление</strong>
                                    <small>Дверь, окна и радиаторы</small>
                                </span>
                                <em>{room.doors.length + room.windows.length + radiatorCount}</em>
                            </summary>

                            <div className={styles.openingsEditor}>
                                {roomGeometryError && !hasSpecificOpeningIssue && (
                                    <p className={styles.openingIssue} role="alert">
                                        <span>{roomGeometryError}</span>
                                    </p>
                                )}
                                {room.doors.length === 0 && (
                                    <p className={styles.openingEmpty} role="status">
                                        В контуре нет двери. Добавьте её в отдельном редакторе
                                        комнаты, чтобы планировщик смог проверить доступ из проёма.
                                    </p>
                                )}
                                {room.doors.map((door, index) => {
                                    const doorBoundsIssue = doorBoundsIssues.get(door.id) ?? null;

                                    return (
                                        <section key={door.id} className={styles.openingBlock}>
                                            <header>
                                                <span>
                                                    {(door.doorKind ?? "room") === "balcony"
                                                        ? "Балконная дверь"
                                                        : "Дверь"}
                                                    {room.doors.length > 1 ? ` ${index + 1}` : ""}
                                                </span>
                                                <small>
                                                    {door.partitionId
                                                        ? (door.swingDirection ?? "inward") ===
                                                          "inward"
                                                            ? "открывается слева от линии"
                                                            : "открывается справа от линии"
                                                        : (door.swingDirection ?? "inward") ===
                                                            "inward"
                                                          ? "открывается в комнату"
                                                          : "открывается наружу"}
                                                </small>
                                            </header>
                                            <div className={styles.openingGrid}>
                                                <label>
                                                    <span>
                                                        {room.geometry?.kind === "orthogonal" ||
                                                        door.partitionId
                                                            ? "Сегмент"
                                                            : "Стена"}
                                                    </span>
                                                    <select
                                                        name={`door-${door.id}-wall`}
                                                        value={
                                                            room.geometry?.kind === "orthogonal" ||
                                                            door.partitionId
                                                                ? door.partitionId ?? door.segmentId
                                                                : door.wall
                                                        }
                                                        onChange={(event) => {
                                                            const segment = roomDoorSegments.find(
                                                                (candidate) =>
                                                                    candidate.id ===
                                                                    event.target.value,
                                                            );
                                                            const partition = room.partitions?.find(
                                                                (candidate) =>
                                                                    candidate.id ===
                                                                    event.target.value,
                                                            );
                                                            updateDoor(
                                                                door.id,
                                                                (room.geometry?.kind ===
                                                                    "orthogonal" ||
                                                                    door.partitionId) &&
                                                                    segment
                                                                    ? {
                                                                          ...(partition
                                                                              ? {
                                                                                    partitionId:
                                                                                        partition.id,
                                                                                }
                                                                              : {
                                                                                    segmentId:
                                                                                        segment.id,
                                                                                    partitionId:
                                                                                        undefined,
                                                                                }),
                                                                          wall: segment.wall,
                                                                          offset: 0,
                                                                      }
                                                                    : {
                                                                          wall: event.target
                                                                              .value as Wall,
                                                                          segmentId: `rect-${event.target.value}`,
                                                                      },
                                                            );
                                                        }}
                                                    >
                                                        {room.geometry?.kind === "orthogonal" ||
                                                        door.partitionId
                                                            ? roomDoorSegments.map(
                                                                  (segment, segmentIndex) => (
                                                                      <option
                                                                          key={segment.id}
                                                                          value={segment.id}
                                                                      >
                                                                          {room.partitions?.some(
                                                                              (partition) =>
                                                                                  partition.id ===
                                                                                  segment.id,
                                                                          )
                                                                              ? "Перегородка"
                                                                              : `Стена ${
                                                                                    segmentIndex + 1
                                                                                }`}{" "}
                                                                          · {segment.length / 10} см
                                                                      </option>
                                                                  ),
                                                              )
                                                            : WALLS.map((wall) => (
                                                                  <option key={wall} value={wall}>
                                                                      {WALL_LABELS[wall]}
                                                                  </option>
                                                              ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Ширина</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`door-${door.id}-width`}
                                                            min={60}
                                                            max={
                                                                Math.min(
                                                                    wallLength(
                                                                        room,
                                                                        door.wall,
                                                                        door.segmentId,
                                                                        door.partitionId,
                                                                    ),
                                                                    door.partitionId
                                                                        ? Math.max(
                                                                              room.width,
                                                                              room.depth,
                                                                          )
                                                                        : perpendicularWallLength(
                                                                              room,
                                                                              door.wall,
                                                                          ),
                                                                ) / 10
                                                            }
                                                            step={5}
                                                            value={door.width / 10}
                                                            onCommit={(value) =>
                                                                updateDoor(door.id, {
                                                                    width: millimetersFromCentimeters(
                                                                        value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                                <label>
                                                    <span>От начала стены</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`door-${door.id}-offset`}
                                                            min={0}
                                                            max={
                                                                Math.max(
                                                                    0,
                                                                    wallLength(
                                                                        room,
                                                                        door.wall,
                                                                        door.segmentId,
                                                                        door.partitionId,
                                                                    ) - door.width,
                                                                ) / 10
                                                            }
                                                            step={5}
                                                            value={door.offset / 10}
                                                            onCommit={(value) =>
                                                                updateDoor(door.id, {
                                                                    offset: millimetersFromCentimeters(
                                                                        value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                                <label>
                                                    <span>Петли</span>
                                                    <select
                                                        name={`door-${door.id}-hinge`}
                                                        value={door.hinge ?? "start"}
                                                        onChange={(event) =>
                                                            updateDoor(door.id, {
                                                                hinge: event.target.value as
                                                                    | "start"
                                                                    | "end",
                                                            })
                                                        }
                                                    >
                                                        <option value="start">В начале</option>
                                                        <option value="end">В конце</option>
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Открывание</span>
                                                    <select
                                                        name={`door-${door.id}-swing-direction`}
                                                        value={door.swingDirection ?? "inward"}
                                                        onChange={(event) =>
                                                            updateDoor(door.id, {
                                                                swingDirection: event.target
                                                                    .value as "inward" | "outward",
                                                            })
                                                        }
                                                    >
                                                        <option value="inward">В комнату</option>
                                                        <option value="outward">Наружу</option>
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Тип</span>
                                                    <select
                                                        name={`door-${door.id}-kind`}
                                                        value={door.doorKind ?? "room"}
                                                        onChange={(event) =>
                                                            updateDoor(door.id, {
                                                                doorKind: event.target.value as
                                                                    | "room"
                                                                    | "balcony",
                                                            })
                                                        }
                                                    >
                                                        <option value="room">Обычная дверь</option>
                                                        {!door.partitionId && (
                                                            <option value="balcony">
                                                                Балконная дверь
                                                            </option>
                                                        )}
                                                    </select>
                                                </label>
                                            </div>
                                            {(door.doorKind ?? "room") === "balcony" &&
                                                !door.partitionId && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            convertBalconyDoorToWindow(door.id)
                                                        }
                                                        disabled={room.windows.length >= 2}
                                                        title={
                                                            room.windows.length >= 2
                                                                ? "Удалите одно из двух окон, чтобы вернуть это окно."
                                                                : undefined
                                                        }
                                                    >
                                                        Сделать обычным окном
                                                    </button>
                                                )}
                                            {doorBoundsIssue && (
                                                <p className={styles.openingIssue} role="alert">
                                                    <span>{doorBoundsIssue}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateDoor(door.id, {})}
                                                    >
                                                        Исправить по размеру комнаты
                                                    </button>
                                                </p>
                                            )}
                                            {door.width < MIN_CONNECTED_PASSAGE_WIDTH && (
                                                <p className={styles.openingEmpty} role="status">
                                                    Сейчас проём {door.width / 10} см. Размер
                                                    сохранён, но доверенный проход{" "}
                                                    {MIN_CONNECTED_PASSAGE_WIDTH / 10} см не
                                                    подтверждён; проверенные варианты не
                                                    рассчитываются.
                                                </p>
                                            )}
                                        </section>
                                    );
                                })}

                                <section className={styles.openingBlock}>
                                    <header>
                                        <span>Окна</span>
                                        <button
                                            type="button"
                                            onClick={addWindow}
                                            disabled={room.windows.length >= 2}
                                        >
                                            + Добавить
                                        </button>
                                    </header>
                                    {room.windows.length === 0 && (
                                        <p className={styles.openingEmpty}>Окон нет.</p>
                                    )}
                                    {room.windows.map((window, index) => (
                                        <div key={window.id} className={styles.openingItem}>
                                            <div className={styles.openingItemTitle}>
                                                <strong>
                                                    {window.windowKind === "floor-to-ceiling"
                                                        ? "Панорамное окно"
                                                        : "Окно"}{" "}
                                                    {index + 1}
                                                </strong>
                                                <button
                                                    type="button"
                                                    onClick={() => removeWindow(window.id)}
                                                    aria-label={`Удалить окно ${index + 1}`}
                                                >
                                                    Удалить
                                                </button>
                                            </div>
                                            <div className={styles.openingGrid}>
                                                <label>
                                                    <span>
                                                        {room.geometry?.kind === "orthogonal"
                                                            ? "Сегмент"
                                                            : "Стена"}
                                                    </span>
                                                    <select
                                                        name={`window-${window.id}-wall`}
                                                        value={
                                                            room.geometry?.kind === "orthogonal"
                                                                ? window.segmentId
                                                                : window.wall
                                                        }
                                                        onChange={(event) => {
                                                            const segment = roomSegments.find(
                                                                (candidate) =>
                                                                    candidate.id ===
                                                                    event.target.value,
                                                            );
                                                            updateWindow(
                                                                window.id,
                                                                room.geometry?.kind ===
                                                                    "orthogonal" && segment
                                                                    ? {
                                                                          segmentId: segment.id,
                                                                          wall: segment.wall,
                                                                          offset: 0,
                                                                      }
                                                                    : {
                                                                          wall: event.target
                                                                              .value as Wall,
                                                                          segmentId: `rect-${event.target.value}`,
                                                                      },
                                                            );
                                                        }}
                                                    >
                                                        {room.geometry?.kind === "orthogonal"
                                                            ? roomSegments.map((segment, index) => (
                                                                  <option
                                                                      key={segment.id}
                                                                      value={segment.id}
                                                                  >
                                                                      Стена {index + 1} ·{" "}
                                                                      {segment.length / 10} см
                                                                  </option>
                                                              ))
                                                            : WALLS.map((wall) => (
                                                                  <option key={wall} value={wall}>
                                                                      {WALL_LABELS[wall]}
                                                                  </option>
                                                              ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Ширина</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`window-${window.id}-width`}
                                                            min={50}
                                                            max={
                                                                wallLength(
                                                                    room,
                                                                    window.wall,
                                                                    window.segmentId,
                                                                ) / 10
                                                            }
                                                            step={5}
                                                            value={window.width / 10}
                                                            onCommit={(value) =>
                                                                updateWindow(window.id, {
                                                                    width: millimetersFromCentimeters(
                                                                        value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                                <label className={styles.fullField}>
                                                    <span>От начала стены</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`window-${window.id}-offset`}
                                                            min={0}
                                                            max={
                                                                Math.max(
                                                                    0,
                                                                    wallLength(
                                                                        room,
                                                                        window.wall,
                                                                        window.segmentId,
                                                                    ) - window.width,
                                                                ) / 10
                                                            }
                                                            step={5}
                                                            value={window.offset / 10}
                                                            onCommit={(value) =>
                                                                updateWindow(window.id, {
                                                                    offset: millimetersFromCentimeters(
                                                                        value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                                <label>
                                                    <span>Тип</span>
                                                    <select
                                                        name={`window-${window.id}-kind`}
                                                        value={window.windowKind ?? "standard"}
                                                        onChange={(event) => {
                                                            if (event.target.value === "balcony") {
                                                                convertWindowToBalconyDoor(
                                                                    window.id,
                                                                );
                                                                return;
                                                            }
                                                            updateWindow(window.id, {
                                                                windowKind: event.target.value as
                                                                    | "standard"
                                                                    | "floor-to-ceiling",
                                                            });
                                                        }}
                                                    >
                                                        <option value="standard">
                                                            Обычное окно
                                                        </option>
                                                        <option value="floor-to-ceiling">
                                                            Панорамное / до пола
                                                        </option>
                                                        <option value="balcony">
                                                            Балконная дверь
                                                        </option>
                                                    </select>
                                                </label>
                                            </div>
                                            {window.windowKind === "floor-to-ceiling" && (
                                                <p className={styles.openingEmpty} role="status">
                                                    Планировщик сохраняет свободным весь проём и
                                                    зону штор.
                                                </p>
                                            )}
                                            {windowBoundsIssues.get(window.id) && (
                                                <p className={styles.openingIssue} role="alert">
                                                    <span>{windowBoundsIssues.get(window.id)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateWindow(window.id, {})}
                                                    >
                                                        Исправить по размеру стены
                                                    </button>
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </section>

                                <section className={styles.openingBlock}>
                                    <header>
                                        <span>Радиаторы</span>
                                        <button
                                            type="button"
                                            onClick={addRadiator}
                                            disabled={radiatorCount >= 2}
                                        >
                                            + Добавить
                                        </button>
                                    </header>
                                    {radiatorCount === 0 && (
                                        <p className={styles.openingEmpty}>
                                            Нет радиаторов — добавить можно при необходимости.
                                        </p>
                                    )}
                                    {(room.radiators ?? []).map((radiator, index) => (
                                        <div key={radiator.id} className={styles.openingItem}>
                                            <div className={styles.openingItemTitle}>
                                                <strong>Радиатор {index + 1}</strong>
                                                <button
                                                    type="button"
                                                    onClick={() => removeRadiator(radiator.id)}
                                                    aria-label={`Удалить радиатор ${index + 1}`}
                                                >
                                                    Удалить
                                                </button>
                                            </div>
                                            <div className={styles.openingGrid}>
                                                <label>
                                                    <span>
                                                        {room.geometry?.kind === "orthogonal"
                                                            ? "Сегмент"
                                                            : "Стена"}
                                                    </span>
                                                    <select
                                                        name={`radiator-${radiator.id}-wall`}
                                                        value={
                                                            room.geometry?.kind === "orthogonal"
                                                                ? radiator.segmentId
                                                                : radiator.wall
                                                        }
                                                        onChange={(event) => {
                                                            const segment = roomSegments.find(
                                                                (candidate) =>
                                                                    candidate.id ===
                                                                    event.target.value,
                                                            );
                                                            updateRadiator(
                                                                radiator.id,
                                                                room.geometry?.kind ===
                                                                    "orthogonal" && segment
                                                                    ? {
                                                                          segmentId: segment.id,
                                                                          wall: segment.wall,
                                                                          offset: 0,
                                                                      }
                                                                    : {
                                                                          wall: event.target
                                                                              .value as Wall,
                                                                          segmentId: `rect-${event.target.value}`,
                                                                      },
                                                            );
                                                        }}
                                                    >
                                                        {room.geometry?.kind === "orthogonal"
                                                            ? roomSegments.map((segment, index) => (
                                                                  <option
                                                                      key={segment.id}
                                                                      value={segment.id}
                                                                  >
                                                                      Стена {index + 1} ·{" "}
                                                                      {segment.length / 10} см
                                                                  </option>
                                                              ))
                                                            : WALLS.map((wall) => (
                                                                  <option key={wall} value={wall}>
                                                                      {WALL_LABELS[wall]}
                                                                  </option>
                                                              ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Ширина</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`radiator-${radiator.id}-width`}
                                                            min={30}
                                                            max={
                                                                wallLength(
                                                                    room,
                                                                    radiator.wall,
                                                                    radiator.segmentId,
                                                                ) / 10
                                                            }
                                                            step={5}
                                                            value={radiator.width / 10}
                                                            onCommit={(value) =>
                                                                updateRadiator(radiator.id, {
                                                                    width: millimetersFromCentimeters(
                                                                        value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                                <label>
                                                    <span>От начала стены</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`radiator-${radiator.id}-offset`}
                                                            min={0}
                                                            max={
                                                                Math.max(
                                                                    0,
                                                                    wallLength(
                                                                        room,
                                                                        radiator.wall,
                                                                        radiator.segmentId,
                                                                    ) - radiator.width,
                                                                ) / 10
                                                            }
                                                            step={5}
                                                            value={radiator.offset / 10}
                                                            onCommit={(value) =>
                                                                updateRadiator(radiator.id, {
                                                                    offset: millimetersFromCentimeters(
                                                                        value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                                <label>
                                                    <span>Свободная зона</span>
                                                    <span className={styles.compactInput}>
                                                        <DraftNumberInput
                                                            name={`radiator-${radiator.id}-clearance`}
                                                            min={0}
                                                            max={200}
                                                            step={5}
                                                            value={radiator.clearanceDepth / 10}
                                                            onCommit={(value) =>
                                                                updateRadiator(radiator.id, {
                                                                    clearanceDepth:
                                                                        millimetersFromCentimeters(
                                                                            value,
                                                                        ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                            </div>
                                            {radiatorBoundsIssues.get(radiator.id) && (
                                                <p className={styles.openingIssue} role="alert">
                                                    <span>
                                                        {radiatorBoundsIssues.get(radiator.id)}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            updateRadiator(radiator.id, {})
                                                        }
                                                    >
                                                        Исправить по размеру комнаты
                                                    </button>
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </section>
                            </div>
                        </details>

                        <div className={styles.sectionDivider} />

                        <div className={styles.panelHeading} id="planner-tool-furniture">
                            <span>02</span>
                            <div>
                                <h2 id="furniture-heading">Мебель</h2>
                                <p>{formatFurnitureCount(instances.length)} в наборе</p>
                            </div>
                        </div>

                        <a className={styles.mobilePlanShortcut} href="#plan-heading">
                            Перейти к плану комнаты
                            <span>{formatFurnitureCount(instances.length)}</span>
                        </a>
                        {isManualScene && (
                            <a className={styles.mobileLabShortcut} href="#design-lab-heading">
                                К лаборатории
                                <span>
                                    {activeValidationMessages.length > 0
                                        ? "есть замечания"
                                        : "рабочая сцена"}
                                </span>
                            </a>
                        )}

                        <div className={styles.catalogTools}>
                            <label className={styles.catalogSearch}>
                                <span>Поиск мебели</span>
                                <span className={styles.catalogSearchField}>
                                    <input
                                        type="search"
                                        value={catalogSearch}
                                        onChange={(event) => setCatalogSearch(event.target.value)}
                                        placeholder="Кровать, шкаф, стол…"
                                        aria-controls="planner-catalog"
                                    />
                                    {catalogSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setCatalogSearch("")}
                                            aria-label="Очистить поиск мебели"
                                        >
                                            ×
                                        </button>
                                    )}
                                </span>
                            </label>
                            <div
                                className={styles.catalogFilters}
                                role="group"
                                aria-label="Фильтр мебели"
                            >
                                {CATALOG_FILTERS.map((filter) => (
                                    <button
                                        key={filter.value}
                                        type="button"
                                        aria-pressed={catalogFilter === filter.value}
                                        onClick={() => setCatalogFilter(filter.value)}
                                    >
                                        {filter.label}
                                    </button>
                                ))}
                            </div>
                            <p className={styles.catalogSummary} role="status">
                                {visibleCatalogItemCount === 0
                                    ? "Ничего не найдено"
                                    : `Показано: ${visibleCatalogItemCount}`}
                            </p>
                        </div>

                        <div className={styles.catalog} id="planner-catalog">
                            {visibleCatalogGroups.length === 0 ? (
                                <p className={styles.catalogEmpty}>
                                    Измените запрос или выберите другой фильтр — набор комнаты не
                                    изменится.
                                </p>
                            ) : (
                                visibleCatalogGroups.map(({ category, definitions }) => (
                                    <fieldset key={category} className={styles.catalogGroup}>
                                        <legend>{CATEGORY_LABELS[category]}</legend>
                                        {definitions.map((definition) => {
                                            const count = selection[definition.id] ?? 0;
                                            const unplacedForDefinition =
                                                manualPlacementInstances.filter(
                                                    (instance) =>
                                                        instance.definitionId === definition.id,
                                                );
                                            const maximumCount = getSelectionLimit(
                                                definition.id,
                                                selection,
                                            );
                                            const checkboxId = `furniture-${definition.id}`;

                                            return (
                                                <div
                                                    key={definition.id}
                                                    className={`${styles.catalogRow} ${
                                                        count > 0 ? styles.selectedCatalogRow : ""
                                                    }`}
                                                    data-catalog-item={definition.id}
                                                    data-selected={count > 0 ? "true" : "false"}
                                                >
                                                    <input
                                                        id={checkboxId}
                                                        type="checkbox"
                                                        checked={count > 0}
                                                        disabled={count === 0 && maximumCount === 0}
                                                        onChange={(event) =>
                                                            updateSelection(
                                                                definition.id,
                                                                event.target.checked ? 1 : 0,
                                                            )
                                                        }
                                                    />
                                                    <label
                                                        htmlFor={checkboxId}
                                                        className={styles.catalogItemLabel}
                                                        data-catalog-item-label="true"
                                                    >
                                                        {getFurniturePhoto(definition.id) && (
                                                            <span
                                                                style={{
                                                                    display: "block",
                                                                    width: 64,
                                                                    height: 56,
                                                                }}
                                                            >
                                                                <FurniturePhoto
                                                                    photo={
                                                                        getFurniturePhoto(
                                                                            definition.id,
                                                                        )!
                                                                    }
                                                                    fit
                                                                />
                                                            </span>
                                                        )}
                                                        <strong>{definition.shortLabel}</strong>
                                                        <small>
                                                            {getDefinitionDimensions(definition)} мм
                                                            {isSchematicFurnitureSource(
                                                                definition.source,
                                                            ) && " · схема — сверьте размер"}
                                                        </small>
                                                    </label>
                                                    <span className={styles.counter}>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                updateSelection(
                                                                    definition.id,
                                                                    count - 1,
                                                                )
                                                            }
                                                            disabled={count === 0}
                                                            aria-label={`Уменьшить количество: ${definition.label}`}
                                                        >
                                                            −
                                                        </button>
                                                        <output aria-label="Количество">
                                                            {count}
                                                        </output>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                updateSelection(
                                                                    definition.id,
                                                                    count + 1,
                                                                )
                                                            }
                                                            disabled={count >= maximumCount}
                                                            aria-label={`Увеличить количество: ${definition.label}`}
                                                        >
                                                            +
                                                        </button>
                                                    </span>
                                                    {count > 0 && (
                                                        <label
                                                            className={styles.priorityPicker}
                                                            data-catalog-priority="true"
                                                        >
                                                            <span>Приоритет</span>
                                                            <select
                                                                value={
                                                                    priorities[definition.id] ??
                                                                    "preferred"
                                                                }
                                                                aria-label={`Приоритет: ${definition.label}`}
                                                                onChange={(event) =>
                                                                    updatePriority(
                                                                        definition.id,
                                                                        event.target
                                                                            .value as FurniturePriority,
                                                                    )
                                                                }
                                                            >
                                                                <option value="required">
                                                                    Обязательно
                                                                </option>
                                                                <option value="preferred">
                                                                    Желательно
                                                                </option>
                                                                <option value="optional">
                                                                    Можно убрать
                                                                </option>
                                                            </select>
                                                        </label>
                                                    )}
                                                    {unplacedForDefinition.length > 0 && (
                                                        <div className={styles.unplacedControl}>
                                                            {unplacedForDefinition.map(
                                                                (instance) => (
                                                                    <button
                                                                        key={instance.instanceId}
                                                                        type="button"
                                                                        draggable={false}
                                                                        data-manual-drag-source="true"
                                                                        onPointerDown={(event) =>
                                                                            beginManualSourceDrag(
                                                                                event,
                                                                                instance,
                                                                            )
                                                                        }
                                                                        onPointerMove={
                                                                            updateManualSourceDrag
                                                                        }
                                                                        onPointerUp={(event) =>
                                                                            finishManualSourceDrag(
                                                                                event.pointerId,
                                                                                event.clientX,
                                                                                event.clientY,
                                                                            )
                                                                        }
                                                                        onPointerCancel={(event) =>
                                                                            cancelManualSourceDrag(
                                                                                event.pointerId,
                                                                            )
                                                                        }
                                                                        onClick={() => {
                                                                            if (
                                                                                suppressManualSourceClickRef.current ===
                                                                                instance.instanceId
                                                                            ) {
                                                                                suppressManualSourceClickRef.current =
                                                                                    null;
                                                                                return;
                                                                            }
                                                                            addUnplacedAtCenter(
                                                                                instance,
                                                                            );
                                                                        }}
                                                                        title="Перетащите предмет на свободное место в плане. Нажатие добавит его в центр комнаты."
                                                                    >
                                                                        На план
                                                                        {instanceNumber(
                                                                            instance.instanceId,
                                                                        )}
                                                                        <small>
                                                                            перетащите на комнату
                                                                        </small>
                                                                    </button>
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </fieldset>
                                ))
                            )}
                        </div>

                        <p className={styles.priorityNote}>
                            Обязательные предметы не удаляются автоматически. «Можно убрать» —
                            только предложение после доказанной невозможности и с вашим
                            подтверждением.
                        </p>

                        {hasTv && (
                            <div
                                className={`${styles.tvTarget} ${
                                    tvTargetMissing ? styles.tvTargetError : ""
                                } ${tvTargetChoiceRequired ? styles.tvTargetNeedsChoice : ""}`}
                            >
                                <strong>Куда направить телевизор?</strong>
                                {hasBed && hasSofa ? (
                                    <>
                                        {tvTargetChoiceRequired && (
                                            <p className={styles.tvTargetPrompt}>
                                                Выберите один вариант, чтобы продолжить.
                                            </p>
                                        )}
                                        <div className={styles.tvTargetOptions}>
                                            <label>
                                                <input
                                                    type="radio"
                                                    name="tv-target"
                                                    value="living"
                                                    checked={tvTargetCategory === "living"}
                                                    onChange={() => {
                                                        setTvTargetCategory("living");
                                                        setHandoffSource((current) =>
                                                            current
                                                                ? { ...current, modified: true }
                                                                : current,
                                                        );
                                                        setResultNotice("");
                                                    }}
                                                />
                                                <span>Напротив дивана</span>
                                            </label>
                                            <label>
                                                <input
                                                    type="radio"
                                                    name="tv-target"
                                                    value="sleep"
                                                    checked={tvTargetCategory === "sleep"}
                                                    onChange={() => {
                                                        setTvTargetCategory("sleep");
                                                        setHandoffSource((current) =>
                                                            current
                                                                ? { ...current, modified: true }
                                                                : current,
                                                        );
                                                        setResultNotice("");
                                                    }}
                                                />
                                                <span>Напротив кровати</span>
                                            </label>
                                        </div>
                                    </>
                                ) : tvTargetMissing ? (
                                    <p>
                                        Добавьте диван или кровать — без точки просмотра нельзя
                                        определить направление экрана.
                                    </p>
                                ) : (
                                    <p>
                                        Цель выбрана автоматически: напротив{" "}
                                        {hasSofa ? "дивана" : "кровати"}.
                                    </p>
                                )}
                            </div>
                        )}

                        <div className={styles.nextStageNote}>
                            <strong>
                                Сейчас:{" "}
                                {room.geometry?.kind === "orthogonal"
                                    ? "ортогональная комната"
                                    : "прямоугольная комната"}
                            </strong>
                            <span>
                                Контур и перегородки учитываются в проходах, расстановке и экспорте.
                            </span>
                        </div>
                    </aside>

                    <section className={styles.planSection} aria-labelledby="plan-heading">
                        <div
                            className={styles.primaryWorktable}
                            data-planner-primary-worktable="true"
                        >
                            <div className={styles.planToolbar}>
                                <div>
                                    <span className={styles.toolbarStep}>03</span>
                                    <div>
                                        <h2 id="plan-heading">План комнаты</h2>
                                        <p>
                                            {`${room.windows.length} окн. · ${room.doors.length} дв. · ${partitionCount} перег. · ${radiatorCount} рад.`}
                                        </p>
                                    </div>
                                </div>

                                <div className={styles.toolbarActions}>
                                    <button
                                        type="button"
                                        className={styles.secondaryAction}
                                        aria-pressed={showClearances}
                                        onClick={() => setShowClearances((current) => !current)}
                                    >
                                        <span className={styles.zoneIcon} aria-hidden="true" />
                                        {showClearances ? "Скрыть зоны" : "Показать зоны"}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.secondaryAction}
                                        aria-pressed={isRoomEditing}
                                        onClick={() => setIsRoomEditing((current) => !current)}
                                    >
                                        {isRoomEditing ? "Готово с проёмами" : "Править комнату"}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.resetAction}
                                        onClick={confirmResetPlanner}
                                    >
                                        Сбросить
                                    </button>
                                </div>
                            </div>

                            {hasFullVariants && (
                                <div className={styles.variantBar}>
                                    <div
                                        className={styles.variantTabs}
                                        role="group"
                                        aria-label="Варианты планировки"
                                    >
                                        {variants.map((variant) => (
                                            <button
                                                key={variant.variantId}
                                                type="button"
                                                aria-pressed={activeVariantId === variant.variantId}
                                                className={
                                                    activeVariantId === variant.variantId
                                                        ? styles.activeVariant
                                                        : ""
                                                }
                                                onClick={() => activateVariant(variant.variantId)}
                                            >
                                                <strong>{variant.profile.label}</strong>
                                                <small>
                                                    {editedVariantIds.has(variant.variantId)
                                                        ? "изменён вручную"
                                                        : formatVariantMetric(variant)}
                                                </small>
                                            </button>
                                        ))}
                                    </div>
                                    {activeVariant && activeVariantHighlights.length > 0 && (
                                        <aside
                                            className={styles.variantExplanation}
                                            aria-label="Почему выбран этот вариант"
                                        >
                                            <strong>
                                                {editedVariantIds.has(activeVariant.variantId)
                                                    ? "Что характеризует текущую расстановку"
                                                    : "Почему выбран этот вариант"}
                                            </strong>
                                            <p>
                                                {editedVariantIds.has(activeVariant.variantId)
                                                    ? "После ручных изменений показываем свойства текущей версии, а не исходную оценку решателя."
                                                    : `Это лучший проверенный результат сценария «${activeVariant.profile.label}», структурно отличающийся от остальных.`}
                                            </p>
                                            <ul>
                                                {activeVariantHighlights.map((highlight) => (
                                                    <li key={highlight}>{highlight}</li>
                                                ))}
                                            </ul>
                                        </aside>
                                    )}
                                </div>
                            )}

                            <div
                                ref={draftingBoardRef}
                                className={styles.draftingBoard}
                                data-fullscreen={planFullscreen ? "true" : "false"}
                            >
                                <div
                                    className={styles.planViewControls}
                                    role="group"
                                    aria-label="Масштаб плана"
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setPlanZoom((current) => Math.max(0.75, current - 0.25))
                                        }
                                        disabled={planZoom <= 0.75}
                                        aria-label={"Уменьшить план"}
                                    >
                                        −
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPlanZoom(1);
                                            planPanViewportRef.current?.scrollTo({
                                                left: 0,
                                                top: 0,
                                                behavior: "auto",
                                            });
                                        }}
                                        aria-label={"Вместить план по ширине"}
                                    >
                                        По ширине · {Math.round(planZoom * 100)}%
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setPlanZoom((current) => Math.min(2, current + 0.25))
                                        }
                                        disabled={planZoom >= 2}
                                        aria-label={"Увеличить план"}
                                    >
                                        +
                                    </button>
                                    <button
                                        type="button"
                                        onClick={togglePlanFullscreen}
                                        aria-pressed={planFullscreen}
                                    >
                                        {planFullscreen ? "Закрыть экран" : "На весь экран"}
                                    </button>
                                </div>
                                <div
                                    ref={planPanViewportRef}
                                    className={styles.planPanViewport}
                                    aria-label="Прокручиваемая область плана"
                                    tabIndex={0}
                                    data-plan-zoom={planZoom !== 1 ? "manual" : "fit"}
                                    data-room-editing={isRoomEditing ? "true" : "false"}
                                    style={
                                        planFit.maxHeight > 0
                                            ? { maxHeight: `${planFit.maxHeight}px` }
                                            : undefined
                                    }
                                >
                                    <div
                                        className={styles.planZoomSurface}
                                        style={
                                            planFit.width > 0
                                                ? { width: `${planFit.width * planZoom}px` }
                                                : { width: `${planZoom * 100}%` }
                                        }
                                    >
                                        <PlanCanvas
                                            room={room}
                                            placements={displayedPlacements}
                                            unplacedInstances={manualPlacementInstances}
                                            selectedInstanceId={selectedInstanceId}
                                            invalidInstanceIds={invalidInstanceIds}
                                            showClearances={showClearances}
                                            isRoomEditing={isRoomEditing}
                                            phase={phase}
                                            failure={failure}
                                            onSelect={setSelectedInstanceId}
                                            onPreviewPlacement={setPreviewPlacement}
                                            onCommitPlacement={commitDraggedPlacement}
                                            onAddPlacement={addUnplacedPlacement}
                                            onNudgePlacement={nudgePlacement}
                                            onRotatePlacement={rotatePlacement}
                                            onMoveDoor={(doorId, offset) =>
                                                updateDoor(doorId, { offset })
                                            }
                                            onMoveWindow={(windowId, offset) =>
                                                updateWindow(windowId, { offset })
                                            }
                                            onMoveRadiator={(radiatorId, offset) =>
                                                updateRadiator(radiatorId, { offset })
                                            }
                                            onResizeRoom={resizeRoomDirectly}
                                            onResizeRectangleBounds={resizeRectangleBoundsDirectly}
                                            onRestoreRoom={restoreRoomDirectly}
                                            onMoveRoomVertex={moveRoomVertexDirectly}
                                            onSplitRoomSegment={splitRoomSegmentDirectly}
                                            onRoomEditGestureChange={setIsRoomEditGestureActive}
                                        />
                                    </div>
                                </div>
                                <div className={styles.canvasLegend}>
                                    <>
                                        <span>
                                            <i className={styles.windowLegend} /> окно
                                        </span>
                                        <span>
                                            <i className={styles.doorLegend} /> дверь и открывание
                                        </span>
                                    </>

                                    {radiatorCount > 0 && (
                                        <span>
                                            <i className={styles.radiatorLegend} /> радиатор
                                        </span>
                                    )}
                                    {showClearances && (
                                        <span>
                                            <i className={styles.zoneLegend} /> зона эксплуатации
                                        </span>
                                    )}
                                    {isRoomEditing && (
                                        <span className={styles.roomEditGuidance} role="status">
                                            Режим комнаты: тяните углы, а середину свободной стены —
                                            чтобы добавить уступ. Только прямые углы; Esc отменяет
                                            незавершённое перемещение.
                                        </span>
                                    )}
                                    {blockedRoomEditorSegments.length > 0 && (
                                        <span
                                            id="room-editor-blocked-summary"
                                            className={styles.roomEditBlockedSummary}
                                            role="status"
                                        >
                                            Уступ на стене с проёмом временно недоступен: сначала
                                            передвиньте дверь, окно или радиатор.
                                        </span>
                                    )}
                                    {displayedPlacements.length === 0 &&
                                        phase !== "solving" &&
                                        (!failure || !hasRequestedLayoutCalculation) && (
                                            <span
                                                className={styles.idlePlanGuidance}
                                                data-plan-idle-guidance="true"
                                            >
                                                Добавьте предмет с помощью «На план» или нажмите
                                                «Уместить всё».
                                            </span>
                                        )}
                                </div>
                                {displayedPlacements.length > 0 && (
                                    <div
                                        className={styles.mobileObjectPicker}
                                        aria-label="Выбрать предмет на плане"
                                    >
                                        <strong>Выбрать предмет на плане</strong>
                                        <div>
                                            {displayedPlacements.map((placement) => (
                                                <button
                                                    key={placement.instanceId}
                                                    type="button"
                                                    aria-pressed={
                                                        placement.instanceId === selectedInstanceId
                                                    }
                                                    onClick={() =>
                                                        setSelectedInstanceId(placement.instanceId)
                                                    }
                                                >
                                                    {
                                                        getFurniture(placement.definitionId)
                                                            .shortLabel
                                                    }
                                                    {instanceNumber(placement.instanceId)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className={styles.primaryActionRow}>
                                <button
                                    type="button"
                                    className={styles.primaryAction}
                                    onClick={runSolver}
                                    disabled={phase === "solving" || tvGenerationBlocked}
                                >
                                    {phase === "solving" ? "Умещаем набор…" : "Уместить всё"}
                                </button>
                                <p>
                                    {tvTargetChoiceRequired
                                        ? "Сначала выберите цель телевизора в списке мебели."
                                        : tvTargetMissing
                                          ? "Для телевизора нужна кровать или диван."
                                          : "Показываем только полные планы с разными сценариями. Если их нет, предложим рабочее ядро."}
                                </p>
                            </div>
                        </div>

                        <section className={styles.designLab} aria-labelledby="design-lab-heading">
                            <header className={styles.designLabHeader}>
                                <span className={styles.designLabNumber} aria-hidden="true">
                                    05
                                </span>
                                <div>
                                    <span className={styles.designLabKicker} aria-hidden="true">
                                        ╱✎
                                    </span>
                                    <h3 id="design-lab-heading">Лаборатория расстановки</h3>
                                    <p>
                                        После расчёта каждый полный вариант или рабочее ядро
                                        сохраняется в базе с исходными параметрами и координатами. У
                                        выбранной расстановки — один общий комментарий дизайнера,
                                        без заметок к каждому предмету.
                                    </p>
                                </div>
                                <span
                                    className={styles.designLabStatus}
                                    data-tone={designLabStatus.tone}
                                    role="status"
                                >
                                    <i aria-hidden="true" />
                                    {designLabStatus.label}
                                </span>
                            </header>

                            <div className={styles.designLabActions}>
                                <button
                                    type="button"
                                    className={styles.designLabStart}
                                    onClick={startManualScene}
                                    disabled={phase === "solving"}
                                    aria-describedby="design-lab-manual-description"
                                >
                                    {isManualScene ? "Начать сцену заново" : "Начать вручную"}
                                </button>
                                <p id="design-lab-manual-description">
                                    Очистит только расстановку и варианты. Размеры комнаты, проёмы,
                                    выбранная мебель и приоритеты сохранятся. Чтобы зафиксировать
                                    наблюдение в базе, рассчитайте новый вариант.
                                </p>
                            </div>

                            {!isManualScene && activeObservationId && activeObservationRequest ? (
                                <form
                                    className={styles.designLabForm}
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        void saveActiveObservationReview();
                                    }}
                                >
                                    <label>
                                        <span>
                                            {isReviewingWorkingCore
                                                ? `Оценка рабочего ядра (${placements.length} из ${instances.length} предметов)`
                                                : `Оценка варианта «${activeVariant?.profile.label ?? "расстановка"}»`}
                                        </span>
                                        <select
                                            value={activeObservationReview.verdict}
                                            onChange={(event) =>
                                                updateActiveObservationReview({
                                                    verdict: event.target
                                                        .value as PlannerObservationVerdict,
                                                })
                                            }
                                        >
                                            {Object.entries(DESIGN_LAB_VERDICT_LABELS).map(
                                                ([value, label]) => (
                                                    <option key={value} value={value}>
                                                        {label}
                                                    </option>
                                                ),
                                            )}
                                        </select>
                                    </label>
                                    {isReviewingWorkingCore && (
                                        <p className={styles.designLabNotice}>
                                            Сохраним отзыв вместе со снимком неполной расстановки и
                                            перечнем предметов, которые в неё не вошли.
                                        </p>
                                    )}
                                    <label className={styles.designLabNoteField}>
                                        <span>Один общий комментарий дизайнера</span>
                                        <textarea
                                            value={activeObservationReview.comment}
                                            onChange={(event) =>
                                                updateActiveObservationReview({
                                                    comment: event.target.value,
                                                })
                                            }
                                            maxLength={1200}
                                            placeholder="Например: у окна остаётся проход, но кровать выглядит слишком оторванной от зоны хранения."
                                        />
                                    </label>
                                    <div className={styles.designLabFormAction}>
                                        <span>{activeObservationReview.comment.length} / 1200</span>
                                        <button
                                            type="submit"
                                            disabled={activeObservationState === "saving"}
                                        >
                                            {activeObservationState === "saving"
                                                ? "Сохраняем в базу…"
                                                : "Сохранить наблюдение"}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <p className={styles.designLabNotice}>
                                    {isManualScene
                                        ? "Ручную сцену можно проверить вживую; комментарий в базе относится только к сохранённому автоматическому варианту."
                                        : "Сначала рассчитайте вариант — тогда его снимок появится в базе для оценки."}
                                </p>
                            )}

                            {observationNotice && (
                                <p className={styles.designLabNotice} role="status">
                                    {observationNotice}
                                </p>
                            )}
                        </section>

                        {hasPreferredFallback && (
                            <div
                                className={`${styles.resultNotice} ${styles.workingCoreNotice}`}
                                role="status"
                            >
                                <strong>Рабочее ядро — не полный вариант.</strong> Автоматически
                                размещено {placements.length} из {instances.length} предметов.{" "}
                                {hasRequiredFallback
                                    ? "Часть обязательных предметов "
                                    : "Часть желательных предметов "}
                                не вошла в полный план за отведённое время:{" "}
                                {unplacedPreferredInstances
                                    .map(
                                        (instance) =>
                                            `${getFurniture(instance.definitionId).shortLabel}${instanceNumber(
                                                instance.instanceId,
                                            )}`,
                                    )
                                    .join(", ")}
                                . Они остаются в комплекте: перетащите «На план» из боковой панели
                                на свободное место. Перед сохранением планировщик проверит корпус,
                                проходы и проёмы.
                            </div>
                        )}

                        {failure && hasRequestedLayoutCalculation && phase !== "solving" && (
                            <div className={styles.failureResult} role="alert">
                                <span className={styles.resultMark}>!</span>
                                <div>
                                    <strong>
                                        {failure.reason === "invalid-room"
                                            ? "Проверьте комнату и проёмы"
                                            : failure.reason === "access-unverified"
                                              ? "Проход 700 мм не подтверждён"
                                              : failure.reason === "invalid-request"
                                                ? "Проверьте набор мебели"
                                                : failure.reason === "search-exhausted"
                                                  ? "Быстрый расчёт не завершён"
                                                  : "Набор не помещается по заданным ограничениям"}
                                    </strong>
                                    <p>
                                        {failure.reason === "search-exhausted"
                                            ? "Лимит поиска исчерпан. Это не доказывает, что мебель физически не помещается: повторите расчёт или скорректируйте один из необязательных предметов."
                                            : failure.message}
                                    </p>
                                    {failure.reason !== "invalid-room" &&
                                        failure.blockingInstanceIds.length > 0 && (
                                            <p className={styles.blockers}>
                                                Диагностический список:{" "}
                                                {failure.blockingInstanceIds
                                                    .map((instanceId) =>
                                                        instances.find(
                                                            (instance) =>
                                                                instance.instanceId === instanceId,
                                                        ),
                                                    )
                                                    .filter(Boolean)
                                                    .map(
                                                        (instance) =>
                                                            getFurniture(instance!.definitionId)
                                                                .shortLabel,
                                                    )
                                                    .join(", ")}
                                                . Эти предметы участвовали в самой глубокой
                                                неудачной попытке, но это не означает, что каждый из
                                                них несовместим с комнатой.
                                            </p>
                                        )}
                                </div>
                                {failure.reason === "proven-impossible" && !isStale && (
                                    <div className={styles.removalConfirmation}>
                                        {!automaticRemovalProposal && hasOptionalInstances ? (
                                            <button
                                                type="button"
                                                onClick={calculateAutomaticRemovalProposal}
                                            >
                                                Рассчитать предложение
                                            </button>
                                        ) : !automaticRemovalProposal ? (
                                            <p>
                                                В комплекте нет предметов «Можно убрать». Ничего не
                                                будет удалено автоматически.
                                            </p>
                                        ) : null}
                                    </div>
                                )}
                                {automaticRemovalProposal && (
                                    <section
                                        className={styles.automaticRemovalProposal}
                                        aria-labelledby="automatic-removal-heading"
                                    >
                                        <div>
                                            <strong id="automatic-removal-heading">
                                                Предложение готово — пока ничего не изменено
                                            </strong>
                                            <p>
                                                Доказано, что полный набор не помещается. Вариант
                                                без перечисленных ниже необязательных предметов
                                                прошёл проверку. Желательные и обязательные предметы
                                                сохранены.
                                            </p>
                                            <ul>
                                                {automaticRemovalProposal.removedItems.map(
                                                    (record) => (
                                                        <li key={record.instanceId}>
                                                            <b>
                                                                {
                                                                    getFurniture(
                                                                        record.definitionId,
                                                                    ).shortLabel
                                                                }
                                                                {instanceNumber(record.instanceId)}
                                                            </b>
                                                            <span>{record.reason}</span>
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        </div>
                                        <div
                                            className={styles.automaticRemovalActions}
                                            role="group"
                                            aria-label="Применить или отменить предложение"
                                        >
                                            <button
                                                type="button"
                                                onClick={cancelAutomaticRemovalProposal}
                                            >
                                                Отмена
                                            </button>
                                            <button
                                                type="button"
                                                onClick={applyAutomaticRemovalProposal}
                                            >
                                                Применить и перестроить
                                            </button>
                                        </div>
                                    </section>
                                )}
                            </div>
                        )}

                        {resultNotice && (
                            <div className={styles.resultNotice} role="status">
                                {resultNotice}
                            </div>
                        )}

                        {hasRequestedLayoutCalculation && !isStale && resultNotes.length > 0 && (
                            <aside className={styles.resultNotes} aria-label="Оговорки расчёта">
                                <strong>Что важно учесть</strong>
                                <ul>
                                    {resultNotes.map((note) => (
                                        <li key={note}>{note}</li>
                                    ))}
                                </ul>
                            </aside>
                        )}

                        {resultSpecification && (
                            <section
                                className={styles.resultSpecification}
                                aria-labelledby="result-specification-heading"
                            >
                                <header className={styles.resultSpecificationHeader}>
                                    <div>
                                        <span>Готовый вариант</span>
                                        <h3 id="result-specification-heading">
                                            Итоговая спецификация
                                        </h3>
                                        <p>
                                            Сформировано{" "}
                                            {formatResultDate(resultSpecification.generatedAt)}
                                        </p>
                                    </div>
                                    <div className={styles.resultActions}>
                                        <button type="button" onClick={exportResultAsPng}>
                                            Скачать PNG
                                        </button>
                                        <button type="button" onClick={printResult}>
                                            Печать / сохранить PDF
                                        </button>
                                    </div>
                                </header>

                                <p className={styles.printHint}>
                                    PDF создаётся через системный диалог печати браузера — выберите
                                    «Сохранить как PDF».
                                </p>
                                <p className={styles.exportStatus} role="status" aria-live="polite">
                                    {exportStatus}
                                </p>

                                <div className={styles.resultRoomSummary}>
                                    <div>
                                        <span>Комната</span>
                                        <strong>
                                            {resultSpecification.room.width} ×{" "}
                                            {resultSpecification.room.depth} мм
                                        </strong>
                                        <small>
                                            {formatArea(resultSpecification.room)} м² ·
                                            прямоугольная
                                        </small>
                                    </div>
                                    <ul aria-label="Проёмы и отопление">
                                        {resultSpecification.room.doors.map((door, index) => (
                                            <li key={door.id}>
                                                {(door.doorKind ?? "room") === "balcony"
                                                    ? "Балконная дверь"
                                                    : "Дверь"}{" "}
                                                {index + 1}: {WALL_LABELS[door.wall].toLowerCase()},
                                                ширина {door.width} мм, отступ {door.offset} мм,
                                                зона открывания {door.clearanceDepth} мм
                                            </li>
                                        ))}
                                        {resultSpecification.room.windows.map((window, index) => (
                                            <li key={window.id}>
                                                {window.windowKind === "floor-to-ceiling"
                                                    ? "Панорамное окно"
                                                    : "Окно"}{" "}
                                                {index + 1}:{" "}
                                                {WALL_LABELS[window.wall].toLowerCase()}, ширина{" "}
                                                {window.width} мм, отступ {window.offset} мм
                                            </li>
                                        ))}
                                        {(resultSpecification.room.radiators ?? []).map(
                                            (radiator, index) => (
                                                <li key={radiator.id}>
                                                    Радиатор {index + 1}:{" "}
                                                    {WALL_LABELS[radiator.wall].toLowerCase()},
                                                    ширина {radiator.width} мм, отступ{" "}
                                                    {radiator.offset} мм, свободная зона{" "}
                                                    {radiator.clearanceDepth} мм
                                                </li>
                                            ),
                                        )}
                                    </ul>
                                </div>

                                <p className={styles.resultTableHint}>
                                    Проведите по таблице вбок, чтобы увидеть все столбцы.
                                </p>
                                <div
                                    className={styles.resultTableViewport}
                                    role="region"
                                    aria-label="Таблица мебели"
                                    tabIndex={0}
                                >
                                    <table className={styles.resultTable}>
                                        <thead>
                                            <tr>
                                                <th scope="col">Предмет</th>
                                                <th scope="col">Размер</th>
                                                <th scope="col">Приоритет</th>
                                                <th scope="col">X / Y</th>
                                                <th scope="col">Поворот</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {resultSpecification.items.map((item) => (
                                                <tr key={item.instanceId}>
                                                    <th scope="row">{item.name}</th>
                                                    <td>
                                                        {item.width} × {item.depth} мм
                                                    </td>
                                                    <td>{PRIORITY_LABELS[item.priority]}</td>
                                                    <td>
                                                        {item.x} / {item.y} мм
                                                    </td>
                                                    <td>{item.rotation}°</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {resultSpecification.removedItems.length > 0 && (
                                    <section
                                        className={styles.removedItemsSummary}
                                        aria-labelledby="removed-items-heading"
                                    >
                                        <h4 id="removed-items-heading">Удалено из проекта</h4>
                                        <p>
                                            Эти предметы не входят в показанный вариант. Причина и
                                            время сохранены в спецификации.
                                        </p>
                                        <ul>
                                            {resultSpecification.removedItems.map((item) => (
                                                <li key={item.instanceId}>
                                                    <div>
                                                        <strong>{item.name}</strong>
                                                        <span>
                                                            {item.method === "automatic"
                                                                ? "По предложению планировщика"
                                                                : "Удалено вручную"}
                                                            {" · "}
                                                            {PRIORITY_LABELS[item.priority]}
                                                        </span>
                                                    </div>
                                                    <p>{item.reason}</p>
                                                    <time dateTime={item.removedAt}>
                                                        {formatResultDate(item.removedAt)}
                                                    </time>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                <div className={styles.resultEvidenceGrid}>
                                    <div>
                                        <h4>Проверено алгоритмом</h4>
                                        <ul>
                                            {resultSpecification.checks.map((check) => (
                                                <li key={check.id}>✓ {check.label}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div>
                                        <h4>Ограничения и допущения</h4>
                                        <ul>
                                            {resultSpecification.caveats.map((caveat) => (
                                                <li key={caveat}>{caveat}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>

                                <footer className={styles.resultVersion}>
                                    Алгоритм {resultSpecification.algorithmVersion} · схема{" "}
                                    {resultSpecification.schemaVersion} · каталог{" "}
                                    {resultSpecification.catalogRevision}
                                </footer>
                            </section>
                        )}
                    </section>

                    <aside
                        className={styles.inspector}
                        id="planner-tool-inspection"
                        aria-label="Проверка и настройка предмета"
                    >
                        <div className={styles.panelHeading}>
                            <span>04</span>
                            <div>
                                <h2>Проверка</h2>
                                <p>Выбранный предмет</p>
                            </div>
                        </div>

                        {selectedPlacement && selectedDefinition ? (
                            <div className={styles.selectedInspector}>
                                <div className={styles.selectedItemHeading}>
                                    <span className={styles.selectedItemThumb} aria-hidden="true">
                                        {getFurniturePhoto(
                                            selectedDefinition.id,
                                            selectedPlacement.photoId,
                                        ) ? (
                                            <span className={styles.selectedItemImage}>
                                                <FurniturePhoto
                                                    photo={
                                                        getFurniturePhoto(
                                                            selectedDefinition.id,
                                                            selectedPlacement.photoId,
                                                        )!
                                                    }
                                                    fit
                                                />
                                            </span>
                                        ) : (
                                            selectedAsset && (
                                                <>
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={selectedAsset.src}
                                                        alt=""
                                                        loading="lazy"
                                                        draggable={false}
                                                        style={{
                                                            transform: `rotate(${selectedAsset.baseRotation}deg)`,
                                                        }}
                                                    />
                                                </>
                                            )
                                        )}
                                    </span>
                                    <div>
                                        <strong>{selectedDefinition.label}</strong>
                                        <small>
                                            {selectedPlacement.width ??
                                                getRotatedGeometry(selectedDefinition, 0)
                                                    .width}{" "}
                                            ×{" "}
                                            {selectedPlacement.depth ??
                                                getRotatedGeometry(selectedDefinition, 0)
                                                    .depth}{" "}
                                            мм
                                        </small>
                                    </div>
                                </div>

                                <dl className={styles.coordinates}>
                                    <div>
                                        <dt>X</dt>
                                        <dd>{selectedPlacement.x} мм</dd>
                                    </div>
                                    <div>
                                        <dt>Y</dt>
                                        <dd>{selectedPlacement.y} мм</dd>
                                    </div>
                                    <div>
                                        <dt>Поворот</dt>
                                        <dd>{selectedPlacement.rotation}°</dd>
                                    </div>
                                </dl>

                                <div className={styles.nudgeControl}>
                                    <span>Перемещение · шаг 50 мм</span>
                                    <div className={styles.arrowPad}>
                                        <button
                                            type="button"
                                            className={styles.arrowUp}
                                            onClick={() => nudgeSelected(0, -50)}
                                            aria-label="Сдвинуть вверх на 50 миллиметров"
                                        >
                                            ↑
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.arrowLeft}
                                            onClick={() => nudgeSelected(-50, 0)}
                                            aria-label="Сдвинуть влево на 50 миллиметров"
                                        >
                                            ←
                                        </button>
                                        <span className={styles.arrowCenter} aria-hidden="true" />
                                        <button
                                            type="button"
                                            className={styles.arrowRight}
                                            onClick={() => nudgeSelected(50, 0)}
                                            aria-label="Сдвинуть вправо на 50 миллиметров"
                                        >
                                            →
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.arrowDown}
                                            onClick={() => nudgeSelected(0, 50)}
                                            aria-label="Сдвинуть вниз на 50 миллиметров"
                                        >
                                            ↓
                                        </button>
                                    </div>
                                    <small>
                                        На плане: перетащите предмет. Стрелки — шаг 50 мм, R —
                                        поворот, Esc — отмена.
                                    </small>
                                </div>

                                <div className={styles.inspectorActions}>
                                    <button type="button" onClick={rotateSelected}>
                                        Повернуть на 90°
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.removeAction}
                                        onClick={openManualRemovalConfirmation}
                                    >
                                        Убрать предмет
                                    </button>
                                </div>

                                <div
                                    className={`${styles.itemValidation} ${
                                        selectedIssues.length > 0
                                            ? styles.itemValidationError
                                            : styles.itemValidationValid
                                    }`}
                                    role="status"
                                >
                                    <strong>
                                        {selectedIssues.length > 0
                                            ? "Положение нужно поправить"
                                            : "Положение допустимо"}
                                    </strong>
                                    {selectedIssues.length > 0 ? (
                                        <ul>
                                            {selectedIssues.slice(0, 3).map((issue, index) => (
                                                <li key={`${issue.code}-${index}`}>
                                                    {issue.message}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p>Корпус и зона доступа не конфликтуют с окружением.</p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className={styles.inspectorEmpty}>
                                <span aria-hidden="true">↖</span>
                                <strong>Выберите предмет на плане</strong>
                                <p>
                                    Здесь появятся координаты, поворот и объяснение возможного
                                    конфликта.
                                </p>
                            </div>
                        )}

                        <div className={styles.ruleSummary}>
                            <h3>Что уже проверяется</h3>
                            <ul>
                                <li>корпус остаётся внутри комнаты;</li>
                                <li>между предметами есть зазор 50 мм;</li>
                                <li>
                                    проверяем связный проход от двери шириной 700 мм; расчётная
                                    модель использует допуск 50 мм;
                                </li>
                                <li>
                                    мебель с обязательным примыканием стоит нужной стороной к стене.
                                </li>
                            </ul>
                        </div>
                    </aside>
                </div>
            </main>
            <RemovalConfirmationDialog
                open={Boolean(manualRemovalTarget)}
                itemName={
                    manualRemovalTarget
                        ? getFurniture(manualRemovalTarget.definitionId).shortLabel
                        : "предмет"
                }
                fallbackFocusRef={undoButtonRef}
                onCancel={cancelManualRemoval}
                onConfirm={applyManualRemoval}
                backdropClassName={styles.removalDialogBackdrop}
                dialogClassName={styles.removalDialog}
            />
            <Footer />
        </div>
    );
};

export default Planner;
