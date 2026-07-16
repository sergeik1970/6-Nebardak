import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import {
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    DoorOpening,
    FURNITURE_CATALOG,
    FurnitureDefinition,
    FurnitureSelection,
    LayoutFailure,
    LayoutPreferences,
    LayoutResult,
    LayoutVariant,
    Placement,
    RadiatorObstacle,
    Room,
    Wall,
    WindowOpening,
    buildFurnitureInstances,
    getDoorObstacle,
    getFurniture,
    getFurnitureAsset,
    getMaximumFurnitureCount,
    getRadiatorBody,
    getRadiatorServiceObstacle,
    getRotatedGeometry,
    getWorldClearanceRects,
    QuestionnairePlannerInputV1,
    readQuestionnairePlannerHandoff,
    solveRoom,
    validateLayout,
} from "@/shared/lib/furniture-planner";
import type {
    SolverWorkerRequest,
    SolverWorkerResponse,
} from "@/shared/lib/furniture-planner/solver.worker";
import styles from "./index.module.scss";

type PlannerPhase = "ready" | "solving" | "result";
type Selection = Record<string, number>;
interface PlannerProps {
    /** undefined while the router hydrates, null for a direct planner visit. */
    handoffId?: string | null;
}

interface HandoffBaseline {
    selection: Selection;
    requiredDefinitionIds: string[];
    tvTargetCategory?: "sleep" | "living";
    itemCount: number;
    styleKey?: string;
    styleLabel?: string;
}

interface HandoffSourceState extends HandoffBaseline {
    modified: boolean;
}
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
const GRID_MM = 50;
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
const DEFAULT_PREFERENCES: LayoutPreferences = {};

const createRoom = (width: number, depth: number): Room => {
    const doorWidth = 900;
    const windowWidth = Math.min(1800, Math.max(1000, width - 1200));
    const doorOffset = Math.max(150, Math.min(500, width - doorWidth - 150));
    const windowOffset = Math.max(150, Math.round((width - windowWidth) / 100) * 50);

    return {
        width,
        depth,
        doors: [
            {
                id: "door-main",
                wall: "bottom",
                offset: doorOffset,
                width: doorWidth,
                clearanceDepth: 900,
                hinge: "start",
            },
        ],
        radiators: [],
        windows: [
            {
                id: "window-main",
                wall: "top",
                offset: windowOffset,
                width: windowWidth,
            },
        ],
    };
};

const DEFAULT_ROOM = createRoom(6000, 4600);
const PRESETS = [
    { label: "Компактная", width: 4200, depth: 3400 },
    { label: "Стандарт", width: 6000, depth: 4600 },
    { label: "Просторная", width: 7200, depth: 5200 },
];

const BED_IDS = ["single-bed", "double-bed"];
const SOFA_IDS = ["sofa-two", "sofa-three", "sofa-four-left"];
const WARDROBE_IDS = ["wardrobe-small", "wardrobe-medium", "wardrobe-large"];

const deriveRequiredDefinitionIds = (selection: Selection): Set<string> => {
    const required = new Set<string>();
    const hasBed = BED_IDS.some((id) => (selection[id] ?? 0) > 0);

    BED_IDS.forEach((id) => {
        if ((selection[id] ?? 0) > 0) required.add(id);
    });
    if ((selection.cradle ?? 0) > 0) required.add("cradle");
    if (!hasBed) {
        SOFA_IDS.forEach((id) => {
            if ((selection[id] ?? 0) > 0) required.add(id);
        });
    }

    return required;
};

const equalStringSets = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
    left.size === right.size && Array.from(left).every((value) => right.has(value));

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

const toFurnitureSelection = (
    selection: Selection,
    requiredDefinitionIds: ReadonlySet<string>,
): FurnitureSelection =>
    Object.fromEntries(
        Object.entries(selection).map(([definitionId, count]) => [
            definitionId,
            { count, required: requiredDefinitionIds.has(definitionId) },
        ]),
    );

const getSelectionLimit = (definitionId: string, selection: Selection): number => {
    const definitionLimit = getMaximumFurnitureCount(definitionId);

    if (!WARDROBE_IDS.includes(definitionId)) return definitionLimit;

    const otherWardrobes = WARDROBE_IDS.filter((id) => id !== definitionId).reduce(
        (sum, id) => sum + (selection[id] ?? 0),
        0,
    );

    return Math.max(0, Math.min(definitionLimit, 2 - otherWardrobes));
};

const DEFAULT_REQUIRED_ID_SET = deriveRequiredDefinitionIds(DEFAULT_SELECTION);
const initialInstances = buildFurnitureInstances(
    toFurnitureSelection(DEFAULT_SELECTION, DEFAULT_REQUIRED_ID_SET),
);
const initialResult = solveRoom(DEFAULT_ROOM, initialInstances, DEFAULT_PREFERENCES);

const snapToGrid = (value: number) => Math.round(value / GRID_MM) * GRID_MM;
const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);
const normalizeRotation = (value: number) => ((value % 360) + 360) % 360;

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
const wallLength = (room: Room, wall: Wall) =>
    wall === "top" || wall === "bottom" ? room.width : room.depth;
const clampWallItem = <T extends { wall: Wall; offset: number; width: number }>(
    item: T,
    room: Room,
    minimumWidth: number,
): T => {
    const length = wallLength(room, item.wall);
    const width = clamp(snapToGrid(item.width), minimumWidth, length);
    return {
        ...item,
        width,
        offset: clamp(snapToGrid(item.offset), 0, Math.max(0, length - width)),
    };
};

const resizeRoom = (room: Room, width: number, depth: number): Room => {
    const nextRoom: Room = {
        ...room,
        width: clamp(snapToGrid(width), MIN_ROOM_MM, MAX_ROOM_MM),
        depth: clamp(snapToGrid(depth), MIN_ROOM_MM, MAX_ROOM_MM),
    };

    return {
        ...nextRoom,
        doors: nextRoom.doors.map((door) => clampWallItem(door, nextRoom, 600)),
        windows: nextRoom.windows.map((window) => clampWallItem(window, nextRoom, 500)),
        radiators: (nextRoom.radiators ?? []).map((radiator) =>
            clampWallItem(radiator, nextRoom, 300),
        ),
    };
};

const millimetersFromMeters = (value: number) => snapToGrid(value * 1000);
const millimetersFromCentimeters = (value: number) => snapToGrid(value * 10);

const selectionSignature = (
    room: Room,
    selection: Selection,
    requiredDefinitionIds: ReadonlySet<string>,
    preferences: LayoutPreferences,
) =>
    JSON.stringify({
        room,
        selection: FURNITURE_CATALOG.map((definition) => [
            definition.id,
            selection[definition.id] ?? 0,
            requiredDefinitionIds.has(definition.id),
        ]),
        preferences,
    });

const baselineFromHandoff = (input: QuestionnairePlannerInputV1): HandoffBaseline => ({
    selection: Object.fromEntries(input.items.map((item) => [item.definitionId, item.count])),
    requiredDefinitionIds: input.items
        .filter((item) => item.required)
        .map((item) => item.definitionId),
    tvTargetCategory: input.preferences?.tvTargetCategory,
    itemCount: input.items.reduce((sum, item) => sum + item.count, 0),
    styleKey: input.meta?.styleKey,
    styleLabel: input.meta?.styleLabel,
});

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

const formatArea = (room: Room) => ((room.width * room.depth) / 1_000_000).toFixed(1);
const formatMeters = (millimeters: number) => `${(millimeters / 1000).toFixed(2)} м`;
const formatFurnitureCount = (count: number) => {
    const modulo100 = count % 100;
    const modulo10 = count % 10;
    if (modulo100 >= 11 && modulo100 <= 19) return `${count} предметов`;
    if (modulo10 === 1) return `${count} предмет`;
    if (modulo10 >= 2 && modulo10 <= 4) return `${count} предмета`;
    return `${count} предметов`;
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
        default:
            return `оценка ${Math.round(variant.score)}`;
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
    selectedInstanceId: string | null;
    invalidInstanceIds: Set<string>;
    showClearances: boolean;
    phase: PlannerPhase;
    failure: LayoutFailure | null;
    onSelect: (instanceId: string) => void;
    onPreviewPlacement: (placement: Placement | null) => void;
    onCommitPlacement: (instanceId: string, placement: Placement) => void;
    onNudgePlacement: (instanceId: string, deltaX: number, deltaY: number) => void;
    onRotatePlacement: (instanceId: string) => void;
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

const PlanCanvas: React.FC<PlanCanvasProps> = ({
    room,
    placements,
    selectedInstanceId,
    invalidInstanceIds,
    showClearances,
    phase,
    failure,
    onSelect,
    onPreviewPlacement,
    onCommitPlacement,
    onNudgePlacement,
    onRotatePlacement,
}) => {
    const gridLines = Array.from({ length: 9 }, (_, index) => index + 1);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const dragSessionRef = useRef<DragSession | null>(null);
    const suppressClickRef = useRef<string | null>(null);
    const [draggingInstanceId, setDraggingInstanceId] = useState<string | null>(null);
    const [loadedAssetKeys, setLoadedAssetKeys] = useState<Set<string>>(() => new Set());
    const [failedAssetKeys, setFailedAssetKeys] = useState<Set<string>>(() => new Set());

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

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || !dragSessionRef.current) return;
            event.preventDefault();
            cancelActiveDrag();
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [cancelActiveDrag]);

    const beginDrag = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>, placement: Placement) => {
            if (phase === "solving" || !event.isPrimary) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const roomElement = roomRef.current;
            if (!roomElement) return;

            const geometry = getRotatedGeometry(
                getFurniture(placement.definitionId),
                placement.rotation,
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
        [onSelect, phase, room],
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
        [cancelActiveDrag, onNudgePlacement, onRotatePlacement, onSelect],
    );

    return (
        <div className={styles.canvasViewport}>
            <div className={styles.dimensionTop} aria-hidden="true">
                <span>{formatMeters(room.width)}</span>
            </div>
            <div className={styles.dimensionSide} aria-hidden="true">
                <span>{formatMeters(room.depth)}</span>
            </div>
            <div
                ref={roomRef}
                className={styles.room}
                style={{ aspectRatio: `${Math.max(room.width, 1)} / ${Math.max(room.depth, 1)}` }}
                aria-label={`План комнаты ${room.width} на ${room.depth} миллиметров`}
            >
                <div className={styles.gridLayer} aria-hidden="true">
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

                {room.windows.map((window) => {
                    const horizontal = window.wall === "top" || window.wall === "bottom";
                    const windowStyle: React.CSSProperties = horizontal
                        ? {
                              left: `${(window.offset / room.width) * 100}%`,
                              width: `${(window.width / room.width) * 100}%`,
                              top: window.wall === "top" ? 0 : undefined,
                              bottom: window.wall === "bottom" ? 0 : undefined,
                          }
                        : {
                              top: `${(window.offset / room.depth) * 100}%`,
                              height: `${(window.width / room.depth) * 100}%`,
                              left: window.wall === "left" ? 0 : undefined,
                              right: window.wall === "right" ? 0 : undefined,
                          };

                    return (
                        <span
                            key={window.id}
                            className={`${styles.window} ${
                                horizontal ? styles.horizontalOpening : styles.verticalOpening
                            }`}
                            style={windowStyle}
                            aria-label="Окно"
                        />
                    );
                })}

                {room.doors.map((door) => {
                    const obstacle = getDoorObstacle(door, room);
                    const horizontal = door.wall === "top" || door.wall === "bottom";
                    const lineStyle: React.CSSProperties = horizontal
                        ? {
                              left: `${(door.offset / room.width) * 100}%`,
                              width: `${(door.width / room.width) * 100}%`,
                              top: door.wall === "top" ? 0 : undefined,
                              bottom: door.wall === "bottom" ? 0 : undefined,
                          }
                        : {
                              top: `${(door.offset / room.depth) * 100}%`,
                              height: `${(door.width / room.depth) * 100}%`,
                              left: door.wall === "left" ? 0 : undefined,
                              right: door.wall === "right" ? 0 : undefined,
                          };

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
                                data-hinge={door.hinge ?? "start"}
                                style={{
                                    left: `${(obstacle.x / room.width) * 100}%`,
                                    top: `${(obstacle.y / room.depth) * 100}%`,
                                    width: `${(obstacle.width / room.width) * 100}%`,
                                    height: `${(obstacle.depth / room.depth) * 100}%`,
                                }}
                                aria-hidden="true"
                            />
                            <span
                                className={`${styles.door} ${
                                    horizontal ? styles.horizontalOpening : styles.verticalOpening
                                }`}
                                style={lineStyle}
                                aria-label="Дверь"
                            />
                        </React.Fragment>
                    );
                })}

                {(room.radiators ?? []).map((radiator) => {
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
                            <span
                                className={styles.radiator}
                                style={{
                                    left: `${(body.x / room.width) * 100}%`,
                                    top: `${(body.y / room.depth) * 100}%`,
                                    width: `${(body.width / room.width) * 100}%`,
                                    height: `${(body.depth / room.depth) * 100}%`,
                                }}
                                aria-label={`Радиатор, ${WALL_LABELS[radiator.wall].toLowerCase()}`}
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
                            />
                        )),
                    )}

                {placements.map((placement) => {
                    const definition = getFurniture(placement.definitionId);
                    const geometry = getRotatedGeometry(definition, placement.rotation);
                    const baseGeometry = getRotatedGeometry(definition, 0);
                    const asset = getFurnitureAsset(definition.assetKey);
                    const selected = placement.instanceId === selectedInstanceId;
                    const invalid = invalidInstanceIds.has(placement.instanceId);
                    const dragging = placement.instanceId === draggingInstanceId;
                    const assetFailed = failedAssetKeys.has(definition.assetKey);
                    const assetLoaded = Boolean(
                        asset && loadedAssetKeys.has(definition.assetKey) && !assetFailed,
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
                                        assetLoaded &&
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
                            {asset &&
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
                                                    if (current.has(definition.assetKey))
                                                        return current;
                                                    return new Set(current).add(
                                                        definition.assetKey,
                                                    );
                                                })
                                            }
                                            onError={() =>
                                                setFailedAssetKeys((current) =>
                                                    new Set(current).add(definition.assetKey),
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

                {phase !== "solving" && placements.length === 0 && !failure && (
                    <div className={styles.canvasOverlay}>
                        <strong>Комната готова к работе</strong>
                        <span>Выберите мебель слева и нажмите «Расставить».</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const Planner: React.FC<PlannerProps> = ({ handoffId }) => {
    const [room, setRoom] = useState<Room>(DEFAULT_ROOM);
    const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);
    const [requiredDefinitionIds, setRequiredDefinitionIds] = useState<Set<string>>(() =>
        deriveRequiredDefinitionIds(DEFAULT_SELECTION),
    );
    const [tvTargetCategory, setTvTargetCategory] = useState<"sleep" | "living" | undefined>();
    const [placements, setPlacements] = useState<Placement[]>(
        initialResult.status === "success" ? initialResult.placements : [],
    );
    const [previewPlacement, setPreviewPlacement] = useState<Placement | null>(null);
    const [variants, setVariants] = useState<LayoutVariant[]>([]);
    const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
    const [editedVariantIds, setEditedVariantIds] = useState<Set<string>>(() => new Set());
    const [lastResult, setLastResult] = useState<LayoutResult>(initialResult);
    const [phase, setPhase] = useState<PlannerPhase>("result");
    const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
        initialResult.status === "success" ? initialResult.placements[0]?.instanceId ?? null : null,
    );
    const [showClearances, setShowClearances] = useState(false);
    const [generatedSignature, setGeneratedSignature] = useState<string | null>(
        selectionSignature(DEFAULT_ROOM, DEFAULT_SELECTION, DEFAULT_REQUIRED_ID_SET, {}),
    );
    const [resultNotice, setResultNotice] = useState("");
    const [handoffSource, setHandoffSource] = useState<HandoffSourceState | null>(null);
    const [handoffWarning, setHandoffWarning] = useState("");
    const activeSolverWorker = useRef<ActiveSolverWorker | null>(null);
    const solverRequestId = useRef(0);
    const handledHandoffId = useRef<string | null>(null);

    useEffect(() => {
        const derived = deriveRequiredDefinitionIds(selection);
        setRequiredDefinitionIds((current) =>
            equalStringSets(current, derived) ? current : derived,
        );
    }, [selection]);

    const instances = useMemo(
        () => buildFurnitureInstances(toFurnitureSelection(selection, requiredDefinitionIds)),
        [requiredDefinitionIds, selection],
    );
    const hasTv = (selection.tv ?? 0) > 0;
    const hasBed = BED_IDS.some((id) => (selection[id] ?? 0) > 0);
    const hasSofa = SOFA_IDS.some((id) => (selection[id] ?? 0) > 0);
    const tvTargetMissing = hasTv && !hasBed && !hasSofa;
    const tvTargetChoiceRequired = hasTv && hasBed && hasSofa && !tvTargetCategory;
    const tvGenerationBlocked = tvTargetMissing || tvTargetChoiceRequired;
    const effectivePreferences = useMemo<LayoutPreferences>(
        () => getLayoutPreferences(selection, tvTargetCategory),
        [selection, tvTargetCategory],
    );
    const currentSignature = useMemo(
        () => selectionSignature(room, selection, requiredDefinitionIds, effectivePreferences),
        [effectivePreferences, requiredDefinitionIds, room, selection],
    );
    const isStale = currentSignature !== generatedSignature;
    const displayedPlacements = useMemo(
        () =>
            previewPlacement
                ? placements.map((placement) =>
                      placement.instanceId === previewPlacement.instanceId
                          ? previewPlacement
                          : placement,
                  )
                : placements,
        [placements, previewPlacement],
    );
    const validation = useMemo(
        () => validateLayout(room, displayedPlacements, effectivePreferences),
        [displayedPlacements, effectivePreferences, room],
    );
    const invalidInstanceIds = useMemo(
        () => new Set(validation.issues.flatMap((issue) => issue.instanceIds)),
        [validation.issues],
    );
    const selectedPlacement = displayedPlacements.find(
        (placement) => placement.instanceId === selectedInstanceId,
    );
    const selectedDefinition = selectedPlacement
        ? getFurniture(selectedPlacement.definitionId)
        : null;
    const selectedAsset = selectedDefinition
        ? getFurnitureAsset(selectedDefinition.assetKey)
        : undefined;
    const selectedIssues = selectedInstanceId
        ? validation.issues.filter((issue) => issue.instanceIds.includes(selectedInstanceId))
        : [];
    const failure = lastResult.status === "failure" ? lastResult : null;
    const mainDoor = room.doors[0];
    const radiatorCount = room.radiators?.length ?? 0;

    const updateSelection = useCallback((definitionId: string, nextCount: number) => {
        setHandoffSource((current) => (current ? { ...current, modified: true } : current));
        setSelection((current) => {
            const nextSelection = { ...current };
            const limit = getSelectionLimit(definitionId, current);
            const count = Math.max(0, Math.min(limit, nextCount));

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
            return nextSelection;
        });
        setResultNotice("");
    }, []);

    const updateRoomDimension = useCallback((dimension: "width" | "depth", value: number) => {
        setRoom((current) =>
            resizeRoom(
                current,
                dimension === "width" ? value : current.width,
                dimension === "depth" ? value : current.depth,
            ),
        );
        setResultNotice("");
    }, []);

    const updateDoor = useCallback((patch: Partial<DoorOpening>) => {
        setRoom((current) => ({
            ...current,
            doors: current.doors.map((door, index) =>
                index === 0 ? clampWallItem({ ...door, ...patch }, current, 600) : door,
            ),
        }));
        setResultNotice("");
    }, []);

    const addWindow = useCallback(() => {
        setRoom((current) => {
            if (current.windows.length >= 2) return current;
            const candidate: WindowOpening = {
                id: `window-${Date.now()}`,
                wall: current.windows[0]?.wall === "top" ? "right" : "top",
                offset: 500,
                width: 1200,
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
            const candidate: RadiatorObstacle = {
                id: `radiator-${Date.now()}`,
                wall: radiators[0]?.wall === "bottom" ? "left" : "bottom",
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
            setRequiredDefinitionIds(new Set(baseline.requiredDefinitionIds));
            setTvTargetCategory(baseline.tvTargetCategory);
            setVariants([]);
            setActiveVariantId(null);
            setEditedVariantIds(new Set());
            setPlacements([]);
            setPreviewPlacement(null);
            setLastResult(initialResult);
            setGeneratedSignature(null);
            setSelectedInstanceId(null);
            setShowClearances(false);
            setResultNotice("");
            setPhase("ready");
            setHandoffSource({
                ...baseline,
                selection: { ...baseline.selection },
                modified: false,
            });
        },
        [cancelActiveSolver],
    );

    const restoreDemoState = useCallback(() => {
        cancelActiveSolver();
        setRoom(DEFAULT_ROOM);
        setSelection(DEFAULT_SELECTION);
        setRequiredDefinitionIds(deriveRequiredDefinitionIds(DEFAULT_SELECTION));
        setTvTargetCategory(undefined);
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setPlacements(initialResult.status === "success" ? initialResult.placements : []);
        setPreviewPlacement(null);
        setLastResult(initialResult);
        setGeneratedSignature(
            selectionSignature(
                DEFAULT_ROOM,
                DEFAULT_SELECTION,
                DEFAULT_REQUIRED_ID_SET,
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
        setPhase("result");
        setHandoffSource(null);
    }, [cancelActiveSolver]);

    useEffect(() => {
        if (handoffId === undefined) return;

        if (handoffId === null) {
            handledHandoffId.current = null;
            restoreDemoState();
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
                setVariants([]);
                setActiveVariantId(null);
                setEditedVariantIds(new Set());
                setLastResult(result);
                setPlacements(result.placements);
                setSelectedInstanceId(result.placements[0]?.instanceId ?? null);
                setGeneratedSignature(currentSignature);
                setPhase("result");
                return;
            }

            const firstVariant = result.variants[0];
            setVariants(result.variants);
            setActiveVariantId(firstVariant?.variantId ?? null);
            setEditedVariantIds(new Set());
            setLastResult(firstVariant ?? initialResult);
            setPlacements(firstVariant?.placements ?? []);
            setGeneratedSignature(currentSignature);
            setSelectedInstanceId(firstVariant?.placements[0]?.instanceId ?? null);
            setResultNotice(
                result.variants.length < 3
                    ? `Нашли ${result.variants.length} уникальных ${
                          result.variants.length === 1 ? "вариант" : "варианта"
                      } из 3 — одинаковые планы не дублируем.`
                    : "Три безопасных варианта готовы. Выберите подходящий над планом.",
            );
            setPhase("result");
        } catch (error) {
            if (error instanceof Error && error.message === SOLVER_CANCELLED) return;
            setResultNotice(SOLVER_ERROR_NOTICE);
            setPhase("result");
        }
    }, [
        currentSignature,
        effectivePreferences,
        instances,
        requestSolver,
        room,
        tvTargetChoiceRequired,
        tvTargetMissing,
    ]);

    const applyPreset = useCallback((width: number, depth: number) => {
        setRoom((current) => resizeRoom(current, width, depth));
        setResultNotice("");
    }, []);

    const resetPlanner = useCallback(() => {
        cancelActiveSolver();

        if (handoffSource) {
            setRoom(DEFAULT_ROOM);
            applyHandoffBaseline({
                selection: { ...handoffSource.selection },
                requiredDefinitionIds: [...handoffSource.requiredDefinitionIds],
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
        setRequiredDefinitionIds(deriveRequiredDefinitionIds(DEFAULT_SELECTION));
        setTvTargetCategory(undefined);
        setVariants([]);
        setActiveVariantId(null);
        setEditedVariantIds(new Set());
        setPlacements(result.placements);
        setPreviewPlacement(null);
        setLastResult(result);
        setGeneratedSignature(
            selectionSignature(
                DEFAULT_ROOM,
                DEFAULT_SELECTION,
                DEFAULT_REQUIRED_ID_SET,
                DEFAULT_PREFERENCES,
            ),
        );
        setSelectedInstanceId(result.placements[0]?.instanceId ?? null);
        setShowClearances(false);
        setResultNotice("");
        setPhase("result");
    }, [applyHandoffBaseline, cancelActiveSolver, handoffSource]);

    const removeAutomatically = useCallback(async () => {
        setPreviewPlacement(null);
        setPhase("solving");

        try {
            const response = await requestSolver({
                action: "solve-with-removal",
                room,
                instances,
                preferences: effectivePreferences,
            });
            if (!response.ok || response.action !== "solve-with-removal") return;

            const automatic = response.result;
            const nextSelection = { ...selection };

            automatic.removedInstances.forEach((instance) => {
                nextSelection[instance.definitionId] = Math.max(
                    0,
                    (nextSelection[instance.definitionId] ?? 0) - 1,
                );
            });

            setSelection(nextSelection);
            if (automatic.removedInstances.length > 0) {
                setHandoffSource((current) => (current ? { ...current, modified: true } : current));
            }
            setVariants([]);
            setActiveVariantId(null);
            setEditedVariantIds(new Set());
            setLastResult(automatic.result);
            setPlacements(automatic.result.placements);
            setGeneratedSignature(
                selectionSignature(
                    room,
                    nextSelection,
                    requiredDefinitionIds,
                    getLayoutPreferences(nextSelection, tvTargetCategory),
                ),
            );
            setSelectedInstanceId(automatic.result.placements[0]?.instanceId ?? null);
            setResultNotice(
                automatic.removedInstances.length > 0
                    ? `Убрано: ${automatic.removedInstances
                          .map((instance) => getFurniture(instance.definitionId).shortLabel)
                          .join(", ")}.`
                    : "Автоматически убрать предметы не удалось: все оставшиеся позиции обязательные.",
            );
            setPhase("result");
        } catch (error) {
            if (error instanceof Error && error.message === SOLVER_CANCELLED) return;
            setResultNotice(SOLVER_ERROR_NOTICE);
            setPhase("result");
        }
    }, [
        effectivePreferences,
        instances,
        requestSolver,
        requiredDefinitionIds,
        room,
        selection,
        tvTargetCategory,
    ]);

    const activateVariant = useCallback(
        (variantId: string) => {
            const variant = variants.find((candidate) => candidate.variantId === variantId);
            if (!variant) return;
            setActiveVariantId(variantId);
            setPreviewPlacement(null);
            setPlacements(variant.placements);
            setLastResult(variant);
            setSelectedInstanceId(variant.placements[0]?.instanceId ?? null);
        },
        [variants],
    );

    const updatePlacement = useCallback(
        (instanceId: string, updater: (placement: Placement) => Placement) => {
            setPreviewPlacement(null);
            setPlacements((current) =>
                current.map((placement) =>
                    placement.instanceId === instanceId ? updater(placement) : placement,
                ),
            );
            if (activeVariantId) {
                setEditedVariantIds((current) => new Set(current).add(activeVariantId));
                setVariants((current) =>
                    current.map((variant) =>
                        variant.variantId === activeVariantId
                            ? {
                                  ...variant,
                                  placements: variant.placements.map((placement) =>
                                      placement.instanceId === instanceId
                                          ? updater(placement)
                                          : placement,
                                  ),
                              }
                            : variant,
                    ),
                );
            }
            setResultNotice("");
        },
        [activeVariantId],
    );

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
            updatePlacement(instanceId, () => placement);
            const definition = getFurniture(placement.definitionId);
            setResultNotice(
                `${definition.shortLabel} перемещён: X ${placement.x} мм, Y ${placement.y} мм.`,
            );
        },
        [updatePlacement],
    );

    const removeSelected = useCallback(() => {
        if (!selectedPlacement) return;

        setHandoffSource((current) => (current ? { ...current, modified: true } : current));
        setPreviewPlacement(null);
        setPlacements((current) =>
            current.filter((placement) => placement.instanceId !== selectedPlacement.instanceId),
        );
        setVariants((current) =>
            current.map((variant) => ({
                ...variant,
                placements: variant.placements.filter(
                    (placement) => placement.instanceId !== selectedPlacement.instanceId,
                ),
            })),
        );
        setEditedVariantIds(new Set(variants.map((variant) => variant.variantId)));
        setSelection((current) => ({
            ...current,
            [selectedPlacement.definitionId]: Math.max(
                0,
                (current[selectedPlacement.definitionId] ?? 0) - 1,
            ),
        }));
        setSelectedInstanceId(null);
        setResultNotice(
            `${getFurniture(selectedPlacement.definitionId).shortLabel} убран из плана.`,
        );
    }, [selectedPlacement, variants]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
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
    }, [nudgeSelected, selectedInstanceId]);

    const planState =
        phase === "solving"
            ? { label: "Идёт расчёт", tone: "working" }
            : isStale
              ? { label: "Нужно перестроить", tone: "stale" }
              : failure
                ? { label: "Набор не помещается", tone: "invalid" }
                : validation.valid
                  ? { label: "Планировка допустима", tone: "valid" }
                  : { label: "Есть конфликт", tone: "invalid" };

    return (
        <div className={styles.page}>
            <Navigation />
            <main className={styles.main}>
                <header className={styles.plannerHeader}>
                    <div>
                        <span className={styles.eyebrow}>Планировщик · тестовый режим</span>
                        <h1>Соберите комнату без тесноты</h1>
                        <p>
                            Задайте размеры и мебель — мы проверим проходы и предложим аккуратную
                            расстановку.
                        </p>
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
                                    : `Набор получен из анкеты · ${formatFurnitureCount(
                                          instances.length,
                                      )}`}
                            </strong>
                            <p>
                                {handoffSource.styleLabel && (
                                    <>Стиль: {handoffSource.styleLabel}. </>
                                )}
                                Проверьте размеры комнаты и получите варианты расстановки.
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

                <div className={styles.workspace}>
                    <aside className={styles.setupPanel} aria-label="Настройка комнаты">
                        <div className={styles.panelHeading}>
                            <span>01</span>
                            <div>
                                <h2>Комната</h2>
                                <p>Размеры в метрах</p>
                            </div>
                        </div>

                        <div className={styles.dimensionFields}>
                            <label>
                                <span>Ширина</span>
                                <span className={styles.inputWithUnit}>
                                    <input
                                        type="number"
                                        min={2.4}
                                        max={10}
                                        step={0.05}
                                        value={room.width / 1000}
                                        onChange={(event) =>
                                            updateRoomDimension(
                                                "width",
                                                millimetersFromMeters(Number(event.target.value)),
                                            )
                                        }
                                        aria-describedby="room-range"
                                    />
                                    <span>м</span>
                                </span>
                            </label>
                            <label>
                                <span>Глубина</span>
                                <span className={styles.inputWithUnit}>
                                    <input
                                        type="number"
                                        min={2.4}
                                        max={10}
                                        step={0.05}
                                        value={room.depth / 1000}
                                        onChange={(event) =>
                                            updateRoomDimension(
                                                "depth",
                                                millimetersFromMeters(Number(event.target.value)),
                                            )
                                        }
                                        aria-describedby="room-range"
                                    />
                                    <span>м</span>
                                </span>
                            </label>
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
                                <em>{1 + room.windows.length + radiatorCount}</em>
                            </summary>

                            <div className={styles.openingsEditor}>
                                {mainDoor && (
                                    <section className={styles.openingBlock}>
                                        <header>
                                            <span>Дверь</span>
                                            <small>одна в комнате</small>
                                        </header>
                                        <div className={styles.openingGrid}>
                                            <label>
                                                <span>Стена</span>
                                                <select
                                                    value={mainDoor.wall}
                                                    onChange={(event) =>
                                                        updateDoor({
                                                            wall: event.target.value as Wall,
                                                        })
                                                    }
                                                >
                                                    {WALLS.map((wall) => (
                                                        <option key={wall} value={wall}>
                                                            {WALL_LABELS[wall]}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label>
                                                <span>Ширина</span>
                                                <span className={styles.compactInput}>
                                                    <input
                                                        type="number"
                                                        min={60}
                                                        max={wallLength(room, mainDoor.wall) / 10}
                                                        step={5}
                                                        value={mainDoor.width / 10}
                                                        onChange={(event) =>
                                                            updateDoor({
                                                                width: millimetersFromCentimeters(
                                                                    Number(event.target.value),
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
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={
                                                            (wallLength(room, mainDoor.wall) -
                                                                mainDoor.width) /
                                                            10
                                                        }
                                                        step={5}
                                                        value={mainDoor.offset / 10}
                                                        onChange={(event) =>
                                                            updateDoor({
                                                                offset: millimetersFromCentimeters(
                                                                    Number(event.target.value),
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
                                                    value={mainDoor.hinge ?? "start"}
                                                    onChange={(event) =>
                                                        updateDoor({
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
                                        </div>
                                    </section>
                                )}

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
                                                <strong>Окно {index + 1}</strong>
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
                                                    <span>Стена</span>
                                                    <select
                                                        value={window.wall}
                                                        onChange={(event) =>
                                                            updateWindow(window.id, {
                                                                wall: event.target.value as Wall,
                                                            })
                                                        }
                                                    >
                                                        {WALLS.map((wall) => (
                                                            <option key={wall} value={wall}>
                                                                {WALL_LABELS[wall]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Ширина</span>
                                                    <span className={styles.compactInput}>
                                                        <input
                                                            type="number"
                                                            min={50}
                                                            max={wallLength(room, window.wall) / 10}
                                                            step={5}
                                                            value={window.width / 10}
                                                            onChange={(event) =>
                                                                updateWindow(window.id, {
                                                                    width: millimetersFromCentimeters(
                                                                        Number(event.target.value),
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
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={
                                                                (wallLength(room, window.wall) -
                                                                    window.width) /
                                                                10
                                                            }
                                                            step={5}
                                                            value={window.offset / 10}
                                                            onChange={(event) =>
                                                                updateWindow(window.id, {
                                                                    offset: millimetersFromCentimeters(
                                                                        Number(event.target.value),
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                            </div>
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
                                                    <span>Стена</span>
                                                    <select
                                                        value={radiator.wall}
                                                        onChange={(event) =>
                                                            updateRadiator(radiator.id, {
                                                                wall: event.target.value as Wall,
                                                            })
                                                        }
                                                    >
                                                        {WALLS.map((wall) => (
                                                            <option key={wall} value={wall}>
                                                                {WALL_LABELS[wall]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span>Ширина</span>
                                                    <span className={styles.compactInput}>
                                                        <input
                                                            type="number"
                                                            min={30}
                                                            max={
                                                                wallLength(room, radiator.wall) / 10
                                                            }
                                                            step={5}
                                                            value={radiator.width / 10}
                                                            onChange={(event) =>
                                                                updateRadiator(radiator.id, {
                                                                    width: millimetersFromCentimeters(
                                                                        Number(event.target.value),
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
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={
                                                                (wallLength(room, radiator.wall) -
                                                                    radiator.width) /
                                                                10
                                                            }
                                                            step={5}
                                                            value={radiator.offset / 10}
                                                            onChange={(event) =>
                                                                updateRadiator(radiator.id, {
                                                                    offset: millimetersFromCentimeters(
                                                                        Number(event.target.value),
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
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={200}
                                                            step={5}
                                                            value={radiator.clearanceDepth / 10}
                                                            onChange={(event) =>
                                                                updateRadiator(radiator.id, {
                                                                    clearanceDepth:
                                                                        millimetersFromCentimeters(
                                                                            Number(
                                                                                event.target.value,
                                                                            ),
                                                                        ),
                                                                })
                                                            }
                                                        />
                                                        <i>см</i>
                                                    </span>
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                </section>
                            </div>
                        </details>

                        <div className={styles.sectionDivider} />

                        <div className={styles.panelHeading}>
                            <span>02</span>
                            <div>
                                <h2>Мебель</h2>
                                <p>{formatFurnitureCount(instances.length)} в наборе</p>
                            </div>
                        </div>

                        <div className={styles.catalog}>
                            {CATEGORY_ORDER.map((category) => {
                                const definitions = FURNITURE_CATALOG.filter(
                                    (definition) => definition.category === category,
                                );

                                return (
                                    <fieldset key={category} className={styles.catalogGroup}>
                                        <legend>{CATEGORY_LABELS[category]}</legend>
                                        {definitions.map((definition) => {
                                            const count = selection[definition.id] ?? 0;
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
                                                    <label htmlFor={checkboxId}>
                                                        <strong>{definition.shortLabel}</strong>
                                                        <small>
                                                            {getDefinitionDimensions(definition)} мм
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
                                                </div>
                                            );
                                        })}
                                    </fieldset>
                                );
                            })}
                        </div>

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
                                        Добавьте диван или кровать — без точки просмотра безопасный
                                        план не построить.
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
                            <strong>Сейчас: прямоугольная комната</strong>
                            <span>Г-образные и нарисованные вручную комнаты — следующий этап.</span>
                        </div>
                    </aside>

                    <section className={styles.planSection} aria-labelledby="plan-heading">
                        <div className={styles.planToolbar}>
                            <div>
                                <span className={styles.toolbarStep}>03</span>
                                <div>
                                    <h2 id="plan-heading">План комнаты</h2>
                                    <p>
                                        {room.windows.length} окн. · {room.doors.length} дв. ·{" "}
                                        {radiatorCount} рад.
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
                                    className={styles.resetAction}
                                    onClick={resetPlanner}
                                >
                                    Сбросить
                                </button>
                            </div>
                        </div>

                        {variants.length > 0 && (
                            <div
                                className={styles.variantBar}
                                data-stale={isStale ? "true" : "false"}
                            >
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
                                {isStale && <span>Параметры изменены — перестройте варианты</span>}
                            </div>
                        )}

                        <div className={styles.draftingBoard}>
                            <PlanCanvas
                                room={room}
                                placements={displayedPlacements}
                                selectedInstanceId={selectedInstanceId}
                                invalidInstanceIds={invalidInstanceIds}
                                showClearances={showClearances}
                                phase={phase}
                                failure={failure}
                                onSelect={setSelectedInstanceId}
                                onPreviewPlacement={setPreviewPlacement}
                                onCommitPlacement={commitDraggedPlacement}
                                onNudgePlacement={nudgePlacement}
                                onRotatePlacement={rotatePlacement}
                            />
                            <div className={styles.canvasLegend}>
                                <span>
                                    <i className={styles.windowLegend} /> окно
                                </span>
                                <span>
                                    <i className={styles.doorLegend} /> дверь и открывание
                                </span>
                                {radiatorCount > 0 && (
                                    <span>
                                        <i className={styles.radiatorLegend} /> радиатор
                                    </span>
                                )}
                                {showClearances && (
                                    <span>
                                        <i className={styles.zoneLegend} /> служебная зона
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className={styles.primaryActionRow}>
                            <button
                                type="button"
                                className={styles.primaryAction}
                                onClick={runSolver}
                                disabled={phase === "solving" || tvGenerationBlocked}
                            >
                                {phase === "solving" ? "Собираем…" : "Получить 3 варианта"}
                            </button>
                            <p>
                                {tvTargetChoiceRequired
                                    ? "Сначала выберите цель телевизора в списке мебели."
                                    : tvTargetMissing
                                      ? "Для телевизора нужна кровать или диван."
                                      : "Уникальные безопасные планы — без повторов и случайности."}
                            </p>
                        </div>

                        {failure && phase !== "solving" && (
                            <div className={styles.failureResult} role="alert">
                                <span className={styles.resultMark}>!</span>
                                <div>
                                    <strong>
                                        {failure.reason === "invalid-room"
                                            ? "Проверьте комнату и проёмы"
                                            : "Весь набор не помещается"}
                                    </strong>
                                    <p>{failure.message}</p>
                                    {failure.reason !== "invalid-room" &&
                                        failure.blockingInstanceIds.length > 0 && (
                                            <p className={styles.blockers}>
                                                Проверьте:{" "}
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
                                                .
                                            </p>
                                        )}
                                </div>
                                {failure.reason !== "invalid-room" && (
                                    <button type="button" onClick={removeAutomatically}>
                                        Убрать автоматически
                                    </button>
                                )}
                            </div>
                        )}

                        {resultNotice && (
                            <div className={styles.resultNotice} role="status">
                                {resultNotice}
                            </div>
                        )}
                    </section>

                    <aside className={styles.inspector} aria-label="Проверка и настройка предмета">
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
                                        {selectedAsset && (
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
                                        )}
                                    </span>
                                    <div>
                                        <strong>{selectedDefinition.label}</strong>
                                        <small>
                                            {getDefinitionDimensions(selectedDefinition)} мм
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
                                        onClick={removeSelected}
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
                                    Здесь появятся координаты, поворот и точное объяснение
                                    возможного конфликта.
                                </p>
                            </div>
                        )}

                        <div className={styles.ruleSummary}>
                            <h3>Что уже проверяется</h3>
                            <ul>
                                <li>корпус остаётся внутри комнаты;</li>
                                <li>между предметами есть зазор 50 мм;</li>
                                <li>проходы и открывание двери свободны;</li>
                                <li>
                                    мебель с обязательным примыканием стоит нужной стороной к стене.
                                </li>
                            </ul>
                        </div>
                    </aside>
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Planner;
