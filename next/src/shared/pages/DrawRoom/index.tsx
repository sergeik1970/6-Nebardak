import {
    DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY,
    getProjectStorage,
    withProjectParam,
} from "@/shared/lib/project-scope/storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
    addDrawWallSegment,
    deriveDrawWallGraphRoom,
    getDrawWallComponents,
    getRoomBoundarySegments,
    getDrawRoomRegions,
    getRoomPartitionSegments,
    getRoomSegment,
    isHingedDoor,
    materializeRoomRegionsState,
    isGeneratedRoomName,
    roomKindLabel,
    toRoomRegionMetadata,
    ROOM_KINDS,
    pointInsideRoom,
    DRAW_ROOM_GRID_ORIGIN_MM,
    DRAW_ROOM_GRID_SNAP_MM,
    DRAW_ROOM_CONSTRUCTION_WALL_THICKNESS_MM,
    DRAW_ROOM_CONSTRUCTION_SNAP_MM,
    DRAW_ROOM_WALL_LANE_MM,
    getDoorMaterialCollisionError,
    getDoorFurnitureObstacles,
    getRadiatorBody,
    getRadiatorServiceObstacle,
    buildDrawingPlanSpecification,
    getPlanExportFilename,
    renderPlanSpecificationPng,
    getDrawRoomGridPresentation,
    getDrawRoomWallFaceContours,
    ensureUniqueDrawWallSegmentIds,
    snapDrawRoomCoordinate,
    snapDrawRoomWallLaneCentre,
    validateLayout,
    validateRoomGeometry,
    resolveDrawWallAnchor,
    moveDrawWallContourSegment,
    moveDrawWallRun,
    getDrawWallRun,
    resizeDrawWallRun,
    findMovedDrawWallContourEdge,
    getRoomVertices,
    getRotatedGeometry,
    readDrawRoomDraft,
    readProjectDraft,
    type DrawWallSegment,
    type DoorKind,
    type DoorOpening,
    type DrawRoomGridPresentationLevel,
    type DrawRoomRegion,
    type Placement,
    type RadiatorObstacle,
    type Room,
    type RoomBoundarySegment,
    type RoomKind,
    type WindowOpening,
} from "@/shared/lib/furniture-planner";
import styles from "./index.module.scss";
import FurnitureEditor from "./FurnitureEditor";
import MeasureTool from "./MeasureTool";
import {
    furnitureBelongsToRoom,
    furnitureDefinition,
    furnitureError,
    furnitureGeometry,
    readFurniture,
    type DrawFurniture,
    type FurnitureRoom,
} from "./furniture";
import ResultPanel, { type ResultItem, type ResultRoom } from "./ResultPanel";
import AutoLayoutPanel, { type AutoLayoutVariantSummary } from "./AutoLayoutPanel";
import {
    WORKING_CORE_OBSERVATION_ID,
    createPlannerObservationRequests,
    type PlannerObservationTarget,
} from "./planner-observation";
import {
    plannerObservationService,
    type PlannerObservationCreateInput,
    type PlannerObservationVerdict,
} from "@/services/plannerObservationService";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthEnabled } from "@/shared/config/runtime";
import {
    buildRegionSolverRoom,
    buildRoomInstances,
    roomFurnitureSet,
    solvedToDrawFurniture,
} from "./auto-layout";
import type {
    SolverWorkerRequest,
    SolverWorkerResponse,
} from "@/shared/lib/furniture-planner/solver.worker";
import Dialog from "@/shared/components/Dialog";
import { RECT_TEMPLATE_LIMITS, createRectTemplateRoom, roomToDrawingScene } from "./room-template";

import ProjectTools, { DEFAULT_DRAWING_LAYERS } from "./ProjectTools";
import { trackGoal } from "@/shared/lib/analytics";
import {
    CEILING_HEIGHT_MM,
    getDoorHeight,
    getWindowHeight,
    getWindowSillHeight,
} from "@/shared/lib/furniture-planner/opening-heights";
import { OpeningHeightFields } from "./OpeningHeightFields";

type Tool = "select" | "wall" | "door" | "window" | "radiator";
type ToolGroup = "walls" | "openings" | "rooms" | "furniture" | "result";

/** The drawing is worked through in these steps, each its own layer of the plan. */
const DRAW_STEPS: { group: ToolGroup; label: string; controls?: string }[] = [
    { group: "walls", label: "Стены", controls: "draw-room-walls-tools" },
    { group: "openings", label: "Двери и окна", controls: "draw-room-opening-tools" },
    { group: "rooms", label: "Помещения" },
    { group: "furniture", label: "Мебель" },
    { group: "result", label: "Итог" },
];
type KeyboardTool = Exclude<Tool, "select" | "radiator">;
type Point = { x: number; y: number };

interface Scene {
    furniture?: DrawFurniture[];
    segments: DrawWallSegment[];
    doors: DoorOpening[];
    windows: WindowOpening[];
    /** Heating under a window or along a wall; missing in older drafts. */
    radiators?: RadiatorObstacle[];
    /** Missing scenes are pre-constructive 50 mm drafts. */
    wallThickness?: Room["wallThickness"];
    regions?: Room["regions"];
}

interface History {
    past: Scene[];
    present: Scene;
    future: Scene[];
}

interface RoomPreview {
    wallIds?: string[];
    room: Room;
    origin: Point;
    /** Canonical wall centre contour used by paired face geometry. */
    contour: Point[];
}

interface CanvasViewBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface PendingWheelZoom {
    clientX: number;
    clientY: number;
    deltaY: number;
}

type OpeningKind = "door" | "window";
type SelectedOpening = { kind: OpeningKind; id: string };
type OpeningPreview = {
    origin: Point;
    kind: OpeningKind;
    doorKind?: DoorKind;
    swingDirection?: DoorOpening["swingDirection"];
    slidingMount?: DoorOpening["slidingMount"];
    slidingDirection?: DoorOpening["slidingDirection"];
    segment: RoomBoundarySegment;
    offset: number;
    width: number;
    valid: boolean;
    message?: string;
};
type RenderedOpening =
    | {
          kind: "door";
          item: DoorOpening;
          segment: RoomBoundarySegment;
          origin: Point;
          preview?: boolean;
          previewValid?: boolean;
      }
    | {
          kind: "window";
          item: WindowOpening;
          segment: RoomBoundarySegment;
          origin: Point;
          preview?: boolean;
          previewValid?: boolean;
      };

type WallAnchorAttachment = "free" | "endpoint" | "side";
type ContourWallGrab = "middle" | "start" | "end";

interface WallAnchorFeedback {
    point: Point;
    attachment: WallAnchorAttachment;
}

interface ContourWallDrag {
    kind: "contour";
    selectedEdgeIndex: number;
    movingEdgeIndex: number;
    grab: ContourWallGrab;
    startScene: Scene;
    startPreview: RoomPreview;
    changed: boolean;
}

interface SegmentWallDrag {
    kind: "segment";
    segmentId: string;
    grab: ContourWallGrab;
    startScene: Scene;
    startPreview: RoomPreview | null;
    changed: boolean;
}

type WallDrag = ContourWallDrag | SegmentWallDrag;

// These dimensions establish the initial camera scale only. The drawing field
// itself is intentionally edge-free: every visible grid point must accept a
// wall. Keeping a finite artboard here while clamping pointer coordinates made
// responsive SVG gutters look usable even though they were silently folded
// onto the nearest 16 × 10 m edge.
const BOARD_WIDTH_MM = 16_000;
const BOARD_HEIGHT_MM = 10_000;
const LEGACY_SNAP_MM = DRAW_ROOM_GRID_SNAP_MM;
const MAX_HISTORY = 40;
const DOOR_WIDTH_MM = 900;
const WINDOW_WIDTH_MM = 1200;
const WINDOW_MIN_WIDTH_MM = 400;
const WINDOW_MAX_WIDTH_MM = 2400;
const OPENING_END_CLEARANCE_MM = LEGACY_SNAP_MM;
const ROOM_CEILING_HEIGHT_MM = CEILING_HEIGHT_MM;
// Room metadata is part of the drawing, so it uses fixed world-space metrics
// and grows/shrinks together with the walls rather than remaining screen-size.
const ROOM_LABEL_MIN_FONT_MM = 72;
const ROOM_LABEL_MAX_FONT_MM = 180;
// H/S is secondary to the dimension chains: when zoomed in it must never
// outgrow the 15 px dimension text and swallow a small room.
const ROOM_LABEL_MAX_SCREEN_FONT_PX = 15;
// Committed chains are useful while reading a plan, but become visual noise
// once their fixed screen-size labels compete for the same few pixels.
// Annotation text stops growing in world units when zooming out.
const MAX_ANNOTATION_MM_PER_PIXEL = 30;
const DIMENSION_FONT_PX = 15;
// Once the whole drawing is this small on screen its chains and H/S card are
// an unreadable tangle, so the contour is shown bare until the user zooms in
// or fits it; the status bar keeps the overall size and area. On a narrow
// phone or tablet canvas the drawing only has to fill 40% of its width.
const MIN_ANNOTATED_DRAWING_PX = 200;
// Text that shrinks below this (a phone's initial whole-board view) is noise.
const MIN_READABLE_ANNOTATION_PX = 9;
const WALL_THICKNESS_MM = DRAW_ROOM_CONSTRUCTION_WALL_THICKNESS_MM;
// Live dimension lanes stay constant on screen. This gives the temporary
// drawing overlay the same calm drafting rhythm at every zoom level.
const LIVE_DIMENSION_OFFSET_PX = 28;
const LIVE_ATTACHED_DIMENSION_OFFSET_PX = 44;
// A temporary annotation must remain visually attached to the material it
// measures. This is a hard local layout budget, not a hint for an unbounded
// collision walk.
const LIVE_DIMENSION_MAX_TRACK_DISTANCE_PX = 86;
const LIVE_DIMENSION_TRACK_STEP_PX = 14;
const LIVE_DIMENSION_VIEWPORT_INSET_PX = 8;
// The magnet is deliberately a screen-space affordance.  It stays equally
// easy to catch when the user zooms in or out instead of growing/shrinking in
// apparent pixels with the drawing world.
const WALL_MAGNET_TOLERANCE_PX = 18;
const MAX_ZOOM = 5;
const MIN_ZOOM = 0.25;
const WHEEL_ZOOM_SENSITIVITY = 0.0022;
const BOARD_ASPECT = BOARD_WIDTH_MM / BOARD_HEIGHT_MM;

/** A solver request without the id the worker channel adds. */
type SolverPayload = SolverWorkerRequest extends infer Request
    ? Request extends SolverWorkerRequest
        ? Omit<Request, "requestId">
        : never
    : never;

const RADIATOR_DEFAULT_WIDTH_MM = 800;
const RADIATOR_DEPTH_MM = 100;
/** Free air in front of a radiator; furniture must not stand in it. */
const RADIATOR_CLEARANCE_MM = 300;

const EMPTY_SCENE: Scene = {
    segments: [],
    doors: [],
    windows: [],
    wallThickness: WALL_THICKNESS_MM,
};
// Up to this width a tool group opens as a sheet over the canvas (a tablet
// flyout or a phone bottom sheet) rather than inside the desktop rail.
const TOOL_SHEET_MEDIA_QUERY = "(max-width: 900px)";
/** How long a closing contour keeps reframing while the cards around the canvas resize it. */
const AUTO_FIT_SETTLE_MS = 400;
const getSceneWallThickness = (scene: Pick<Scene, "wallThickness">) =>
    scene.wallThickness ?? DRAW_ROOM_WALL_LANE_MM;
const getSceneSnapMm = (scene: Pick<Scene, "wallThickness">) =>
    getSceneWallThickness(scene) === WALL_THICKNESS_MM
        ? DRAW_ROOM_CONSTRUCTION_SNAP_MM
        : DRAW_ROOM_GRID_SNAP_MM;
/**
 * Graph nodes sit on the wall centre line, but the user aims at the drawn
 * material. Measuring the magnet from the face rather than the axis keeps a
 * click on the hatch or its inner corner attached to the existing node.
 */
const getWallMagnetRadius = (
    scene: Pick<Scene, "wallThickness">,
    snapMm: number,
    millimetersPerPixel: number,
) =>
    getSceneWallThickness(scene) / 2 +
    Math.max(snapMm / 2, millimetersPerPixel * WALL_MAGNET_TOLERANCE_PX);

const DOOR_CATALOG: Array<{
    kind: DoorKind;
    label: string;
    description: string;
    defaultWidth: number;
    minimum: number;
    maximum: number;
}> = [
    {
        kind: "room",
        label: "Распашная",
        description: "Одна створка",
        defaultWidth: 900,
        minimum: 700,
        maximum: 1200,
    },
    {
        kind: "balcony",
        label: "Балконная",
        description: "Распашная дверь наружу",
        defaultWidth: 900,
        minimum: 700,
        maximum: 1200,
    },
    {
        kind: "swing-double",
        label: "Двустворчатая",
        description: "Две распашные створки",
        defaultWidth: 1600,
        minimum: 1200,
        maximum: 2400,
    },
    {
        kind: "sliding-single",
        label: "Раздвижная",
        description: "Одно полотно по направляющей",
        defaultWidth: 900,
        minimum: 700,
        maximum: 1400,
    },
    {
        kind: "sliding-double",
        label: "Двухстворчатая раздвижная",
        description: "Два полотна к центру",
        defaultWidth: 1600,
        minimum: 1200,
        maximum: 2800,
    },
];
const DEFAULT_VIEW_BOX: CanvasViewBox = {
    x: 0,
    y: 0,
    width: BOARD_WIDTH_MM,
    height: BOARD_HEIGHT_MM,
};

const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);
const roundSubpixel = (value: number) => Math.round(value * 100) / 100;
const cloneScene = (scene: Scene): Scene => ({
    furniture: (scene.furniture ?? []).map((item) => ({ ...item })),
    segments: scene.segments.map((segment) => ({
        ...segment,
        start: { ...segment.start },
        end: { ...segment.end },
    })),
    doors: scene.doors.map((door) => ({ ...door })),
    windows: scene.windows.map((window) => ({ ...window })),
    ...(scene.radiators?.length
        ? { radiators: scene.radiators.map((radiator) => ({ ...radiator })) }
        : {}),
    ...(scene.wallThickness ? { wallThickness: scene.wallThickness } : {}),
    ...(scene.regions
        ? {
              regions: {
                  version: 1,
                  items: scene.regions.items.map((item) => ({ ...item })),
              },
          }
        : {}),
});

const isDraftPoint = (value: unknown): value is Point =>
    Boolean(
        value &&
            typeof value === "object" &&
            Number.isFinite((value as Point).x) &&
            Number.isFinite((value as Point).y),
    );

const isDraftRadiator = (value: unknown): value is RadiatorObstacle => {
    const item = value as RadiatorObstacle | null;
    return Boolean(
        item &&
            typeof item.id === "string" &&
            typeof item.wall === "string" &&
            [item.offset, item.width, item.depth, item.clearanceDepth].every(Number.isFinite),
    );
};

/** The editor cache is deliberately separate from the Planner handoff draft. */
const readEditorSession = (): Scene | null => {
    if (typeof window === "undefined") return null;
    try {
        const parsed = JSON.parse(
            getProjectStorage()?.getItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY) ?? "null",
        ) as Partial<Scene> | null;
        if (
            !parsed ||
            !Array.isArray(parsed.segments) ||
            !Array.isArray(parsed.doors) ||
            !Array.isArray(parsed.windows) ||
            !parsed.segments.every(
                (segment) =>
                    segment &&
                    typeof segment.id === "string" &&
                    isDraftPoint(segment.start) &&
                    isDraftPoint(segment.end),
            )
        ) {
            return null;
        }
        return bindLegacyOpenings(
            cloneScene({
                segments: ensureUniqueDrawWallSegmentIds(parsed.segments as DrawWallSegment[]),
                doors: parsed.doors as DoorOpening[],
                windows: parsed.windows as WindowOpening[],
                ...(Array.isArray(parsed.radiators)
                    ? { radiators: parsed.radiators.filter(isDraftRadiator) }
                    : {}),
                furniture: readFurniture(parsed.furniture),
                ...(parsed.wallThickness === 50 || parsed.wallThickness === 100
                    ? { wallThickness: parsed.wallThickness }
                    : {}),
                ...(parsed.regions ? { regions: parsed.regions } : {}),
            }),
        );
    } catch {
        return null;
    }
};
const decimalFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const smallAreaFormatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
const largeAreaFormatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
});
const formatMeters = (millimeters: number) => `${decimalFormatter.format(millimeters / 1000)} м`;
/** Architectural drawing labels are deliberately compact: centimetres, no duplicate unit. */
const formatWallLength = (millimeters: number) => `${Math.round(millimeters / 10)}`;
const formatWallLengthWithUnit = (millimeters: number) => `${Math.round(millimeters / 10)} см`;
const formatWallThickness = (millimeters: number) =>
    millimeters % 10 === 0 ? `${millimeters / 10} см` : `${millimeters} мм`;
const getWallCursorCellOrigin = (point: Point, thickness: number): Point => ({
    x: point.x - thickness / 2,
    y: point.y - thickness / 2,
});

const getFitViewBox = (canvasSize: { width: number; height: number }): CanvasViewBox => {
    if (!canvasSize.width || !canvasSize.height) return DEFAULT_VIEW_BOX;
    const canvasAspect = canvasSize.width / canvasSize.height;

    if (canvasAspect >= BOARD_ASPECT) {
        const height = BOARD_HEIGHT_MM;
        const width = height * canvasAspect;
        return {
            x: (BOARD_WIDTH_MM - width) / 2,
            y: 0,
            width,
            height,
        };
    }

    const width = BOARD_WIDTH_MM;
    const height = width / canvasAspect;
    return {
        x: 0,
        y: (BOARD_HEIGHT_MM - height) / 2,
        width,
        height,
    };
};

/** Fits the completed constructive contour rather than leaving a small room lost on the full sheet. */
const getContourFitViewBox = (
    contour: Point[],
    thickness: number,
    canvasSize: { width: number; height: number },
    leftInsetPx = 0,
): CanvasViewBox | null => {
    const faces = getDrawRoomWallFaceContours(contour, thickness);
    if (!faces) return null;
    return getBoundsFitViewBox(
        getContourBounds(faces.outerFaceContour),
        thickness,
        canvasSize,
        leftInsetPx,
    );
};

/** An open draft has no contour yet, so it is framed by its wall material. */
const getSegmentsFitViewBox = (
    segments: DrawWallSegment[],
    thickness: number,
    canvasSize: { width: number; height: number },
    leftInsetPx = 0,
): CanvasViewBox | null => {
    const points = segments.flatMap((segment) => [segment.start, segment.end]);
    if (!points.length) return null;
    const bounds = getContourBounds(points);
    const half = thickness / 2;
    return getBoundsFitViewBox(
        {
            left: bounds.left - half,
            right: bounds.right + half,
            top: bounds.top - half,
            bottom: bounds.bottom + half,
        },
        thickness,
        canvasSize,
        leftInsetPx,
    );
};

/**
 * Frames the drawing with comfortable padding. A side tool rail or panel
 * (`leftInsetPx`) floats over the canvas's left edge: if the framed drawing
 * would sit under it, the camera first pans without changing scale and only
 * zooms out when panning alone cannot keep the whole drawing clear.
 */
const getBoundsFitViewBox = (
    bounds: ScreenRect,
    thickness: number,
    canvasSize: { width: number; height: number },
    leftInsetPx = 0,
): CanvasViewBox | null => {
    if (!canvasSize.width || !canvasSize.height) return null;
    const sourceWidth = bounds.right - bounds.left;
    const sourceHeight = bounds.bottom - bounds.top;
    if (!sourceWidth || !sourceHeight) return null;
    const padding = Math.max(thickness * 8, Math.min(sourceWidth, sourceHeight) * 0.5);
    const frame = (usableWidth: number) => {
        let width = sourceWidth + padding * 2;
        let height = sourceHeight + padding * 2;
        const aspect = usableWidth / canvasSize.height;
        if (width / height < aspect) width = height * aspect;
        else height = width / aspect;
        return { width, height, millimetersPerPixel: width / usableWidth };
    };

    const full = frame(canvasSize.width);
    const centred = {
        x: (bounds.left + bounds.right - full.width) / 2,
        y: (bounds.top + bounds.bottom - full.height) / 2,
        width: full.width,
        height: full.height,
    };
    const overlayRight = centred.x + leftInsetPx * full.millimetersPerPixel;
    const gap = 16 * full.millimetersPerPixel;
    if (bounds.left - gap >= overlayRight) return centred;
    const pannedX = bounds.left - gap - leftInsetPx * full.millimetersPerPixel;
    if (bounds.right + gap <= pannedX + full.width) return { ...centred, x: pannedX };

    const usableWidth = canvasSize.width - leftInsetPx;
    if (usableWidth <= 0) return centred;
    const inset = frame(usableWidth);
    const covered = leftInsetPx * inset.millimetersPerPixel;
    return {
        x: (bounds.left + bounds.right - inset.width) / 2 - covered,
        y: (bounds.top + bounds.bottom - inset.height) / 2,
        width: inset.width + covered,
        height: inset.height,
    };
};

const getRenderedViewBounds = (bounds: DOMRect, view: CanvasViewBox) => {
    const pixelsPerMillimeter = Math.min(bounds.width / view.width, bounds.height / view.height);
    const width = view.width * pixelsPerMillimeter;
    const height = view.height * pixelsPerMillimeter;
    return {
        left: bounds.left + (bounds.width - width) / 2,
        top: bounds.top + (bounds.height - height) / 2,
        width,
        height,
    };
};

const clampViewBox = (raw: CanvasViewBox, fit: CanvasViewBox): CanvasViewBox => {
    const width = roundSubpixel(clamp(raw.width, fit.width / MAX_ZOOM, fit.width / MIN_ZOOM));
    const height = roundSubpixel(width / (fit.width / fit.height));

    return {
        // Zoom is deliberately bounded, but the CAD plane is not. This also
        // keeps a contour drawn in a responsive viewport gutter reachable
        // after zooming or using "Вместить".
        x: roundSubpixel(raw.x),
        y: roundSubpixel(raw.y),
        width,
        height,
    };
};

const drawIcon = (name: Tool | "clear" | "reset" | "undo" | "redo" | "fit" | "back") => {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
    };
    if (name === "select") {
        return <path {...common} d="m6 4 12 12-5 1.1 2 4.8-3.2 1.3-2-4.7-3.8 3.1L6 4Z" />;
    }
    if (name === "wall") {
        return <path {...common} d="M4 20h16M4 16h16M5 8h3v8H5zm6-4h3v12h-3zm6 5h3v7h-3z" />;
    }
    if (name === "door") {
        return (
            <>
                <path {...common} d="M6 3h10v18H6z" />
                <path {...common} d="M8 20V5h6M8 20l6-6" />
                <circle cx="12.5" cy="12" r=".8" fill="currentColor" />
            </>
        );
    }
    if (name === "window") {
        return (
            <>
                <rect {...common} x="4" y="5" width="16" height="14" rx="1" />
                <path {...common} d="M12 5v14M4 12h16" />
            </>
        );
    }
    if (name === "radiator") {
        return (
            <>
                <rect {...common} x="3" y="7" width="18" height="11" rx="1.5" />
                <path {...common} d="M7.5 7v11M12 7v11M16.5 7v11M5 18v2M19 18v2" />
            </>
        );
    }
    if (name === "clear") return <path {...common} d="m6 7 12 12M18 7 6 19M4 4l16 16" />;
    if (name === "reset") {
        return (
            <>
                <path {...common} d="M6 8V4m0 0h4M6 4l3 3a7 7 0 1 1-1.1 9.8" />
                <path {...common} d="M6 16v4m0 0h4M6 20l3-3" />
            </>
        );
    }
    if (name === "undo") return <path {...common} d="M9 8 5 12l4 4M6 12h8a5 5 0 0 1 5 5" />;
    if (name === "redo") return <path {...common} d="m15 8 4 4-4 4M18 12h-8a5 5 0 0 0-5 5" />;
    if (name === "back") return <path {...common} d="m13 6-6 6 6 6M8 12h10" />;
    return <path {...common} d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />;
};

const ToolIcon: React.FC<{
    name: Tool | "clear" | "reset" | "undo" | "redo" | "fit" | "back";
}> = ({ name }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {drawIcon(name)}
    </svg>
);

const normalizeNextPoint = (point: Point, previous?: Point, snapMm = LEGACY_SNAP_MM): Point => {
    const next = {
        x: snapDrawRoomCoordinate(point.x, snapMm),
        y: snapDrawRoomCoordinate(point.y, snapMm),
    };
    if (!previous) return next;
    return Math.abs(next.x - previous.x) >= Math.abs(next.y - previous.y)
        ? { x: next.x, y: previous.y }
        : { x: previous.x, y: next.y };
};

/** Keeps the live wall orthogonal while allowing its free end to land on a graph wall. */
const resolveDragEnd = (
    segments: DrawWallSegment[],
    start: Point,
    point: Point,
    snapMm = LEGACY_SNAP_MM,
): Point => {
    const candidate = normalizeNextPoint(point, start, snapMm);
    const horizontal = candidate.y === start.y;
    const endpoint = segments
        .flatMap((segment) => [segment.start, segment.end])
        .filter((target) => (horizontal ? target.y === start.y : target.x === start.x))
        .map((target) => ({
            target,
            distance: Math.hypot(candidate.x - target.x, candidate.y - target.y),
        }))
        .sort((first, second) => first.distance - second.distance)[0];
    if (endpoint && endpoint.distance <= 260) return { ...endpoint.target };

    const wall = segments
        .map((segment) => {
            if (horizontal && segment.start.x === segment.end.x) {
                const target = { x: segment.start.x, y: start.y };
                const inside =
                    target.y >= Math.min(segment.start.y, segment.end.y) &&
                    target.y <= Math.max(segment.start.y, segment.end.y);
                return { target, distance: Math.abs(candidate.x - target.x), inside };
            }
            if (!horizontal && segment.start.y === segment.end.y) {
                const target = { x: start.x, y: segment.start.y };
                const inside =
                    target.x >= Math.min(segment.start.x, segment.end.x) &&
                    target.x <= Math.max(segment.start.x, segment.end.x);
                return { target, distance: Math.abs(candidate.y - target.y), inside };
            }
            return null;
        })
        .filter((target): target is { target: Point; distance: number; inside: boolean } =>
            Boolean(target?.inside),
        )
        .sort((first, second) => first.distance - second.distance)[0];
    return wall && wall.distance <= 260 ? wall.target : candidate;
};

const getSingleRoomPreview = (scene: Scene): RoomPreview | null => {
    const wallThickness = getSceneWallThickness(scene);
    const result = deriveDrawWallGraphRoom(scene.segments, wallThickness);
    if (!result) return null;
    const toInteriorEndpoint = (point: Point, other: Point): Point | null => {
        const local = { x: point.x - result.origin.x, y: point.y - result.origin.y };
        const otherLocal = { x: other.x - result.origin.x, y: other.y - result.origin.y };
        const length = Math.abs(otherLocal.x - local.x) + Math.abs(otherLocal.y - local.y);
        if (!length) return null;
        const direction = {
            x: (otherLocal.x - local.x) / length,
            y: (otherLocal.y - local.y) / length,
        };
        // A branch can start at an outer wall centre-line, while the planner's
        // coordinates start at the inner material face. Move that endpoint by
        // half a wall into the room before storing the actual partition.
        for (const distance of [0, wallThickness / 2, wallThickness]) {
            const candidate = {
                x: local.x + direction.x * distance,
                y: local.y + direction.y * distance,
            };
            if (pointInsideRoom(result.room, candidate)) return candidate;
        }
        return null;
    };
    const partitions = scene.segments.flatMap((segment) => {
        if (isGraphSegmentOnClosedContour(segment, result.contour)) return [];
        const start = toInteriorEndpoint(segment.start, segment.end);
        const end = toInteriorEndpoint(segment.end, segment.start);
        if (!start || !end || (start.x === end.x && start.y === end.y)) return [];
        return [
            {
                id: `partition-${segment.id}`,
                start,
                end,
                thickness: wallThickness,
            },
        ];
    });
    // A closed drafting contour is useful even when it is too small for the
    // furniture planner. Keep its canonical RoomGeometry here so the editor
    // can show the room, area and both dimension chains. Handoff eligibility
    // is evaluated separately with validateRoomGeometry below.
    const roomWithoutRegionMaterialization: Room = {
        ...result.room,
        ...(wallThickness === DRAW_ROOM_WALL_LANE_MM ? {} : { wallThickness }),
        partitions,
        doors: scene.doors,
        windows: scene.windows,
        ...(scene.regions ? { regions: scene.regions } : {}),
    };
    return {
        room: {
            ...roomWithoutRegionMaterialization,
            // Region signatures are derived from the real partition material
            // on every render. Names only survive an exact, unambiguous
            // signature match; a split/merge receives safe fresh names.
            regions: materializeRoomRegionsState(roomWithoutRegionMaterialization),
        },
        origin: result.origin,
        contour: result.contour.map((point) => ({ ...point })),
    };
};

const SlidingDoorSettings = ({
    mount,
    direction,
    double,
    onChange,
}: {
    mount?: DoorOpening["slidingMount"];
    direction?: DoorOpening["slidingDirection"];
    double: boolean;
    onChange: (patch: Partial<DoorOpening>) => void;
}) => (
    <div className={styles.slidingSettings}>
        <label>
            Монтаж раздвижной двери
            <select
                aria-label="Монтаж раздвижной двери"
                value={mount ?? "inward"}
                onChange={(e) =>
                    onChange({ slidingMount: e.target.value as DoorOpening["slidingMount"] })
                }
            >
                <option value="inward">Со стороны помещения</option>
                <option value="outward">С противоположной стороны</option>
                <option value="pocket">Внутри стены — пенал</option>
            </select>
        </label>
        {!double && (
            <label>
                Направление сдвига
                <select
                    aria-label="Направление сдвига"
                    value={direction ?? "start"}
                    onChange={(e) =>
                        onChange({
                            slidingDirection: e.target.value as DoorOpening["slidingDirection"],
                        })
                    }
                >
                    <option value="start">К началу стены</option>
                    <option value="end">К концу стены</option>
                </select>
            </label>
        )}
    </div>
);

const SlidingDoorSymbol = ({
    start,
    end,
    normal,
    double,
    partition = false,
    thickness,
    mount = "inward",
    direction = "start",
}: {
    start: Point;
    end: Point;
    normal: Point;
    double: boolean;
    mount?: DoorOpening["slidingMount"];
    direction?: DoorOpening["slidingDirection"];
    partition?: boolean;
    thickness: number;
}) => {
    const width = Math.hypot(end.x - start.x, end.y - start.y);
    if (!width) return null;
    const dx = (end.x - start.x) / width;
    const dy = (end.y - start.y) / width;
    const leafWidth = double ? width / 2 : width;
    const leafDepth = 35;
    const inside = partition ? thickness / 2 : 0;
    const outside = inside - thickness;
    const track =
        mount === "pocket"
            ? inside - thickness / 2 - leafDepth / 2
            : mount === "outward"
              ? outside - 25 - leafDepth
              : inside + 25;
    return (
        <g
            className={styles.slidingDoorSymbol}
            data-draw-room-sliding-symbol={double ? "double" : "single"}
            data-sliding-mount={mount}
            data-sliding-direction={direction}
            strokeDasharray={mount === "pocket" ? "12 8" : undefined}
            transform={`matrix(${dx} ${dy} ${normal.x} ${normal.y} ${start.x} ${start.y})`}
        >
            {[0, width].map((x, i) => (
                <path
                    key={i}
                    data-sliding-jamb="true"
                    fill="none"
                    d={`M ${x + (i ? 45 : -45)} ${outside - 12} H ${x + (i ? -12 : 12)} V ${inside + 12} H ${x + (i ? 45 : -45)}`}
                />
            ))}
            <rect
                data-sliding-leaf="true"
                x={!double && direction === "end" ? width - leafWidth / 2 : -leafWidth / 2}
                y={track}
                width={leafWidth}
                height={leafDepth}
            />
            {double && (
                <rect
                    data-sliding-leaf="true"
                    x={width - leafWidth / 2}
                    y={track}
                    width={leafWidth}
                    height={leafDepth}
                />
            )}
        </g>
    );
};

const regionPrefix = (preview: RoomPreview) => `building:${preview.wallIds?.[0]}:`;

const getRoomPreviews = (scene: Scene): RoomPreview[] => {
    const previews = getDrawWallComponents(scene.segments)
        .flatMap((segments) => {
            const preview = getSingleRoomPreview({
                ...scene,
                segments,
                doors: [],
                windows: [],
                radiators: [],
            });
            return preview ? [{ ...preview, wallIds: segments.map((segment) => segment.id) }] : [];
        })
        .sort((a, b) => {
            const area = (preview: RoomPreview) =>
                Math.abs(
                    preview.contour.reduce((sum, p, i) => {
                        const q = preview.contour[(i + 1) % preview.contour.length];
                        return sum + p.x * q.y - q.x * p.y;
                    }, 0),
                );
            return area(b) - area(a);
        });
    return previews
        .map((preview, index) => {
            const owns = (item: DoorOpening | WindowOpening) =>
                item.drawingHostId ? preview.wallIds.includes(item.drawingHostId) : index === 0;
            return {
                ...preview,
                room: {
                    ...preview.room,
                    regions: materializeRoomRegionsState({
                        ...preview.room,
                        regions: {
                            version: 1,
                            items: (scene.regions?.items ?? []).flatMap((item) =>
                                item.signature.startsWith(regionPrefix(preview))
                                    ? [
                                          {
                                              ...item,
                                              signature: item.signature.slice(
                                                  regionPrefix(preview).length,
                                              ),
                                          },
                                      ]
                                    : index === 0 && !item.signature.startsWith("building:")
                                      ? [item]
                                      : [],
                            ),
                        },
                    }),
                    doors: scene.doors.filter(owns),
                    windows: scene.windows.filter(owns),
                },
            };
        })
        .map((preview, index) => {
            const owns = (item: RadiatorObstacle) =>
                item.drawingHostId ? preview.wallIds.includes(item.drawingHostId) : index === 0;
            // A radiator whose wall was redrawn away waits in the scene, off the
            // room, until a wall can carry it again.
            const radiators = (scene.radiators ?? [])
                .filter(owns)
                .reduce<
                    RadiatorObstacle[]
                >((kept, radiator) => (validateRoomGeometry({ ...preview.room, radiators: [...kept, radiator] }) ? kept : [...kept, radiator]), []);
            return radiators.length
                ? { ...preview, room: { ...preview.room, radiators } }
                : preview;
        });
};
const getRoomPreview = (scene: Scene) => getRoomPreviews(scene)[0] ?? null;
const openingOwner = (previews: RoomPreview[], item: DoorOpening | WindowOpening) =>
    item.drawingHostId
        ? previews.find((preview) => preview.wallIds?.includes(item.drawingHostId!))
        : previews[0];
const scopedOpeningScene = (scene: Scene, preview: RoomPreview): Scene => ({
    ...scene,
    doors: preview.room.doors,
    windows: preview.room.windows,
    radiators: preview.room.radiators ?? [],
});
const bindLegacyOpenings = (scene: Scene): Scene => {
    const primary = getRoomPreview(scene);
    const bind = <T extends DoorOpening | WindowOpening | RadiatorObstacle>(item: T): T =>
        item.drawingHostId || !primary ? item : { ...item, drawingHostId: primary.wallIds?.[0] };
    return {
        ...scene,
        regions: {
            version: 1,
            items: getRoomPreviews(scene).flatMap((owner) =>
                (owner.room.regions?.items ?? []).map((item) => ({
                    ...item,
                    signature: regionPrefix(owner) + item.signature,
                })),
            ),
        },
        doors: scene.doors.map(bind),
        windows: scene.windows.map(bind),
        ...(scene.radiators ? { radiators: scene.radiators.map(bind) } : {}),
    };
};
const roomShapeKey = (room: Room) =>
    JSON.stringify({
        vertices: getRoomVertices(room).map(({ x, y }) => [x, y]),
        partitions: (room.partitions ?? []).map(({ start, end }) => [start, end]),
    });

const openingsKey = (room: Pick<Room, "doors" | "windows">) =>
    JSON.stringify(
        [...room.doors, ...room.windows].map((item) =>
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        ),
    );

/**
 * Doors and windows are still fine-tuned on the layout step. When they changed
 * there since this editor last handed the room over, and the walls are still
 * exactly the drawn ones, the drawing takes them over instead of putting the
 * old positions back on the next hand-off.
 */
const takePlannerOpenings = (scene: Scene, plannerRoom: Room): Scene => {
    const handedOver = readDrawRoomDraft();
    if (
        handedOver.status !== "success" ||
        openingsKey(handedOver.value) === openingsKey(plannerRoom)
    ) {
        return scene;
    }
    const previews = getRoomPreviews(scene);
    const host = previews.find(
        (preview) => roomShapeKey(preview.room) === roomShapeKey(plannerRoom),
    );
    const hostId = host?.wallIds?.[0];
    if (!host || !hostId) return scene;
    const elsewhere = <T extends DoorOpening | WindowOpening>(item: T) =>
        openingOwner(previews, item) !== host;
    const hosted = <T extends DoorOpening | WindowOpening>(item: T): T => ({
        ...item,
        drawingHostId: item.drawingHostId ?? hostId,
    });
    return {
        ...scene,
        doors: [...scene.doors.filter(elsewhere), ...plannerRoom.doors.map(hosted)],
        windows: [...scene.windows.filter(elsewhere), ...plannerRoom.windows.map(hosted)],
    };
};

/**
 * The planner's walls when they were changed there after this editor last
 * handed the room over, so the drawing no longer shows them.
 */
const getNewerPlannerRoom = (scene: Scene, plannerRoom: Room): Room | null => {
    const handedOver = readDrawRoomDraft();
    if (handedOver.status !== "success") return null;
    const plannerShape = roomShapeKey(plannerRoom);
    if (roomShapeKey(handedOver.value) === plannerShape) return null;
    return getRoomPreviews(scene).some((preview) => roomShapeKey(preview.room) === plannerShape)
        ? null
        : plannerRoom;
};

/** The planner's room, for a project whose room was set before the editor existed. */
const readPlannerRoom = (): Room | null => {
    const draft = readProjectDraft();
    return draft.status === "success" ? draft.value.planner?.room ?? null : null;
};

/**
 * The pieces of that project's saved layout, to carry onto the drawing. A
 * layout that no longer passes the room's checks (a stale or damaged save)
 * stays behind rather than putting pieces into walls.
 */
const readPlannerLayout = (): Placement[] => {
    const draft = readProjectDraft();
    if (draft.status !== "success") return [];
    const room = draft.value.planner?.room;
    const placements = draft.value.planner?.layout?.placements ?? [];
    return room && placements.length && validateLayout(room, placements).valid ? placements : [];
};

const parseMeters = (value: string): number | null => {
    const meters = Number(value.trim().replace(",", "."));
    return Number.isFinite(meters) ? Math.round(meters * 100) * 10 : null;
};

const openingTarget = (previews: RoomPreview[], point: Point) => {
    const targets = previews.flatMap((preview) => {
        const target = getWallAtPoint(
            [...getRoomBoundarySegments(preview.room), ...getRoomPartitionSegments(preview.room)],
            point,
            preview.origin,
        );
        if (!target) return [];
        const centre = getOpeningCentre(target.segment, preview.origin, {
            offset: target.offset,
            width: 0,
        });
        return [
            {
                ...target,
                owner: preview,
                distance: Math.hypot(centre.x - point.x, centre.y - point.y),
            },
        ];
    });
    return targets.sort((a, b) => a.distance - b.distance)[0] ?? null;
};

/** A graph edit must not leave an existing partition aperture without a host. */
const wouldOrphanPartitionDoor = (scene: Scene, nextSegments: DrawWallSegment[]): boolean => {
    const partitionDoorIds = scene.doors
        .filter((door) => Boolean(door.partitionId))
        .map((door) => door.partitionId as string);
    if (!partitionDoorIds.length) return false;
    const nextRooms = getRoomPreviews({ ...scene, segments: nextSegments });
    const nextPartitionIds = new Set(
        nextRooms.flatMap(
            (preview) => preview.room.partitions?.map((partition) => partition.id) ?? [],
        ),
    );
    return partitionDoorIds.some((id) => !nextPartitionIds.has(id));
};

/** Graph segments that lie on one closed-contour edge, between its corners. */
const getContourEdgeSegmentIds = (
    segments: DrawWallSegment[],
    start: Point,
    end: Point,
): string[] => {
    const horizontal = start.y === end.y;
    const axis = horizontal ? "x" : "y";
    const cross = horizontal ? "y" : "x";
    const low = Math.min(start[axis], end[axis]);
    const high = Math.max(start[axis], end[axis]);
    return segments
        .filter(
            (segment) =>
                segment.start[cross] === start[cross] &&
                segment.end[cross] === start[cross] &&
                Math.min(segment.start[axis], segment.end[axis]) >= low &&
                Math.max(segment.start[axis], segment.end[axis]) <= high,
        )
        .map((segment) => segment.id);
};

const getWallAtPoint = (
    segments: RoomBoundarySegment[],
    point: Point,
    origin: Point,
): { segment: RoomBoundarySegment; offset: number } | null => {
    const candidates = segments
        .map((segment) => {
            const start = { x: segment.start.x + origin.x, y: segment.start.y + origin.y };
            const end = { x: segment.end.x + origin.x, y: segment.end.y + origin.y };
            const direction = {
                x: (end.x - start.x) / segment.length,
                y: (end.y - start.y) / segment.length,
            };
            const projected = clamp(
                (point.x - start.x) * direction.x + (point.y - start.y) * direction.y,
                0,
                segment.length,
            );
            const nearest = {
                x: start.x + direction.x * projected,
                y: start.y + direction.y * projected,
            };
            return {
                segment,
                distance: Math.hypot(point.x - nearest.x, point.y - nearest.y),
                projected,
            };
        })
        .sort((first, second) => first.distance - second.distance);
    const candidate = candidates[0];
    if (!candidate || candidate.distance > 260) return null;
    return { segment: candidate.segment, offset: candidate.projected };
};

const openingLine = (
    segment: RoomBoundarySegment,
    origin: Point,
    offset: number,
    width: number,
) => {
    const direction = {
        x: (segment.end.x - segment.start.x) / segment.length,
        y: (segment.end.y - segment.start.y) / segment.length,
    };
    const start = {
        x: origin.x + segment.start.x + direction.x * offset,
        y: origin.y + segment.start.y + direction.y * offset,
    };
    return {
        start,
        end: { x: start.x + direction.x * width, y: start.y + direction.y * width },
        direction,
    };
};

const getDoorCatalogItem = (doorKind: DoorKind = "room") =>
    DOOR_CATALOG.find((item) => item.kind === doorKind) ?? DOOR_CATALOG[0];

const getDoorKindLabel = (doorKind: DoorKind | undefined) =>
    getDoorCatalogItem(doorKind ?? "room").label;

const openingBounds = (kind: OpeningKind, doorKind: DoorKind = "room") =>
    kind === "door"
        ? {
              minimum: getDoorCatalogItem(doorKind).minimum,
              maximum: getDoorCatalogItem(doorKind).maximum,
          }
        : { minimum: WINDOW_MIN_WIDTH_MM, maximum: WINDOW_MAX_WIDTH_MM };

const getOpeningWidth = (
    kind: OpeningKind,
    width?: number,
    doorKind: DoorKind = "room",
    snapMm = LEGACY_SNAP_MM,
) => {
    const bounds = openingBounds(kind, doorKind);
    const fallback = kind === "door" ? getDoorCatalogItem(doorKind).defaultWidth : WINDOW_WIDTH_MM;
    return clamp(snapDrawRoomCoordinate(width ?? fallback, snapMm), bounds.minimum, bounds.maximum);
};

/**
 * Placement may pick a safe catalogue default, but an inspector edit must not
 * silently turn an out-of-range measurement into a different doorway. Keep
 * the stored aperture untouched until the user supplies a valid snapped size.
 */
const resolveOpeningWidthEdit = (
    kind: OpeningKind,
    requestedWidth: number,
    doorKind: DoorKind = "room",
    snapMm = LEGACY_SNAP_MM,
): { valid: true; width: number } | { valid: false; message: string } => {
    const bounds = openingBounds(kind, doorKind);
    if (!Number.isFinite(requestedWidth)) {
        return { valid: false, message: "Введите ширину проёма в миллиметрах." };
    }
    const width = snapDrawRoomCoordinate(requestedWidth, snapMm);
    if (width < bounds.minimum || width > bounds.maximum) {
        return {
            valid: false,
            message:
                "Ширина " +
                formatMillimeters(width) +
                " недопустима: для этого проёма можно от " +
                formatMillimeters(bounds.minimum) +
                " до " +
                formatMillimeters(bounds.maximum) +
                ". Размер не изменён.",
        };
    }
    return { valid: true, width };
};

const getOpeningCandidates = (scene: Scene, segmentId: string, ignoreId?: string) => [
    ...scene.doors
        .filter(
            (door) => (door.partitionId ?? door.segmentId) === segmentId && door.id !== ignoreId,
        )
        .map((door) => ({ id: door.id, offset: door.offset, width: door.width })),
    ...scene.windows
        .filter((window) => window.segmentId === segmentId && window.id !== ignoreId)
        .map((window) => ({ id: window.id, offset: window.offset, width: window.width })),
];

const resolveOpeningOffset = (
    scene: Scene,
    segment: RoomBoundarySegment,
    centreOffset: number,
    width: number,
    ignoreId?: string,
    snapMm = getSceneSnapMm(scene),
): { offset: number; valid: boolean; message?: string } => {
    const minOffset = OPENING_END_CLEARANCE_MM;
    const maxOffset = segment.length - width - OPENING_END_CLEARANCE_MM;
    if (maxOffset < minOffset) {
        return {
            offset: minOffset,
            valid: false,
            message: "Стена слишком короткая для этого проёма.",
        };
    }
    const offset = clamp(
        snapDrawRoomCoordinate(centreOffset - width / 2, snapMm),
        minOffset,
        maxOffset,
    );
    const openingEnd = offset + width;
    const collision = getOpeningCandidates(scene, segment.id, ignoreId).find(
        (opening) =>
            openingEnd + OPENING_END_CLEARANCE_MM > opening.offset &&
            offset < opening.offset + opening.width + OPENING_END_CLEARANCE_MM,
    );
    if (collision) {
        return { offset, valid: false, message: "Оставьте не менее 50 мм до другого проёма." };
    }
    return { offset, valid: true };
};

const createDoorOpening = (
    id: string,
    segment: RoomBoundarySegment,
    offset: number,
    width: number,
    doorKind: DoorKind,
    isPartition: boolean,
    slidingMount: DoorOpening["slidingMount"] = "inward",
    slidingDirection: DoorOpening["slidingDirection"] = "start",
): DoorOpening => ({
    id,
    wall: segment.wall,
    ...(isPartition ? { partitionId: segment.id } : { segmentId: segment.id }),
    offset,
    width,
    // DrawRoom has one physical door-size field. Keep its visible leaf,
    // collision envelope, saved draft and Planner handoff in one dimension.
    clearanceDepth: width,
    ...(isHingedDoor({ doorKind })
        ? { hinge: "start" as const, swingDirection: "inward" as const }
        : {}),
    doorKind,
    ...(!isHingedDoor({ doorKind }) ? { slidingMount, slidingDirection } : {}),
});

const getDoorCandidateError = (room: Room, candidate: DoorOpening): string | null =>
    getDoorMaterialCollisionError(candidate, {
        ...room,
        doors: [...room.doors.filter((door) => door.id !== candidate.id), candidate],
    });

const getContourDragMovingEdge = (
    edgeCount: number,
    selectedEdgeIndex: number,
    grab: ContourWallGrab,
) => {
    if (grab === "middle") return selectedEdgeIndex;
    if (grab === "start") return (selectedEdgeIndex - 1 + edgeCount) % edgeCount;
    return (selectedEdgeIndex + 1) % edgeCount;
};

const getPerpendicularContourEdgeAtPoint = (
    contour: Point[],
    point: Point,
    selectedWallIsHorizontal: boolean,
) =>
    contour.findIndex((start, edgeIndex) => {
        const end = contour[(edgeIndex + 1) % contour.length];
        const horizontal = start.y === end.y;
        if (horizontal === selectedWallIsHorizontal) return false;
        return horizontal
            ? point.y === start.y &&
                  point.x >= Math.min(start.x, end.x) &&
                  point.x <= Math.max(start.x, end.x)
            : point.x === start.x &&
                  point.y >= Math.min(start.y, end.y) &&
                  point.y <= Math.max(start.y, end.y);
    });

const getOpeningCentre = (
    segment: RoomBoundarySegment,
    origin: Point,
    opening: Pick<DoorOpening | WindowOpening, "offset" | "width">,
) => {
    const line = openingLine(segment, origin, opening.offset, opening.width);
    return {
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2,
    };
};

/**
 * Keeps openings attached to their physical wall while its graph segment moves.
 * An opening on the moved wall follows it; one on a neighbouring wall
 * keeps its world position until the shorter wall reaches it, where the normal
 * opening bounds check safely rejects the gesture instead of silently moving
 * or deleting the opening.
 */
const reanchorOpeningsForRoom = (
    source: Scene,
    nextSegments: DrawWallSegment[],
    before: RoomPreview,
    after: RoomPreview,
): { scene: Scene } | { error: string } => {
    // Detached contours and open walls share the board, but do not belong to
    // the planner room that owns these openings. Moving them must not rerun
    // opening placement (or be blocked by an already invalid saved door).
    // Compare the complete room, including partitions, and its world origin:
    // any change to an opening host or collision material still takes the
    // normal reanchoring/validation path below.
    if (
        before.origin.x === after.origin.x &&
        before.origin.y === after.origin.y &&
        JSON.stringify(before.room) === JSON.stringify(after.room)
    ) {
        return { scene: { ...source, segments: nextSegments } };
    }
    const reanchored: Scene = {
        ...source,
        segments: nextSegments,
        doors: [],
        windows: [],
        radiators: [],
    };

    const targetFor = (
        opening: DoorOpening | WindowOpening,
        kind: OpeningKind,
    ): { segment: RoomBoundarySegment; offset: number } | null => {
        const oldSegment = getRoomSegment(before.room, opening);
        if (!oldSegment) return null;
        const partition = kind === "door" && Boolean((opening as DoorOpening).partitionId);
        const candidateSegments = partition
            ? getRoomPartitionSegments(after.room)
            : getRoomBoundarySegments(after.room);
        if (!candidateSegments.length) return null;
        const centre = getOpeningCentre(oldSegment, before.origin, opening);
        const sameHost = partition
            ? candidateSegments.find((segment) => segment.id === oldSegment.id)
            : candidateSegments[
                  findMovedDrawWallContourEdge(
                      source.segments,
                      nextSegments,
                      before.contour,
                      after.contour,
                      getRoomBoundarySegments(before.room).findIndex(
                          (segment) => segment.id === oldSegment.id,
                      ),
                      centre,
                  )
              ];
        // A derived contour ID is a position, not a physical wall identity.
        // Never attach the opening to an unrelated nearby wall as a fallback.
        if (!sameHost) return null;
        // Every segment in the straight run follows the move, including hosts
        // beyond the selected T-junction. Preserve the along-wall world position.
        const movedCentre =
            oldSegment.orientation === "horizontal"
                ? {
                      ...centre,
                      y:
                          centre.y +
                          sameHost.start.y +
                          after.origin.y -
                          oldSegment.start.y -
                          before.origin.y,
                  }
                : {
                      ...centre,
                      x:
                          centre.x +
                          sameHost.start.x +
                          after.origin.x -
                          oldSegment.start.x -
                          before.origin.x,
                  };
        return getWallAtPoint([sameHost], movedCentre, after.origin);
    };

    for (const door of source.doors) {
        const target = targetFor(door, "door");
        if (!target) return { error: "Дверь потеряла бы стену-основание. Перемещение отменено." };
        const partition = Boolean(door.partitionId);
        const resolved = resolveOpeningOffset(
            reanchored,
            target.segment,
            target.offset,
            door.width,
            door.id,
        );
        if (!resolved.valid) return { error: resolved.message ?? "Не удалось сохранить дверь." };
        const { partitionId: _partitionId, segmentId: _segmentId, ...doorFields } = door;
        const candidate: DoorOpening = {
            ...doorFields,
            wall: target.segment.wall,
            ...(partition ? { partitionId: target.segment.id } : { segmentId: target.segment.id }),
            offset: resolved.offset,
        };
        const materialError = getDoorCandidateError(
            { ...after.room, doors: reanchored.doors, windows: reanchored.windows },
            candidate,
        );
        if (materialError) return { error: materialError };
        reanchored.doors.push(candidate);
    }

    for (const window of source.windows) {
        const target = targetFor(window, "window");
        if (!target) return { error: "Окно потеряло бы стену-основание. Перемещение отменено." };
        const resolved = resolveOpeningOffset(
            reanchored,
            target.segment,
            target.offset,
            window.width,
            window.id,
        );
        if (!resolved.valid) return { error: resolved.message ?? "Не удалось сохранить окно." };
        const { segmentId: _segmentId, ...windowFields } = window;
        reanchored.windows.push({
            ...windowFields,
            wall: target.segment.wall,
            segmentId: target.segment.id,
            offset: resolved.offset,
        });
    }

    for (const radiator of source.radiators ?? []) {
        // A radiator follows its wall like a window; it may sit under one.
        const target = targetFor(radiator, "window");
        if (!target) return { error: "Радиатор потерял бы стену-основание. Перемещение отменено." };
        const { segmentId: _segmentId, ...radiatorFields } = radiator;
        reanchored.radiators!.push({
            ...radiatorFields,
            wall: target.segment.wall,
            segmentId: target.segment.id,
            // The target is the radiator's centre along the moved wall.
            offset: clamp(
                target.offset - radiator.width / 2,
                0,
                Math.max(0, target.segment.length - radiator.width),
            ),
        });
    }

    return { scene: reanchored };
};

const reanchorOpeningsAfterWallMove = (
    source: Scene,
    nextSegments: DrawWallSegment[],
): { scene: Scene } | { error: string } => {
    const beforeRooms = getRoomPreviews(source);
    const afterRooms = getRoomPreviews({ ...source, segments: nextSegments });
    const doors: DoorOpening[] = [];
    const windows: WindowOpening[] = [];
    const radiators: RadiatorObstacle[] = [];
    for (const before of beforeRooms) {
        const after = afterRooms.find((candidate) =>
            candidate.wallIds?.some((id) => before.wallIds?.includes(id)),
        );
        if (!after) {
            if (
                before.room.doors.length ||
                before.room.windows.length ||
                before.room.radiators?.length
            )
                return {
                    error: "Перемещение лишило бы проём его постройки. Перемещение отменено.",
                };
            continue;
        }
        const result = reanchorOpeningsForRoom(
            scopedOpeningScene(source, before),
            nextSegments,
            before,
            after,
        );
        if ("error" in result) return result;
        doors.push(
            ...result.scene.doors.map((door) => ({
                ...door,
                drawingHostId: door.drawingHostId ?? before.wallIds?.[0],
            })),
        );
        windows.push(
            ...result.scene.windows.map((window) => ({
                ...window,
                drawingHostId: window.drawingHostId ?? before.wallIds?.[0],
            })),
        );
        radiators.push(
            ...(result.scene.radiators ?? []).map((radiator) => ({
                ...radiator,
                drawingHostId: radiator.drawingHostId ?? before.wallIds?.[0],
            })),
        );
    }
    if (doors.length !== source.doors.length || windows.length !== source.windows.length)
        return { error: "Не удалось найти постройку одного из проёмов. Перемещение отменено." };
    // Radiators off every room (their wall redrawn away) keep waiting unchanged.
    const placedRadiatorIds = new Set(radiators.map((radiator) => radiator.id));
    const waitingRadiators = (source.radiators ?? []).filter(
        (radiator) => !placedRadiatorIds.has(radiator.id),
    );
    return {
        scene: {
            ...source,
            segments: nextSegments,
            doors,
            windows,
            ...(source.radiators ? { radiators: [...radiators, ...waitingRadiators] } : {}),
        },
    };
};

const getOpeningCutPolygon = (
    segment: RoomBoundarySegment,
    origin: Point,
    offset: number,
    width: number,
    thickness: number,
    partition = false,
) => {
    const line = openingLine(segment, origin, offset, width);
    // Boundary coordinates lie on the interior face; partition coordinates
    // lie on the centre line. Cut the full material in either case.
    const normal = segment.inwardNormal;
    const inside = (partition ? thickness / 2 : 0) + 1;
    const outside = (partition ? thickness / 2 : thickness) + 1;
    return [
        { x: line.start.x + normal.x * inside, y: line.start.y + normal.y * inside },
        { x: line.end.x + normal.x * inside, y: line.end.y + normal.y * inside },
        { x: line.end.x - normal.x * outside, y: line.end.y - normal.y * outside },
        { x: line.start.x - normal.x * outside, y: line.start.y - normal.y * outside },
    ]
        .map((point) => `${point.x},${point.y}`)
        .join(" ");
};

const formatMillimeters = (value: number) => String(Math.round(value)) + " мм";

interface OpeningHeightTag {
    id: string;
    kind: OpeningKind;
    point: Point;
    vertical: boolean;
    height: string;
    sill: string | null;
}

/**
 * The H=… mark of a measured plan. A door's sits in its room past the clear
 * chain (a partition door's on the side it opens to); a window's sits
 * outside past the outer chain, with its sill height beside it.
 */
const getOpeningHeightTag = (
    opening: RenderedOpening,
    thickness: number,
    millimetersPerPixel: number,
): OpeningHeightTag => {
    const line = openingLine(
        opening.segment,
        opening.origin,
        opening.item.offset,
        opening.item.width,
    );
    const centre = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 };
    const labelHeight = Math.max(115, millimetersPerPixel * 18);
    const inward = opening.segment.inwardNormal;
    const vertical = opening.segment.orientation === "vertical";
    const cm = (value: number) => String(Math.round(value / 10));
    if (opening.kind === "window") {
        const distance = thickness + Math.max(100, millimetersPerPixel * 15) + labelHeight * 1.8;
        const sill = getWindowSillHeight(opening.item);
        return {
            id: opening.item.id,
            kind: "window",
            point: { x: centre.x - inward.x * distance, y: centre.y - inward.y * distance },
            vertical,
            height: `H=${cm(getWindowHeight(opening.item))}`,
            sill: opening.item.windowKind === "floor-to-ceiling" ? null : `Н под.=${cm(sill)}`,
        };
    }
    const partition = Boolean(opening.item.partitionId);
    const normal =
        partition && opening.item.swingDirection === "outward"
            ? { x: -inward.x, y: -inward.y }
            : inward;
    const distance =
        (partition ? thickness / 2 : 0) +
        Math.max(80, millimetersPerPixel * 10) +
        labelHeight * 1.9;
    return {
        id: opening.item.id,
        kind: "door",
        point: { x: centre.x + normal.x * distance, y: centre.y + normal.y * distance },
        vertical,
        height: `H=${cm(getDoorHeight(opening.item))}`,
        sill: null,
    };
};

type WallUnionRect = { left: number; top: number; right: number; bottom: number };

/**
 * Graph nodes are wall centre points, whereas construction measurements belong
 * to the real material envelope. Keeping the conversion here guarantees that
 * the hatch, live overlay and committed wall all use the exact same four faces.
 */
const getWallEnvelopeFromPoints = (
    start: Point,
    end: Point,
    thickness: number,
): WallUnionRect | null => {
    if (start.x === end.x && start.y === end.y) return null;
    const horizontal = start.y === end.y;
    const half = thickness / 2;
    return {
        left: horizontal ? Math.min(start.x, end.x) - half : start.x - half,
        top: horizontal ? start.y - half : Math.min(start.y, end.y) - half,
        right: horizontal ? Math.max(start.x, end.x) + half : start.x + half,
        bottom: horizontal ? start.y + half : Math.max(start.y, end.y) + half,
    };
};

const getWallStripPolygonFromPoints = (start: Point, end: Point, thickness: number): string => {
    const envelope = getWallEnvelopeFromPoints(start, end, thickness);
    if (!envelope) return "";
    return [
        `${envelope.left},${envelope.top}`,
        `${envelope.right},${envelope.top}`,
        `${envelope.right},${envelope.bottom}`,
        `${envelope.left},${envelope.bottom}`,
    ].join(" ");
};

const getWallUnionRect = (segment: DrawWallSegment, thickness: number): WallUnionRect =>
    getWallEnvelopeFromPoints(segment.start, segment.end, thickness)!;

/**
 * Builds the outline of an axis-aligned rectangle union. The fill and stroke
 * are applied once to its outside boundary, so connected L/T walls have no
 * internal end caps even though their graph segments stay independent.
 */
const getOpenWallUnionPath = (segments: DrawWallSegment[], thickness: number): string => {
    if (!segments.length) return "";
    const rectangles = segments.map((segment) => getWallUnionRect(segment, thickness));
    const xs = Array.from(
        new Set(rectangles.flatMap((rectangle) => [rectangle.left, rectangle.right])),
    ).sort((first, second) => first - second);
    const ys = Array.from(
        new Set(rectangles.flatMap((rectangle) => [rectangle.top, rectangle.bottom])),
    ).sort((first, second) => first - second);
    const covered = (xIndex: number, yIndex: number) => {
        if (xIndex < 0 || yIndex < 0 || xIndex >= xs.length - 1 || yIndex >= ys.length - 1)
            return false;
        const x = (xs[xIndex] + xs[xIndex + 1]) / 2;
        const y = (ys[yIndex] + ys[yIndex + 1]) / 2;
        return rectangles.some(
            (rectangle) =>
                x > rectangle.left &&
                x < rectangle.right &&
                y > rectangle.top &&
                y < rectangle.bottom,
        );
    };
    type Edge = { start: Point; end: Point };
    const edges: Edge[] = [];
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
        for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
            if (!covered(xIndex, yIndex)) continue;
            const left = xs[xIndex];
            const right = xs[xIndex + 1];
            const top = ys[yIndex];
            const bottom = ys[yIndex + 1];
            if (!covered(xIndex, yIndex - 1))
                edges.push({ start: { x: left, y: top }, end: { x: right, y: top } });
            if (!covered(xIndex + 1, yIndex))
                edges.push({ start: { x: right, y: top }, end: { x: right, y: bottom } });
            if (!covered(xIndex, yIndex + 1))
                edges.push({ start: { x: right, y: bottom }, end: { x: left, y: bottom } });
            if (!covered(xIndex - 1, yIndex))
                edges.push({ start: { x: left, y: bottom }, end: { x: left, y: top } });
        }
    }
    const pointKey = (point: Point) => `${point.x}:${point.y}`;
    const unused = new Set(edges.map((_, index) => index));
    const paths: string[] = [];
    while (unused.size) {
        const first = Array.from(unused)[0];
        const start = edges[first].start;
        const points = [start];
        let edgeIndex = first;
        while (unused.has(edgeIndex)) {
            unused.delete(edgeIndex);
            const edge = edges[edgeIndex];
            points.push(edge.end);
            if (pointKey(edge.end) === pointKey(start)) break;
            const next = Array.from(unused).find(
                (candidate) => pointKey(edges[candidate].start) === pointKey(edge.end),
            );
            if (next === undefined) break;
            edgeIndex = next;
        }
        if (points.length > 3 && pointKey(points.at(-1)!) === pointKey(start)) {
            paths.push(pointsToClosedPath(points.slice(0, -1)));
        }
    }
    return paths.join(" ");
};

const getConnectedWallComponents = (segments: DrawWallSegment[]): DrawWallSegment[][] => {
    const remaining = new Set(segments.map((_, index) => index));
    const components: DrawWallSegment[][] = [];
    while (remaining.size) {
        const first = Array.from(remaining)[0];
        remaining.delete(first);
        const indexes = [first];
        const component = [segments[first]];
        for (let cursor = 0; cursor < indexes.length; cursor += 1) {
            const current = segments[indexes[cursor]];
            Array.from(remaining).forEach((candidate) => {
                const other = segments[candidate];
                const connected = [current.start, current.end].some((point) =>
                    [other.start, other.end].some(
                        (otherPoint) => point.x === otherPoint.x && point.y === otherPoint.y,
                    ),
                );
                if (!connected) return;
                remaining.delete(candidate);
                indexes.push(candidate);
                component.push(other);
            });
        }
        components.push(component);
    }
    return components;
};

/**
 * The wall graph may keep one physical straight wall as several edges: a
 * person can extend it from its free end, and a later T attachment splits the
 * host edge at the new node. A dimension, however, belongs to the uninterrupted
 * architectural run. Collapse only touching intervals on the same axis; an
 * angle or even a small gap remains a separate wall measurement.
 */
const getContiguousCollinearDimensionSegments = (
    segments: DrawWallSegment[],
): DrawWallSegment[] => {
    type AxisLine = {
        horizontal: boolean;
        coordinate: number;
        segments: DrawWallSegment[];
    };
    const lines = new Map<string, AxisLine>();

    segments.forEach((segment) => {
        const horizontal = segment.start.y === segment.end.y;
        const coordinate = horizontal ? segment.start.y : segment.start.x;
        const key = `${horizontal ? "horizontal" : "vertical"}:${coordinate}`;
        const line = lines.get(key) ?? { horizontal, coordinate, segments: [] };
        line.segments.push(segment);
        lines.set(key, line);
    });

    return Array.from(lines.values()).flatMap(({ horizontal, coordinate, segments: line }) => {
        type Span = { start: number; end: number; segmentIds: string[] };
        const spans: Span[] = [];
        [...line]
            .sort((first, second) => {
                const firstStart = horizontal
                    ? Math.min(first.start.x, first.end.x)
                    : Math.min(first.start.y, first.end.y);
                const secondStart = horizontal
                    ? Math.min(second.start.x, second.end.x)
                    : Math.min(second.start.y, second.end.y);
                return firstStart - secondStart;
            })
            .forEach((segment) => {
                const start = horizontal
                    ? Math.min(segment.start.x, segment.end.x)
                    : Math.min(segment.start.y, segment.end.y);
                const end = horizontal
                    ? Math.max(segment.start.x, segment.end.x)
                    : Math.max(segment.start.y, segment.end.y);
                const current = spans.at(-1);
                if (current && start <= current.end) {
                    current.end = Math.max(current.end, end);
                    current.segmentIds.push(segment.id);
                    return;
                }
                spans.push({ start, end, segmentIds: [segment.id] });
            });

        return spans.map((span) => ({
            // Keep the original graph id for an unbroken source edge, which
            // lets selection/tests continue to refer to it. A combined run
            // gets a stable presentation-only id; graph topology is untouched.
            id:
                span.segmentIds.length === 1
                    ? span.segmentIds[0]
                    : `dimension:${span.segmentIds.join("+")}`,
            start: horizontal ? { x: span.start, y: coordinate } : { x: coordinate, y: span.start },
            end: horizontal ? { x: span.end, y: coordinate } : { x: coordinate, y: span.end },
        }));
    });
};

const graphPointLiesOnSegment = (point: Point, start: Point, end: Point) =>
    (start.y === end.y &&
        point.y === start.y &&
        point.x >= Math.min(start.x, end.x) &&
        point.x <= Math.max(start.x, end.x)) ||
    (start.x === end.x &&
        point.x === start.x &&
        point.y >= Math.min(start.y, end.y) &&
        point.y <= Math.max(start.y, end.y));

/**
 * A graph wall can be split at a T attachment, but both replacement pieces
 * still belong to the closed room perimeter. This classification stays in
 * graph/world geometry rather than comparing rendered SVG paths, so a branch
 * can never disappear just because the perimeter has already closed.
 */
const isGraphSegmentOnClosedContour = (segment: DrawWallSegment, contour: Point[]) =>
    contour.some((start, index) => {
        const end = contour[(index + 1) % contour.length];
        const sameOrientation =
            (segment.start.y === segment.end.y && start.y === end.y) ||
            (segment.start.x === segment.end.x && start.x === end.x);
        return (
            sameOrientation &&
            graphPointLiesOnSegment(segment.start, start, end) &&
            graphPointLiesOnSegment(segment.end, start, end)
        );
    });

/**
 * A closed contour may coexist with a later, independent sketch.  Keep the
 * two drafting systems separate by classifying components in canonical graph
 * coordinates, rather than by their painted union: a component is attached
 * only when one of its graph endpoints actually lies on the room perimeter.
 * This also excludes T-branches and perimeter pieces that were split at an
 * attachment point, while retaining a detached open line or L for its own
 * committed CAD dimensions.
 */
const wallComponentTouchesClosedContour = (segments: DrawWallSegment[], contour: Point[]) =>
    segments.some((segment) =>
        [segment.start, segment.end].some((point) =>
            contour.some((start, index) =>
                graphPointLiesOnSegment(point, start, contour[(index + 1) % contour.length]),
            ),
        ),
    );

const polygonSignedArea = (points: Point[]) =>
    points.reduce((area, point, index) => {
        const next = points[(index + 1) % points.length];
        return area + point.x * next.y - next.x * point.y;
    }, 0) / 2;

const pointsToClosedPath = (points: Point[]) =>
    points.length ? `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} Z` : "";

const getClosedWallUnionPath = (points: Point[], thickness: number): string => {
    const faces = getDrawRoomWallFaceContours(points, thickness);
    if (!faces) return "";
    return `${pointsToClosedPath(faces.outerFaceContour)} ${pointsToClosedPath(
        faces.innerFaceContour,
    )}`;
};

const getPreviewContourPoints = (preview: RoomPreview): Point[] =>
    preview.contour.map((point) => ({ ...point }));

const samePoint = (first: Point, second: Point) => first.x === second.x && first.y === second.y;

/**
 * The graph owns the actual snapping rule.  The editor only adds a semantic
 * description for the drafting overlay, so the visual magnet can never drift
 * from the point that will be committed to the graph on pointer down.
 */
const getWallAnchorFeedback = (
    segments: DrawWallSegment[],
    point: Point,
    hitRadius?: number,
    snapMm = LEGACY_SNAP_MM,
): WallAnchorFeedback => {
    const resolved = resolveDrawWallAnchor(segments, point, hitRadius, snapMm);
    const endpoint = segments
        .flatMap((segment) => [segment.start, segment.end])
        .some((candidate) => samePoint(candidate, resolved));
    if (endpoint) return { point: resolved, attachment: "endpoint" };

    const side = segments.some((segment) => {
        const horizontal = segment.start.y === segment.end.y;
        return horizontal
            ? resolved.y === segment.start.y &&
                  resolved.x > Math.min(segment.start.x, segment.end.x) &&
                  resolved.x < Math.max(segment.start.x, segment.end.x)
            : resolved.x === segment.start.x &&
                  resolved.y > Math.min(segment.start.y, segment.end.y) &&
                  resolved.y < Math.max(segment.start.y, segment.end.y);
    });
    return { point: resolved, attachment: side ? "side" : "free" };
};

type LiveWallDimensionRole =
    | "length-first"
    | "length-second"
    | "thickness-first"
    | "thickness-second";

interface LiveWallDimension {
    id: LiveWallDimensionRole;
    dimensionStart: Point;
    dimensionEnd: Point;
    extensionStart: Point;
    extensionEnd: Point;
    tickStart: Point;
    tickEnd: Point;
    label: Point;
    labelValue: string;
    vertical: boolean;
    labelWidth: number;
    labelHeight: number;
}

interface LiveDimensionObstacle {
    rect: ScreenRect;
    /** Existing dimensions must stay clear of both labels and their lines. */
    blockLines: boolean;
}

const getLiveWallDimensionLabelSize = (value: string, millimetersPerPixel: number) => {
    const labelHeight = Math.max(108, millimetersPerPixel * 22);
    return {
        labelHeight,
        labelWidth: Math.max(labelHeight * 1.35, millimetersPerPixel * (value.length * 9.8 + 18)),
    };
};

/**
 * Produces the four temporary construction annotations shown while the mouse
 * button is held: both true outer-face lengths and both true end-face
 * thicknesses. Every extension starts on an envelope corner, never on the
 * graph centre line, which makes the overlay match the finished hatch exactly.
 */
const getLiveWallDimensions = (
    segment: { start: Point; end: Point },
    thickness: number,
    millimetersPerPixel: number,
    attachment: WallAnchorAttachment | null,
    obstacles: LiveDimensionObstacle[] = [],
    viewport: CanvasViewBox = DEFAULT_VIEW_BOX,
): LiveWallDimension[] => {
    const envelope = getWallEnvelopeFromPoints(segment.start, segment.end, thickness);
    if (!envelope) return [];

    const horizontal = segment.start.y === segment.end.y;
    const length = horizontal ? envelope.right - envelope.left : envelope.bottom - envelope.top;
    const thicknessLength = horizontal
        ? envelope.bottom - envelope.top
        : envelope.right - envelope.left;
    const lengthValue = formatWallLength(length);
    const thicknessValue = formatWallLength(thicknessLength);
    const lengthLabel = getLiveWallDimensionLabelSize(lengthValue, millimetersPerPixel);
    const thicknessLabel = getLiveWallDimensionLabelSize(thicknessValue, millimetersPerPixel);
    const offset = Math.max(135, millimetersPerPixel * LIVE_DIMENSION_OFFSET_PX);
    const attachedOffset = Math.max(175, millimetersPerPixel * LIVE_ATTACHED_DIMENSION_OFFSET_PX);
    const tickHalf = Math.max(28, millimetersPerPixel * 4);

    const makeDimension = (
        id: LiveWallDimensionRole,
        extensionStart: Point,
        extensionEnd: Point,
        dimensionStart: Point,
        dimensionEnd: Point,
        vertical: boolean,
        labelValue: string,
        labelSize: { labelWidth: number; labelHeight: number },
    ): LiveWallDimension => ({
        id,
        extensionStart,
        extensionEnd,
        dimensionStart,
        dimensionEnd,
        tickStart: vertical
            ? { x: dimensionStart.x - tickHalf, y: dimensionStart.y }
            : { x: dimensionStart.x, y: dimensionStart.y - tickHalf },
        tickEnd: vertical
            ? { x: dimensionEnd.x + tickHalf, y: dimensionEnd.y }
            : { x: dimensionEnd.x, y: dimensionEnd.y + tickHalf },
        label: {
            x: (dimensionStart.x + dimensionEnd.x) / 2,
            y: (dimensionStart.y + dimensionEnd.y) / 2,
        },
        labelValue,
        vertical,
        ...labelSize,
    });

    const startAtFirstEnd = horizontal
        ? segment.start.x <= segment.end.x
        : segment.start.y <= segment.end.y;
    const attachmentAtFirstEnd = attachment !== null && attachment !== "free" && startAtFirstEnd;
    const attachmentAtSecondEnd = attachment !== null && attachment !== "free" && !startAtFirstEnd;
    const firstEndOffset = attachmentAtFirstEnd ? attachedOffset : offset;
    const secondEndOffset = attachmentAtSecondEnd ? attachedOffset : offset;

    if (horizontal) {
        const topDimensionY = envelope.top - offset;
        const bottomDimensionY = envelope.bottom + offset;
        const leftDimensionX = envelope.left - firstEndOffset;
        const rightDimensionX = envelope.right + secondEndOffset;
        return resolveLiveWallDimensionTracks(
            [
                makeDimension(
                    "length-first",
                    { x: envelope.left, y: envelope.top },
                    { x: envelope.right, y: envelope.top },
                    { x: envelope.left, y: topDimensionY },
                    { x: envelope.right, y: topDimensionY },
                    false,
                    lengthValue,
                    lengthLabel,
                ),
                makeDimension(
                    "length-second",
                    { x: envelope.left, y: envelope.bottom },
                    { x: envelope.right, y: envelope.bottom },
                    { x: envelope.left, y: bottomDimensionY },
                    { x: envelope.right, y: bottomDimensionY },
                    false,
                    lengthValue,
                    lengthLabel,
                ),
                makeDimension(
                    "thickness-first",
                    { x: envelope.left, y: envelope.top },
                    { x: envelope.left, y: envelope.bottom },
                    { x: leftDimensionX, y: envelope.top },
                    { x: leftDimensionX, y: envelope.bottom },
                    true,
                    thicknessValue,
                    thicknessLabel,
                ),
                makeDimension(
                    "thickness-second",
                    { x: envelope.right, y: envelope.top },
                    { x: envelope.right, y: envelope.bottom },
                    { x: rightDimensionX, y: envelope.top },
                    { x: rightDimensionX, y: envelope.bottom },
                    true,
                    thicknessValue,
                    thicknessLabel,
                ),
            ],
            segment.start,
            millimetersPerPixel,
            obstacles,
            envelope,
            viewport,
            attachment,
        );
    }

    const leftDimensionX = envelope.left - offset;
    const rightDimensionX = envelope.right + offset;
    const topDimensionY = envelope.top - firstEndOffset;
    const bottomDimensionY = envelope.bottom + secondEndOffset;
    return resolveLiveWallDimensionTracks(
        [
            makeDimension(
                "length-first",
                { x: envelope.left, y: envelope.top },
                { x: envelope.left, y: envelope.bottom },
                { x: leftDimensionX, y: envelope.top },
                { x: leftDimensionX, y: envelope.bottom },
                true,
                lengthValue,
                lengthLabel,
            ),
            makeDimension(
                "length-second",
                { x: envelope.right, y: envelope.top },
                { x: envelope.right, y: envelope.bottom },
                { x: rightDimensionX, y: envelope.top },
                { x: rightDimensionX, y: envelope.bottom },
                true,
                lengthValue,
                lengthLabel,
            ),
            makeDimension(
                "thickness-first",
                { x: envelope.left, y: envelope.top },
                { x: envelope.right, y: envelope.top },
                { x: envelope.left, y: topDimensionY },
                { x: envelope.right, y: topDimensionY },
                false,
                thicknessValue,
                thicknessLabel,
            ),
            makeDimension(
                "thickness-second",
                { x: envelope.left, y: envelope.bottom },
                { x: envelope.right, y: envelope.bottom },
                { x: envelope.left, y: bottomDimensionY },
                { x: envelope.right, y: bottomDimensionY },
                false,
                thicknessValue,
                thicknessLabel,
            ),
        ],
        segment.start,
        millimetersPerPixel,
        obstacles,
        envelope,
        viewport,
        attachment,
    );
};

/**
 * A committed wall keeps one useful length annotation. This deliberately
 * stores only the graph segment id: every point, face and lane below is
 * regenerated from the canonical graph on each render, so a T-split,
 * undo/redo, pan or zoom can never leave stale screen coordinates behind.
 */
interface PersistentWallDimension extends LiveWallDimension {
    segmentId: string;
    dimensionKind?: "outer" | "inner" | "thickness";
}

const COMPACT_DIMENSION_MILLIMETERS_PER_PIXEL = 34;
// Committed measurements may take a few more adjacent drafting lanes than a
// transient drag preview.  It is still a finite, screen-space budget: the
// extra lanes only exist to protect the one primary length of a T-split edge
// from being displaced by measurements already owned by its neighbours.
const PERSISTENT_DIMENSION_EXTRA_TRACKS = 5;

interface PersistentDimensionLayout {
    segment: DrawWallSegment;
    envelope: WallUnionRect;
    sourceDimensions: LiveWallDimension[];
    primaryLengthRole: Extract<LiveWallDimensionRole, `length-${string}`> | null;
}

/**
 * Before the perimeter is closed, one orthogonal corner is the only case with
 * an unambiguous inner reference chain. Its graph spans are the two values
 * visible between the inner construction faces at the shared corner. Complex open
 * branches deliberately keep their neutral per-wall dimensions instead of
 * inventing a room size that does not exist yet.
 */
const getOpenCornerClearDimensions = (
    segments: DrawWallSegment[],
    thickness: number,
    millimetersPerPixel: number,
): PersistentWallDimension[] => {
    if (segments.length !== 2) return [];
    const horizontal = segments.find((segment) => segment.start.y === segment.end.y);
    const vertical = segments.find((segment) => segment.start.x === segment.end.x);
    if (!horizontal || !vertical) return [];
    const joint = [horizontal.start, horizontal.end].find((point) =>
        [vertical.start, vertical.end].some((candidate) => samePoint(candidate, point)),
    );
    if (!joint) return [];

    const horizontalFree = samePoint(horizontal.start, joint) ? horizontal.end : horizontal.start;
    const verticalFree = samePoint(vertical.start, joint) ? vertical.end : vertical.start;
    const horizontalDirection = Math.sign(horizontalFree.x - joint.x);
    const verticalDirection = Math.sign(verticalFree.y - joint.y);
    const clearHorizontalEnd = { ...joint };
    const clearVerticalEnd = { ...joint };
    const tickHalf = Math.max(28, millimetersPerPixel * 4);
    // The label is centred on its axis, so keep half of it plus a small gap
    // clear of the wall's inner face instead of a fixed distance from the
    // centre line that a larger label or thicker wall would overrun.
    const labelHalf = getLiveWallDimensionLabelSize("000", millimetersPerPixel).labelHeight / 2;
    const offset = Math.max(120, thickness / 2 + labelHalf + millimetersPerPixel * 4);
    const makeDimension = (
        segment: DrawWallSegment,
        start: Point,
        end: Point,
        verticalAxis: boolean,
        axis: number,
        dimensionId: string,
    ): PersistentWallDimension | null => {
        const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
        if (length <= 0) return null;
        const dimensionStart = verticalAxis ? { x: axis, y: start.y } : { x: start.x, y: axis };
        const dimensionEnd = verticalAxis ? { x: axis, y: end.y } : { x: end.x, y: axis };
        const labelValue = formatWallLength(length);
        return {
            id: "length-first",
            segmentId: `${segment.id}-${dimensionId}`,
            dimensionKind: "inner",
            extensionStart: start,
            extensionEnd: end,
            dimensionStart,
            dimensionEnd,
            tickStart: verticalAxis
                ? { x: dimensionStart.x - tickHalf, y: dimensionStart.y }
                : { x: dimensionStart.x, y: dimensionStart.y - tickHalf },
            tickEnd: verticalAxis
                ? { x: dimensionEnd.x + tickHalf, y: dimensionEnd.y }
                : { x: dimensionEnd.x, y: dimensionEnd.y + tickHalf },
            label: {
                x: (dimensionStart.x + dimensionEnd.x) / 2,
                y: (dimensionStart.y + dimensionEnd.y) / 2,
            },
            labelValue,
            vertical: verticalAxis,
            ...getLiveWallDimensionLabelSize(labelValue, millimetersPerPixel),
        };
    };

    return [
        makeDimension(
            horizontal,
            horizontalFree,
            clearHorizontalEnd,
            false,
            joint.y + verticalDirection * offset,
            "clear-horizontal",
        ),
        makeDimension(
            vertical,
            verticalFree,
            clearVerticalEnd,
            true,
            joint.x + horizontalDirection * offset,
            "clear-vertical",
        ),
    ].filter((dimension): dimension is PersistentWallDimension => Boolean(dimension));
};

const getMirroredWallDimensionRole = (role: LiveWallDimensionRole): LiveWallDimensionRole =>
    role.endsWith("first")
        ? (role.replace("first", "second") as LiveWallDimensionRole)
        : (role.replace("second", "first") as LiveWallDimensionRole);

/**
 * Persistent dimension axes must live outside wall material. Extension lines
 * are allowed to terminate at a wall face, but a measurement line or a white
 * text knockout is never allowed through any hatched envelope — especially
 * after a graph edge has been split into a T-junction.
 */
const persistentDimensionClearsWallMaterial = (
    dimension: LiveWallDimension,
    material: WallUnionRect[],
    millimetersPerPixel: number,
) => {
    const label = getLiveDimensionLabelBounds(dimension);
    const axis = getLineBounds(
        dimension.dimensionStart,
        dimension.dimensionEnd,
        Math.max(10, millimetersPerPixel * 1.25),
    );
    return material.every(
        (envelope) => !rectsOverlap(label, envelope) && !rectsOverlap(axis, envelope),
    );
};

/**
 * Shared extension origins at a wall corner are valid drafting geometry, so
 * they must not reject an otherwise valid persistent measurement. Layout
 * collision is instead evaluated on what the reader actually sees: labels
 * and the four dimension axes. This keeps a free wall's two end-face
 * thicknesses while still preventing annotations through another axis.
 */
const persistentDimensionClearsCommittedDimensions = (
    candidate: LiveWallDimension,
    committed: LiveWallDimension[],
    millimetersPerPixel: number,
) => {
    const padding = Math.max(12, millimetersPerPixel * 1.5);
    const candidateLabel = getLiveDimensionLabelBounds(candidate);
    const candidateAxis = getLineBounds(
        candidate.dimensionStart,
        candidate.dimensionEnd,
        Math.max(8, millimetersPerPixel),
    );
    return committed.every((dimension) => {
        const label = getLiveDimensionLabelBounds(dimension);
        const axis = getLineBounds(
            dimension.dimensionStart,
            dimension.dimensionEnd,
            Math.max(8, millimetersPerPixel),
        );
        return (
            !rectsOverlap(candidateLabel, label, padding) &&
            !rectsOverlap(candidateAxis, label, padding) &&
            !rectsOverlap(axis, candidateLabel, padding) &&
            !rectsOverlap(candidateAxis, axis, padding)
        );
    });
};

/**
 * At a T-junction a new wall begins inside the host wall's material envelope.
 * A parallel length axis may therefore touch the host at its first pixel even
 * though the rest of the dimension sits on a clear drafting lane. Trim that
 * terminal contact back to the exposed union face; the label keeps the
 * canonical graph length, while its line never paints through hatch material.
 */
const trimPersistentDimensionAxisAtMaterialFaces = (
    dimension: LiveWallDimension,
    material: WallUnionRect[],
    millimetersPerPixel: number,
): LiveWallDimension | null => {
    const vertical = dimension.vertical;
    const fixed = vertical ? dimension.dimensionStart.x : dimension.dimensionStart.y;
    const start = vertical ? dimension.dimensionStart.y : dimension.dimensionStart.x;
    const end = vertical ? dimension.dimensionEnd.y : dimension.dimensionEnd.x;
    const increasing = end >= start;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    const safetyGap = Math.max(12, millimetersPerPixel * 1.5);
    const intervals = material
        .filter((envelope) => {
            const materialStart = vertical ? envelope.top : envelope.left;
            const materialEnd = vertical ? envelope.bottom : envelope.right;
            const crossStart = vertical ? envelope.left : envelope.top;
            const crossEnd = vertical ? envelope.right : envelope.bottom;
            return (
                fixed > crossStart &&
                fixed < crossEnd &&
                materialEnd > lower &&
                materialStart < upper
            );
        })
        .map((envelope) => ({
            start: vertical ? envelope.top : envelope.left,
            end: vertical ? envelope.bottom : envelope.right,
        }));

    let safeLower = lower;
    let safeUpper = upper;
    intervals.forEach((interval) => {
        if (interval.start <= safeLower && interval.end > safeLower) {
            safeLower = Math.max(safeLower, interval.end + safetyGap);
        }
        if (interval.start < safeUpper && interval.end >= safeUpper) {
            safeUpper = Math.min(safeUpper, interval.start - safetyGap);
        }
    });
    if (safeUpper <= safeLower) return null;

    const nextStart = increasing ? safeLower : safeUpper;
    const nextEnd = increasing ? safeUpper : safeLower;
    if (nextStart === start && nextEnd === end) return dimension;
    const withAxisCoordinate = (point: Point, coordinate: number): Point =>
        vertical ? { ...point, y: coordinate } : { ...point, x: coordinate };
    const axisStart = withAxisCoordinate(dimension.dimensionStart, nextStart);
    const axisEnd = withAxisCoordinate(dimension.dimensionEnd, nextEnd);
    return {
        ...dimension,
        extensionStart: withAxisCoordinate(dimension.extensionStart, nextStart),
        extensionEnd: withAxisCoordinate(dimension.extensionEnd, nextEnd),
        dimensionStart: axisStart,
        dimensionEnd: axisEnd,
        tickStart: withAxisCoordinate(dimension.tickStart, nextStart),
        tickEnd: withAxisCoordinate(dimension.tickEnd, nextEnd),
        label: {
            x: (axisStart.x + axisEnd.x) / 2,
            y: (axisStart.y + axisEnd.y) / 2,
        },
    };
};

/**
 * Open walls keep a single length measurement after pointer release. Repeating
 * it on the opposite face and repeating the shared wall thickness adds visual
 * noise without giving the reader another value.
 */
const getPersistentWallDimensions = (
    segments: DrawWallSegment[],
    thickness: number,
    view: CanvasViewBox,
    millimetersPerPixel: number,
    includeCornerClearReferences = true,
): PersistentWallDimension[] => {
    const committed: PersistentWallDimension[] = [];
    const material = segments
        .map((segment) => getWallEnvelopeFromPoints(segment.start, segment.end, thickness))
        .filter((envelope): envelope is WallUnionRect => Boolean(envelope));
    // A standalone open L benefits from its clear-face reference spans. They
    // sit at a fixed place inside the corner, so the wall lengths below must
    // pick tracks around them. Once a primary room is closed, though, its
    // outer/inner face chains already own that reference system: the detached
    // sketch keeps only its concise committed edge dimensions.
    const cornerClearDimensions = includeCornerClearReferences
        ? getOpenCornerClearDimensions(segments, thickness, millimetersPerPixel)
        : [];

    const layouts: PersistentDimensionLayout[] = getContiguousCollinearDimensionSegments(
        segments,
    ).flatMap((segment) => {
        const envelope = getWallEnvelopeFromPoints(segment.start, segment.end, thickness);
        if (!envelope) return [];
        return [
            {
                segment,
                envelope,
                sourceDimensions: getLiveWallDimensions(
                    segment,
                    thickness,
                    millimetersPerPixel,
                    null,
                    [],
                    view,
                ),
                primaryLengthRole: null,
            },
        ];
    });

    const candidateCache = new Map<string, LiveWallDimension[]>();
    const candidatesFor = (
        layout: PersistentDimensionLayout,
        role: LiveWallDimensionRole,
        expandTracks: boolean,
    ) => {
        const key = `${layout.segment.id}:${role}:${expandTracks}`;
        const cached = candidateCache.get(key);
        if (cached) return cached;
        const source = layout.sourceDimensions.find((dimension) => dimension.id === role);
        const mirror = layout.sourceDimensions.find(
            (dimension) => dimension.id === getMirroredWallDimensionRole(role),
        );
        const seen = new Set<string>();
        const candidates = [source, mirror]
            .filter((dimension): dimension is LiveWallDimension => Boolean(dimension))
            .flatMap((dimension) =>
                getPersistentDimensionTrackCandidates(
                    { ...dimension, id: role },
                    layout.envelope,
                    view,
                    millimetersPerPixel,
                    expandTracks,
                ),
            )
            .map((candidate) =>
                trimPersistentDimensionAxisAtMaterialFaces(
                    candidate,
                    material,
                    millimetersPerPixel,
                ),
            )
            .filter((candidate): candidate is LiveWallDimension => Boolean(candidate))
            .filter((candidate) => {
                const key = [
                    candidate.dimensionStart.x,
                    candidate.dimensionStart.y,
                    candidate.dimensionEnd.x,
                    candidate.dimensionEnd.y,
                ].join(":");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        candidateCache.set(key, candidates);
        return candidates;
    };

    const choose = (
        layout: PersistentDimensionLayout,
        roles: LiveWallDimensionRole[],
        expandTracks: boolean,
    ) => {
        for (const role of roles) {
            const candidate = candidatesFor(layout, role, expandTracks).find(
                (track) =>
                    persistentDimensionClearsWallMaterial(track, material, millimetersPerPixel) &&
                    persistentDimensionClearsCommittedDimensions(
                        track,
                        [...cornerClearDimensions, ...committed],
                        millimetersPerPixel,
                    ),
            );
            if (candidate) {
                committed.push({
                    ...candidate,
                    segmentId: layout.segment.id,
                    dimensionKind: role.startsWith("thickness") ? "thickness" : "outer",
                });
                return role;
            }
        }
        return null;
    };

    // Every uninterrupted straight wall run earns its principal length.
    // Sorting by the number of material-safe candidates gives constrained T
    // branches first choice without reviving the split host-wall measurements.
    [...layouts]
        .sort(
            (first, second) =>
                (["length-first", "length-second"] as const).flatMap((role) =>
                    candidatesFor(first, role, true),
                ).length -
                (["length-first", "length-second"] as const).flatMap((role) =>
                    candidatesFor(second, role, true),
                ).length,
        )
        .forEach((layout) => {
            layout.primaryLengthRole = choose(
                layout,
                ["length-first", "length-second"],
                true,
            ) as PersistentDimensionLayout["primaryLengthRole"];
        });

    // One graph edge is the one case where its own 10 cm band is useful after
    // release. A visually continuous run made from several graph edges gets
    // only its total length: the shared joins are no longer physical end faces.
    if (layouts.length === 1 && segments.length === 1) {
        choose(layouts[0], ["thickness-first", "thickness-second"], false);
    }

    // Opposite walls spanning the same interval may share one dimension.
    // Equal lengths at different locations are independent measurements.
    // Keep the visually upper/leftmost dimension so the result remains stable
    // when a rectangular outline is drawn before it closes into a room.
    const unique = new Map<string, PersistentWallDimension>();
    committed.forEach((dimension) => {
        const axis = dimension.vertical ? "y" : "x";
        const start = Math.min(dimension.extensionStart[axis], dimension.extensionEnd[axis]);
        const end = Math.max(dimension.extensionStart[axis], dimension.extensionEnd[axis]);
        const key = `${dimension.dimensionKind ?? "outer"}:${dimension.vertical}:${dimension.labelValue}:${start}:${end}`;
        const existing = unique.get(key);
        const preferred =
            !existing ||
            (dimension.vertical
                ? dimension.label.x < existing.label.x
                : dimension.label.y < existing.label.y);
        if (preferred) unique.set(key, dimension);
    });
    return [...Array.from(unique.values()), ...cornerClearDimensions];
};

type DimensionKind = "outer" | "inner";
type DimensionReferenceMode = "full" | "compact";

interface ArchitecturalDimension {
    id: string;
    kind: DimensionKind;
    dimensionStart: Point;
    dimensionEnd: Point;
    extensionStart: Point;
    extensionEnd: Point;
    tickStart: Point;
    tickEnd: Point;
    label: Point;
    labelValue: string;
    vertical: boolean;
    labelWidth: number;
    labelHeight: number;
}

type PositionedDimension = Pick<
    ArchitecturalDimension,
    | "dimensionStart"
    | "dimensionEnd"
    | "extensionStart"
    | "extensionEnd"
    | "label"
    | "vertical"
    | "labelWidth"
    | "labelHeight"
>;

/**
 * A compact sheet may collapse truly repeated opposite-face values. Structural
 * drawing uses the full mode below: each physical face owns its own extension
 * pair, so a reader can follow a complete dimension chain around the room.
 */
const getUniqueArchitecturalDimensions = (dimensions: ArchitecturalDimension[]) => {
    const unique = new Map<string, ArchitecturalDimension>();
    dimensions.forEach((dimension) => {
        const key = `${dimension.vertical}:${dimension.labelValue}`;
        const existing = unique.get(key);
        if (!existing) {
            unique.set(key, dimension);
            return;
        }
        // When the clear and exterior spans happen to be equal, the exterior
        // chain is the more useful single reference. For matching faces in a
        // chain, keep outer values on the top/left and inner values on the
        // bottom/right, leaving the drawing balanced around the room.
        if (existing.kind !== dimension.kind) return;
        const preferCandidate = dimension.vertical
            ? dimension.kind === "outer"
                ? dimension.label.x < existing.label.x
                : dimension.label.x > existing.label.x
            : dimension.kind === "outer"
              ? dimension.label.y < existing.label.y
              : dimension.label.y > existing.label.y;
        if (preferCandidate) unique.set(key, dimension);
    });
    return Array.from(unique.values());
};

interface ScreenRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

interface RoomSummaryPlacement {
    x: number;
    y: number;
    width: number;
    height: number;
    heightFontSize: number;
    areaFontSize: number;
    heightOffset: number;
    areaOffset: number;
    heightValue: string;
    areaValue: string;
}

interface RoomRegionLabelPlacement {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    /** A room's own name heads the label; numbered defaults stay off the plan. */
    title: string | null;
    heightValue: string;
    areaValue: string;
    clearBounds: ScreenRect;
}

const getDimensionLabelBounds = (dimension: PositionedDimension): ScreenRect => {
    const width = dimension.vertical ? dimension.labelHeight : dimension.labelWidth;
    const height = dimension.vertical ? dimension.labelWidth : dimension.labelHeight;
    return {
        left: dimension.label.x - width / 2,
        right: dimension.label.x + width / 2,
        top: dimension.label.y - height / 2,
        bottom: dimension.label.y + height / 2,
    };
};

/**
 * Up close a long wall's midpoint leaves the screen while its dimension line
 * is still visible. Slide the label along its own line into the visible
 * stretch so the value stays readable while the wall is being edited.
 */
const keepDimensionLabelInView = <
    T extends Pick<PositionedDimension, "dimensionStart" | "dimensionEnd" | "label" | "labelWidth">,
>(
    dimension: T,
    view: CanvasViewBox,
    margin: number,
): T => {
    const horizontal =
        Math.abs(dimension.dimensionStart.y - dimension.dimensionEnd.y) <
        Math.abs(dimension.dimensionStart.x - dimension.dimensionEnd.x);
    const axis = horizontal ? "x" : "y";
    const viewStart = horizontal ? view.x : view.y;
    const viewEnd = viewStart + (horizontal ? view.width : view.height);
    const halfLabel = dimension.labelWidth / 2 + margin;
    const low =
        Math.max(
            Math.min(dimension.dimensionStart[axis], dimension.dimensionEnd[axis]),
            viewStart,
        ) + halfLabel;
    const high =
        Math.min(Math.max(dimension.dimensionStart[axis], dimension.dimensionEnd[axis]), viewEnd) -
        halfLabel;
    if (low > high) return dimension;
    const current = dimension.label[axis];
    const next = clamp(current, low, high);
    if (next === current) return dimension;
    return { ...dimension, label: { ...dimension.label, [axis]: next } };
};

const rectsOverlap = (first: ScreenRect, second: ScreenRect, padding = 0) =>
    first.left - padding < second.right &&
    first.right + padding > second.left &&
    first.top - padding < second.bottom &&
    first.bottom + padding > second.top;

const axisLineIntersectsRect = (start: Point, end: Point, rect: ScreenRect) => {
    if (start.y === end.y) {
        return (
            start.y >= rect.top &&
            start.y <= rect.bottom &&
            Math.max(Math.min(start.x, end.x), rect.left) <=
                Math.min(Math.max(start.x, end.x), rect.right)
        );
    }
    return (
        start.x >= rect.left &&
        start.x <= rect.right &&
        Math.max(Math.min(start.y, end.y), rect.top) <=
            Math.min(Math.max(start.y, end.y), rect.bottom)
    );
};

const dimensionIntersectsRect = (dimension: PositionedDimension, rect: ScreenRect) =>
    rectsOverlap(getDimensionLabelBounds(dimension), rect) ||
    [
        [dimension.extensionStart, dimension.dimensionStart],
        [dimension.extensionEnd, dimension.dimensionEnd],
        [dimension.dimensionStart, dimension.dimensionEnd],
    ].some(([start, end]) => axisLineIntersectsRect(start, end, rect));

const getLineBounds = (start: Point, end: Point, padding: number): ScreenRect => ({
    left: Math.min(start.x, end.x) - padding,
    right: Math.max(start.x, end.x) + padding,
    top: Math.min(start.y, end.y) - padding,
    bottom: Math.max(start.y, end.y) + padding,
});

const getLiveDimensionLabelBounds = (dimension: LiveWallDimension): ScreenRect => {
    const width = dimension.vertical ? dimension.labelHeight : dimension.labelWidth;
    const height = dimension.vertical ? dimension.labelWidth : dimension.labelHeight;
    return {
        left: dimension.label.x - width / 2,
        right: dimension.label.x + width / 2,
        top: dimension.label.y - height / 2,
        bottom: dimension.label.y + height / 2,
    };
};

const getPersistentDimensionLabelBounds = (
    dimension: PersistentWallDimension,
    millimetersPerPixel: number,
): ScreenRect => {
    const labelHeight = Math.max(108, millimetersPerPixel * 22);
    const labelWidth = Math.max(
        labelHeight * 1.35,
        millimetersPerPixel * (dimension.labelValue.length * 9.8 + 18),
    );
    const width = dimension.vertical ? labelHeight : labelWidth;
    const height = dimension.vertical ? labelWidth : labelHeight;
    return {
        left: dimension.label.x - width / 2,
        right: dimension.label.x + width / 2,
        top: dimension.label.y - height / 2,
        bottom: dimension.label.y + height / 2,
    };
};

const getDimensionLineObstacles = (
    dimension: Pick<
        ArchitecturalDimension | PersistentWallDimension | LiveWallDimension,
        "extensionStart" | "extensionEnd" | "dimensionStart" | "dimensionEnd"
    >,
    millimetersPerPixel: number,
) => {
    const padding = Math.max(18, millimetersPerPixel * 2.2);
    return [
        getLineBounds(dimension.extensionStart, dimension.dimensionStart, padding),
        getLineBounds(dimension.extensionEnd, dimension.dimensionEnd, padding),
        getLineBounds(dimension.dimensionStart, dimension.dimensionEnd, padding),
    ];
};

/**
 * Region metrics live in the same CAD sheet as the face and partition chains.
 * Keep their white backing clear of both the value and the actual ruled line,
 * rather than treating a label's clear-room bounds as the whole available area.
 */
const getRoomRegionDimensionExclusions = (
    dimensions: PositionedDimension[],
    millimetersPerPixel: number,
): ScreenRect[] =>
    dimensions.flatMap((dimension) => [
        getDimensionLabelBounds(dimension),
        // Extension legs terminate at a clear-face boundary. They may touch
        // that boundary, but never occupy the usable region; reserving their
        // full padded rectangle falsely makes a narrow bay impossible. The
        // actual dimension rule (the chain line plus its value) remains a
        // hard exclusion for the metric backing.
        getLineBounds(
            dimension.dimensionStart,
            dimension.dimensionEnd,
            Math.max(10, millimetersPerPixel * 1.2),
        ),
    ]);

const getPersistentDimensionObstacles = (
    dimensions: PersistentWallDimension[],
    millimetersPerPixel: number,
): LiveDimensionObstacle[] =>
    dimensions.flatMap((dimension) => [
        {
            rect: getPersistentDimensionLabelBounds(dimension, millimetersPerPixel),
            blockLines: true,
        },
        ...getDimensionLineObstacles(dimension, millimetersPerPixel).map((rect) => ({
            rect,
            blockLines: true,
        })),
    ]);

const getArchitecturalDimensionObstacles = (
    dimensions: ArchitecturalDimension[],
    millimetersPerPixel: number,
): LiveDimensionObstacle[] =>
    dimensions.flatMap((dimension) => [
        { rect: getDimensionLabelBounds(dimension), blockLines: true },
        ...getDimensionLineObstacles(dimension, millimetersPerPixel).map((rect) => ({
            rect,
            blockLines: true,
        })),
    ]);

const moveLiveDimensionOutward = (
    dimension: LiveWallDimension,
    distance: number,
): LiveWallDimension => {
    const horizontal = dimension.dimensionStart.y === dimension.dimensionEnd.y;
    const face = horizontal
        ? (dimension.extensionStart.y + dimension.extensionEnd.y) / 2
        : (dimension.extensionStart.x + dimension.extensionEnd.x) / 2;
    const position = horizontal ? dimension.label.y : dimension.label.x;
    const sign = position >= face ? 1 : -1;
    const delta = horizontal ? { x: 0, y: sign * distance } : { x: sign * distance, y: 0 };
    const translate = (point: Point): Point => ({ x: point.x + delta.x, y: point.y + delta.y });
    return {
        ...dimension,
        dimensionStart: translate(dimension.dimensionStart),
        dimensionEnd: translate(dimension.dimensionEnd),
        tickStart: translate(dimension.tickStart),
        tickEnd: translate(dimension.tickEnd),
        label: translate(dimension.label),
    };
};

const liveDimensionTouchesPoint = (dimension: LiveWallDimension, point: Point) =>
    samePoint(dimension.extensionStart, point) || samePoint(dimension.extensionEnd, point);

const liveDimensionCollides = (
    dimension: LiveWallDimension,
    obstacles: LiveDimensionObstacle[],
    padding: number,
) => {
    const label = getLiveDimensionLabelBounds(dimension);
    const segments: Array<[Point, Point]> = [
        [dimension.extensionStart, dimension.dimensionStart],
        [dimension.extensionEnd, dimension.dimensionEnd],
        [dimension.dimensionStart, dimension.dimensionEnd],
    ];
    return obstacles.some(
        (obstacle) =>
            rectsOverlap(label, obstacle.rect, padding) ||
            (obstacle.blockLines &&
                segments.some(([start, end]) => axisLineIntersectsRect(start, end, obstacle.rect))),
    );
};

const getLiveDimensionGeometryBounds = (dimension: LiveWallDimension): ScreenRect => {
    const tickReach = dimension.labelHeight * 0.3;
    const tickStartEnd = dimension.vertical
        ? { x: dimension.tickStart.x + tickReach, y: dimension.tickStart.y }
        : { x: dimension.tickStart.x, y: dimension.tickStart.y + tickReach };
    const tickEndEnd = dimension.vertical
        ? { x: dimension.tickEnd.x - tickReach, y: dimension.tickEnd.y }
        : { x: dimension.tickEnd.x, y: dimension.tickEnd.y - tickReach };
    const points = [
        dimension.extensionStart,
        dimension.extensionEnd,
        dimension.dimensionStart,
        dimension.dimensionEnd,
        dimension.tickStart,
        dimension.tickEnd,
        tickStartEnd,
        tickEndEnd,
    ];
    const label = getLiveDimensionLabelBounds(dimension);
    return {
        left: Math.min(label.left, ...points.map((point) => point.x)),
        right: Math.max(label.right, ...points.map((point) => point.x)),
        top: Math.min(label.top, ...points.map((point) => point.y)),
        bottom: Math.max(label.bottom, ...points.map((point) => point.y)),
    };
};

const isRectInside = (inner: ScreenRect, outer: ScreenRect) =>
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom;

const getLiveDimensionViewport = (
    viewport: CanvasViewBox,
    millimetersPerPixel: number,
): ScreenRect => {
    const inset = Math.max(36, millimetersPerPixel * LIVE_DIMENSION_VIEWPORT_INSET_PX);
    return {
        left: viewport.x + inset,
        right: viewport.x + viewport.width - inset,
        top: viewport.y + inset,
        bottom: viewport.y + viewport.height - inset,
    };
};

const getLiveDimensionTrackDistance = (
    dimension: LiveWallDimension,
    envelope: WallUnionRect,
    millimetersPerPixel: number,
) => {
    const coordinate = dimension.vertical ? dimension.dimensionStart.x : dimension.dimensionStart.y;
    const faces = dimension.vertical
        ? [envelope.left, envelope.right]
        : [envelope.top, envelope.bottom];
    return Math.min(...faces.map((face) => Math.abs(coordinate - face))) / millimetersPerPixel;
};

/**
 * The anchor is the wall's centre point, while an end-face thickness is
 * measured between two envelope corners half a wall away from it. The end
 * whose face centre lies within one thickness of the anchor is the attached one.
 */
const isAttachedThicknessDimension = (dimension: LiveWallDimension, anchorPoint: Point) => {
    if (!dimension.id.startsWith("thickness")) return false;
    const { extensionStart: start, extensionEnd: end } = dimension;
    const faceCentre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return (
        Math.hypot(faceCentre.x - anchorPoint.x, faceCentre.y - anchorPoint.y) <=
        Math.hypot(end.x - start.x, end.y - start.y)
    );
};

const isLengthDimension = (dimension: LiveWallDimension) => dimension.id.startsWith("length");

const getLocalTrackCandidates = (
    dimension: LiveWallDimension,
    envelope: WallUnionRect,
    viewport: CanvasViewBox,
    millimetersPerPixel: number,
) => {
    const step = Math.max(72, millimetersPerPixel * LIVE_DIMENSION_TRACK_STEP_PX);
    const viewportBounds = getLiveDimensionViewport(viewport, millimetersPerPixel);
    const candidates = [0, step, step * 2, step * 3].map((distance) =>
        moveLiveDimensionOutward(dimension, distance),
    );
    return candidates.filter(
        (candidate) =>
            getLiveDimensionTrackDistance(candidate, envelope, millimetersPerPixel) <=
                LIVE_DIMENSION_MAX_TRACK_DISTANCE_PX &&
            isRectInside(getLiveDimensionGeometryBounds(candidate), viewportBounds),
    );
};

/**
 * Persistent labels are allowed to occupy a small number of extra adjacent
 * tracks. This is used only after a segment becomes part of the graph, where
 * a new T branch must retain its own measurement instead of losing it to a
 * neighbour's duplicate. The cap keeps every annotation visually local.
 */
const getPersistentDimensionTrackCandidates = (
    dimension: LiveWallDimension,
    envelope: WallUnionRect,
    viewport: CanvasViewBox,
    millimetersPerPixel: number,
    expandTracks: boolean,
) => {
    const local = getLocalTrackCandidates(dimension, envelope, viewport, millimetersPerPixel);
    if (!expandTracks) return local;

    const step = Math.max(72, millimetersPerPixel * LIVE_DIMENSION_TRACK_STEP_PX);
    const viewportBounds = getLiveDimensionViewport(viewport, millimetersPerPixel);
    const extended = Array.from({ length: PERSISTENT_DIMENSION_EXTRA_TRACKS }, (_, index) =>
        moveLiveDimensionOutward(dimension, step * (index + 4)),
    ).filter((candidate) =>
        isRectInside(getLiveDimensionGeometryBounds(candidate), viewportBounds),
    );

    return [...local, ...extended];
};

/**
 * Resolves temporary annotation lanes in a strict local screen-space budget.
 * A value never walks across the sheet just to avoid another annotation.
 */
const resolveLiveWallDimensionTracks = (
    dimensions: LiveWallDimension[],
    anchorPoint: Point,
    millimetersPerPixel: number,
    obstacles: LiveDimensionObstacle[],
    envelope: WallUnionRect,
    viewport: CanvasViewBox,
    attachment: WallAnchorAttachment | null,
): LiveWallDimension[] => {
    const padding = Math.max(20, millimetersPerPixel * 3);
    const compactAllowed = attachment !== null && attachment !== "free";
    const ordered = [...dimensions].sort(
        (first, second) =>
            Number(isAttachedThicknessDimension(first, anchorPoint)) -
                Number(isAttachedThicknessDimension(second, anchorPoint)) ||
            Number(liveDimensionTouchesPoint(first, anchorPoint)) -
                Number(liveDimensionTouchesPoint(second, anchorPoint)),
    );
    const resolved: LiveWallDimension[] = [];

    ordered.forEach((dimension) => {
        const existing: LiveDimensionObstacle[] = [
            ...obstacles,
            ...resolved.flatMap((other) => [
                { rect: getLiveDimensionLabelBounds(other), blockLines: true },
                ...getDimensionLineObstacles(other, millimetersPerPixel).map((rect) => ({
                    rect,
                    blockLines: true,
                })),
            ]),
        ];
        const candidates = getLocalTrackCandidates(
            dimension,
            envelope,
            viewport,
            millimetersPerPixel,
        );
        const candidate = candidates.find(
            (track) => !liveDimensionCollides(track, existing, padding),
        );
        if (candidate) {
            resolved.push(candidate);
            return;
        }

        // The attached end is physically occupied by the wall we snapped to.
        // Its duplicate end-face thickness would have to cross that wall's
        // committed chain. Compact mode keeps both principal lengths and the
        // free-end thickness in local, visible drafting lanes instead.
        if (compactAllowed && isAttachedThicknessDimension(dimension, anchorPoint)) return;

        // For a normal free wall, keep all four dimensions. This fallback
        // relaxes only line intersection; label overlap, viewport containment
        // and the maximum local track distance remain non-negotiable.
        const labelSafeCandidate = candidates.find(
            (track) =>
                !existing.some((obstacle) =>
                    rectsOverlap(getLiveDimensionLabelBounds(track), obstacle.rect, padding),
                ),
        );
        if (labelSafeCandidate) {
            resolved.push(labelSafeCandidate);
            return;
        }

        // If an attached component is genuinely too tight, only a duplicate
        // length may be omitted after a principal length has already survived.
        if (compactAllowed && isLengthDimension(dimension) && resolved.some(isLengthDimension))
            return;

        const localVisible = candidates[0];
        if (localVisible) resolved.push(localVisible);
    });

    return dimensions.filter((dimension) =>
        resolved.some((candidate) => candidate.id === dimension.id),
    );
};

const pointInPolygon = (point: Point, polygon: Point[]) => {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const current = polygon[index];
        const before = polygon[previous];
        const intersects =
            current.y > point.y !== before.y > point.y &&
            point.x <
                ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) +
                    current.x;
        if (intersects) inside = !inside;
    }
    return inside;
};

const pointOnPolygonBoundary = (point: Point, polygon: Point[]) =>
    polygon.some((start, index) => {
        const end = polygon[(index + 1) % polygon.length];
        const cross =
            (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
        if (Math.abs(cross) > 0.001) return false;
        return (
            point.x >= Math.min(start.x, end.x) - 0.001 &&
            point.x <= Math.max(start.x, end.x) + 0.001 &&
            point.y >= Math.min(start.y, end.y) - 0.001 &&
            point.y <= Math.max(start.y, end.y) + 0.001
        );
    });

const pointInOrOnPolygon = (point: Point, polygon: Point[]) =>
    pointOnPolygonBoundary(point, polygon) || pointInPolygon(point, polygon);

const axisLineFitsPolygon = (start: Point, end: Point, polygon: Point[]) => {
    const samples = [0.08, 0.28, 0.5, 0.72, 0.92];
    return samples.every((ratio) =>
        pointInOrOnPolygon(
            {
                x: start.x + (end.x - start.x) * ratio,
                y: start.y + (end.y - start.y) * ratio,
            },
            polygon,
        ),
    );
};

const distanceToSegment = (point: Point, start: Point, end: Point) => {
    const delta = { x: end.x - start.x, y: end.y - start.y };
    const squaredLength = delta.x * delta.x + delta.y * delta.y || 1;
    const ratio = clamp(
        ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) / squaredLength,
        0,
        1,
    );
    return Math.hypot(point.x - (start.x + delta.x * ratio), point.y - (start.y + delta.y * ratio));
};

const rectFitsPolygon = (rect: ScreenRect, polygon: Point[]) => {
    const x = [rect.left, (rect.left + rect.right) / 2, rect.right];
    const y = [rect.top, (rect.top + rect.bottom) / 2, rect.bottom];
    return x.every((candidateX) =>
        y.every((candidateY) => pointInPolygon({ x: candidateX, y: candidateY }, polygon)),
    );
};

const normalForPolygonFace = (start: Point, end: Point, polygonArea: number) => {
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    // SVG coordinates grow downward. For a positive winding the exterior is
    // on the left of an edge; for a negative winding it is on the right.
    const left = { x: (end.y - start.y) / length, y: (start.x - end.x) / length };
    return polygonArea >= 0 ? left : { x: -left.x, y: -left.y };
};

const getDimensionSide = (normal: Point) =>
    Math.abs(normal.x) > Math.abs(normal.y)
        ? normal.x < 0
            ? "left"
            : "right"
        : normal.y < 0
          ? "top"
          : "bottom";

/**
 * Produces a complete, paired CAD annotation for a completed room. Every
 * dimension begins on an actual material face, not a graph centre line. The
 * inner chain is based on the true clear-face contour: for a 50 mm wall the
 * rectangular clear span is therefore precisely outside - 2 × 50 mm, while
 * each L/notch span keeps its own local geometry.
 */
const getClosedRoomDimensions = (
    contour: Point[],
    thickness: number,
    millimetersPerPixel: number,
    referenceMode: DimensionReferenceMode = "full",
): ArchitecturalDimension[] => {
    if (contour.length < 4) return [];

    const signedArea = polygonSignedArea(contour);
    const faces = getDrawRoomWallFaceContours(contour, thickness);
    if (!faces) return [];
    const outerContour = faces.outerFaceContour;
    const innerContour = faces.innerFaceContour;
    const screenPadding = Math.max(100, millimetersPerPixel * 15);
    const innerPadding = Math.max(80, millimetersPerPixel * 10);
    const trackGap = Math.max(72, millimetersPerPixel * 11);
    const tickHalf = Math.max(38, millimetersPerPixel * 4);
    const labelHeight = Math.max(115, millimetersPerPixel * 18);
    const tracks: Record<DimensionKind, Record<string, number>> = {
        outer: { top: 0, right: 0, bottom: 0, left: 0 },
        inner: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    const makeDimension = (
        kind: DimensionKind,
        start: Point,
        end: Point,
        index: number,
        offset: number,
    ): ArchitecturalDimension | null => {
        const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
        if (!length) return null;
        const outerNormal = normalForPolygonFace(
            contour[index],
            contour[(index + 1) % contour.length],
            signedArea,
        );
        const normal = kind === "outer" ? outerNormal : { x: -outerNormal.x, y: -outerNormal.y };
        const dimensionStart = {
            x: start.x + normal.x * offset,
            y: start.y + normal.y * offset,
        };
        const dimensionEnd = { x: end.x + normal.x * offset, y: end.y + normal.y * offset };
        const vertical = start.x === end.x;
        const labelValue = formatWallLength(length);
        const labelWidth = Math.max(
            labelHeight * 1.45,
            millimetersPerPixel * (labelValue.length * 8.2 + 14),
        );
        return {
            id: `${kind}-${index}`,
            kind,
            dimensionStart,
            dimensionEnd,
            extensionStart: start,
            extensionEnd: end,
            tickStart: {
                x: dimensionStart.x - normal.x * tickHalf,
                y: dimensionStart.y - normal.y * tickHalf,
            },
            tickEnd: {
                x: dimensionEnd.x + normal.x * tickHalf,
                y: dimensionEnd.y + normal.y * tickHalf,
            },
            label: {
                x: (dimensionStart.x + dimensionEnd.x) / 2,
                y: (dimensionStart.y + dimensionEnd.y) / 2,
            },
            labelValue,
            vertical,
            labelWidth,
            labelHeight,
        };
    };

    const makeChain = (kind: DimensionKind, points: Point[]) =>
        points.flatMap((start, index) => {
            const end = points[(index + 1) % points.length];
            const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
            if (!length) return [];
            // A label must be readable, rather than turning into a black dash.
            // Desktop/tablet keep the complete architectural chain even for a
            // compact contour; only the genuinely narrow phone presentation
            // can omit an impossible label/line pair.
            // A completed rectangle always has four exterior and four clear
            // sides. A narrow projected vertical side on a phone is still a
            // primary architectural value, never expendable decoration.
            // Concave rooms may use the declared compact policy below once
            // tracks genuinely compete, but a rectangle must retain all eight
            // face dimensions at every viewport size.
            if (
                contour.length !== 4 &&
                millimetersPerPixel >= 34 &&
                length / millimetersPerPixel < 42
            )
                return [];
            const outerNormal = normalForPolygonFace(
                contour[index],
                contour[(index + 1) % contour.length],
                signedArea,
            );
            const normal =
                kind === "outer" ? outerNormal : { x: -outerNormal.x, y: -outerNormal.y };
            const side = getDimensionSide(normal);
            const firstTrack = tracks[kind][side]++;
            const baseOffset = kind === "outer" ? screenPadding : innerPadding;

            // A concave room can make a nominal "inside" lane cross the
            // neighbouring leg. Search a deterministic set of inward lanes
            // and keep the first one fully inside the real clear contour.
            for (let attempt = 0; attempt < 9; attempt += 1) {
                const dimension = makeDimension(
                    kind,
                    start,
                    end,
                    index,
                    baseOffset + (firstTrack + attempt) * trackGap,
                );
                if (!dimension) return [];
                if (
                    kind === "outer" ||
                    axisLineFitsPolygon(
                        dimension.dimensionStart,
                        dimension.dimensionEnd,
                        innerContour,
                    )
                ) {
                    return [dimension];
                }
            }
            return [];
        });

    const outer = makeChain("outer", outerContour);
    const inner = makeChain("inner", innerContour);

    // Do not infer a missing opposite side from an equal value: the complete
    // reference chain is part of the drawing contract. Compact mode remains
    // available for later print/mobile presentation without changing geometry.
    const all =
        referenceMode === "full"
            ? [...outer, ...inner]
            : getUniqueArchitecturalDimensions([...outer, ...inner]);
    if (millimetersPerPixel < COMPACT_DIMENSION_MILLIMETERS_PER_PIXEL) return all;

    // A rectangle has one unambiguous inner and outer span per side. Keep all
    // eight values on a phone as well: hiding either chain is less useful
    // than moving it to its dedicated, non-overlapping drafting track. The
    // compact policy below is reserved for concave rooms where several notch
    // chains genuinely compete for the same strip of paper.
    if (contour.length === 4 || referenceMode === "full") return all;

    const compact: ArchitecturalDimension[] = [];
    // On the compact sheet the outer chain duplicates the clear-face values
    // but consumes the only neighbouring tracks. Keep the room's inner chain
    // as the useful architectural source of truth.
    inner.forEach((dimension) => {
        const label = getDimensionLabelBounds(dimension);
        const lines = getDimensionLineObstacles(dimension, millimetersPerPixel);
        const clear = compact.every((existing) => {
            const existingLabel = getDimensionLabelBounds(existing);
            const existingLines = getDimensionLineObstacles(existing, millimetersPerPixel);
            return (
                !rectsOverlap(label, existingLabel, Math.max(12, millimetersPerPixel * 1.5)) &&
                !lines.some((line) => rectsOverlap(line, existingLabel)) &&
                !existingLines.some((line) => rectsOverlap(line, label))
            );
        });
        if (clear) compact.push(dimension);
    });
    return compact;
};

/**
 * Once partitions split the contour, every room is dimensioned on its own:
 * each clear face of the room gets one value inside that room, as on a
 * measured apartment plan. A single clear total across several rooms, or a
 * clear | partition | clear chain through them, would only sit on top of
 * these values and repeat what they already say.
 */
const getRoomRegionInnerDimensions = (
    regions: readonly Pick<DrawRoomRegion, "signature" | "clearEdges" | "bounds">[],
    origin: Point,
    millimetersPerPixel: number,
): ArchitecturalDimension[] => {
    const offset = Math.max(80, millimetersPerPixel * 10);
    const tickHalf = Math.max(38, millimetersPerPixel * 4);
    const labelHeight = Math.max(115, millimetersPerPixel * 18);
    // Two opposite values must leave the room's H/S label its own middle
    // band. Zoomed out too far for that, a room keeps its label and shows
    // these values again once the person zooms in.
    const lanesDepth = 2 * (offset + labelHeight);
    const minimumWidth = lanesDepth + millimetersPerPixel * 72;
    const minimumHeight = lanesDepth + millimetersPerPixel * 44;
    return regions.flatMap((region, regionIndex) =>
        region.clearEdges.flatMap((edge, edgeIndex) => {
            const vertical = edge.start.x === edge.end.x;
            const across = vertical
                ? region.bounds.right - region.bounds.left
                : region.bounds.bottom - region.bounds.top;
            if (across < (vertical ? minimumWidth : minimumHeight)) return [];
            const length =
                Math.abs(edge.end.x - edge.start.x) + Math.abs(edge.end.y - edge.start.y);
            const labelValue = formatWallLength(length);
            const labelWidth = Math.max(
                labelHeight * 1.45,
                millimetersPerPixel * (labelValue.length * 8.2 + 14),
            );
            // A partition end or a short jog has no room for a readable value;
            // the neighbouring faces already locate it.
            if (length < labelWidth + tickHalf * 2) return [];
            const start = { x: origin.x + edge.start.x, y: origin.y + edge.start.y };
            const end = { x: origin.x + edge.end.x, y: origin.y + edge.end.y };
            const { inward } = edge;
            const dimensionStart = {
                x: start.x + inward.x * offset,
                y: start.y + inward.y * offset,
            };
            const dimensionEnd = { x: end.x + inward.x * offset, y: end.y + inward.y * offset };
            return [
                {
                    id: `inner-room-${regionIndex}-${edgeIndex}`,
                    kind: "inner" as const,
                    dimensionStart,
                    dimensionEnd,
                    extensionStart: start,
                    extensionEnd: end,
                    tickStart: {
                        x: dimensionStart.x - inward.x * tickHalf,
                        y: dimensionStart.y - inward.y * tickHalf,
                    },
                    tickEnd: {
                        x: dimensionEnd.x + inward.x * tickHalf,
                        y: dimensionEnd.y + inward.y * tickHalf,
                    },
                    label: {
                        x: (dimensionStart.x + dimensionEnd.x) / 2,
                        y: (dimensionStart.y + dimensionEnd.y) / 2,
                    },
                    labelValue,
                    vertical,
                    labelWidth,
                    labelHeight,
                },
            ];
        }),
    );
};

/** An opening (or a single cursor point) on a wall, in world coordinates. */
interface DimensionCut {
    start: Point;
    end: Point;
}

/**
 * Breaks each wall value into the chain a measured plan shows: wall | opening
 * | wall, on the room's clear face and on the outer face alike. A cut belongs
 * to a dimension when it runs on the same wall, i.e. within the material
 * thickness of the face that dimension measures. A piece too short to hold
 * its value keeps its ticks and drops the label; its neighbours locate it.
 */
const splitDimensionsAtCuts = (
    dimensions: ArchitecturalDimension[],
    cuts: readonly DimensionCut[],
    thickness: number,
    millimetersPerPixel: number,
): ArchitecturalDimension[] => {
    if (!cuts.length) return dimensions;
    return dimensions.flatMap((dimension) => {
        const { vertical } = dimension;
        const along = (point: Point) => (vertical ? point.y : point.x);
        const across = (point: Point) => (vertical ? point.x : point.y);
        const from = Math.min(along(dimension.extensionStart), along(dimension.extensionEnd));
        const to = Math.max(along(dimension.extensionStart), along(dimension.extensionEnd));
        const faceAcross = across(dimension.extensionStart);
        const stops = cuts
            .filter(
                (cut) =>
                    across(cut.start) === across(cut.end) &&
                    Math.abs(across(cut.start) - faceAcross) <= thickness + 1,
            )
            .flatMap((cut) => [along(cut.start), along(cut.end)])
            .filter((value) => value > from + 1 && value < to - 1);
        if (!stops.length) return [dimension];
        const points = Array.from(new Set([from, ...stops, to].map(Math.round))).sort(
            (a, b) => a - b,
        );
        const forward = along(dimension.extensionEnd) >= along(dimension.extensionStart);
        const at = (point: Point, value: number): Point =>
            vertical ? { x: point.x, y: value } : { x: value, y: point.y };
        return points.slice(0, -1).flatMap((pieceStart, index) => {
            const pieceEnd = points[index + 1];
            const length = pieceEnd - pieceStart;
            if (length <= 0) return [];
            const [a, b] = forward ? [pieceStart, pieceEnd] : [pieceEnd, pieceStart];
            const dimensionStart = at(dimension.dimensionStart, a);
            const dimensionEnd = at(dimension.dimensionEnd, b);
            const value = formatWallLength(length);
            const labelWidth = Math.max(
                dimension.labelHeight * 1.2,
                millimetersPerPixel * (value.length * 8.2 + 10),
            );
            return [
                {
                    ...dimension,
                    id: `${dimension.id}-cut-${index}`,
                    dimensionStart,
                    dimensionEnd,
                    extensionStart: at(dimension.extensionStart, a),
                    extensionEnd: at(dimension.extensionEnd, b),
                    tickStart: at(dimension.tickStart, a),
                    tickEnd: at(dimension.tickEnd, b),
                    label: at(dimension.label, (a + b) / 2),
                    labelValue: length >= labelWidth ? value : "",
                    labelWidth,
                },
            ];
        });
    });
};

interface ClosedBranchDimension extends LiveWallDimension {
    segmentId: string;
    dimensionId: string;
}

/**
 * Closed-room chains own the perimeter. An attached T wall in an undivided
 * room contributes one concise auxiliary length; once walls split the room,
 * the rooms' own clear faces carry every value instead. Neither case revives
 * the open-graph persistent layer or its scattered thickness labels.
 */
const getClosedBranchDimensions = (
    segments: DrawWallSegment[],
    contour: Point[],
    thickness: number,
    millimetersPerPixel: number,
    viewport: CanvasViewBox,
): ClosedBranchDimension[] =>
    segments.flatMap((segment) => {
        const dimensions = getLiveWallDimensions(
            segment,
            thickness,
            millimetersPerPixel,
            null,
            [],
            viewport,
        );
        const primary = dimensions.find((dimension) => dimension.id === "length-first");
        if (!primary) return [];

        const faces = getDrawRoomWallFaceContours(contour, thickness);
        const branchHorizontal = segment.start.y === segment.end.y;
        const attachments = [segment.start, segment.end]
            .map((point, endpointIndex) => ({
                point,
                free: endpointIndex ? segment.start : segment.end,
            }))
            .map(({ point, free }) => {
                const contourIndex = contour.findIndex((start, index) => {
                    const end = contour[(index + 1) % contour.length];
                    const hostHorizontal = start.y === end.y;
                    return (
                        hostHorizontal !== branchHorizontal &&
                        graphPointLiesOnSegment(point, start, end)
                    );
                });
                return contourIndex < 0 ? null : { point, free, contourIndex };
            })
            .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

        if (attachments.length !== 1) return [];
        const [attachment] = attachments;

        // A T wall begins on a physical host face rather than in the middle
        // of its host wall. Its visible length therefore equals the selected
        // face-to-free-end distance (500 mm in the regression fixture), not
        // the 550 mm envelope of a free-standing strip with two end caps.
        if (!faces) return [{ ...primary, segmentId: segment.id, dimensionId: "t-clear-length" }];
        const hostStart = contour[attachment.contourIndex];
        const hostEnd = contour[(attachment.contourIndex + 1) % contour.length];
        const outerNormal = normalForPolygonFace(hostStart, hostEnd, polygonSignedArea(contour));
        const branchDirection = {
            x: Math.sign(attachment.free.x - attachment.point.x),
            y: Math.sign(attachment.free.y - attachment.point.y),
        };
        const branchLeavesOutward =
            branchDirection.x * outerNormal.x + branchDirection.y * outerNormal.y > 0;
        const hostFace = branchLeavesOutward ? faces.outerFaceContour : faces.innerFaceContour;
        const hostFaceStart = hostFace[attachment.contourIndex];
        const attachmentFace = branchHorizontal
            ? { x: hostFaceStart.x, y: attachment.point.y }
            : { x: attachment.point.x, y: hostFaceStart.y };
        const envelope = getWallEnvelopeFromPoints(segment.start, segment.end, thickness);
        if (!envelope)
            return [{ ...primary, segmentId: segment.id, dimensionId: "t-clear-length" }];
        const freeFace = branchHorizontal
            ? {
                  x: branchDirection.x < 0 ? envelope.left : envelope.right,
                  y: attachment.free.y,
              }
            : {
                  x: attachment.free.x,
                  y: branchDirection.y < 0 ? envelope.top : envelope.bottom,
              };
        const length =
            Math.abs(freeFace.x - attachmentFace.x) + Math.abs(freeFace.y - attachmentFace.y);
        if (!length) return [];
        const dimensionStart = primary.vertical
            ? { x: primary.dimensionStart.x, y: attachmentFace.y }
            : { x: attachmentFace.x, y: primary.dimensionStart.y };
        const dimensionEnd = primary.vertical
            ? { x: primary.dimensionEnd.x, y: freeFace.y }
            : { x: freeFace.x, y: primary.dimensionEnd.y };
        const tickHalf = Math.max(28, millimetersPerPixel * 4);
        const labelValue = formatWallLength(length);
        return [
            {
                ...primary,
                segmentId: segment.id,
                dimensionId: "t-clear-length",
                extensionStart: attachmentFace,
                extensionEnd: freeFace,
                dimensionStart,
                dimensionEnd,
                tickStart: primary.vertical
                    ? { x: dimensionStart.x - tickHalf, y: dimensionStart.y }
                    : { x: dimensionStart.x, y: dimensionStart.y - tickHalf },
                tickEnd: primary.vertical
                    ? { x: dimensionEnd.x + tickHalf, y: dimensionEnd.y }
                    : { x: dimensionEnd.x, y: dimensionEnd.y + tickHalf },
                label: {
                    x: (dimensionStart.x + dimensionEnd.x) / 2,
                    y: (dimensionStart.y + dimensionEnd.y) / 2,
                },
                labelValue,
            },
        ];
    });

const getContourBounds = (points: Point[]) => ({
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
});

const getRoomClearAreaSquareMeters = (contour: Point[], thickness: number) => {
    const faces = getDrawRoomWallFaceContours(contour, thickness);
    return faces ? Math.abs(polygonSignedArea(faces.innerFaceContour)) / 1_000_000 : 0;
};

const formatRoomArea = (areaSquareMeters: number) =>
    `S=${(areaSquareMeters < 10 ? smallAreaFormatter : largeAreaFormatter).format(areaSquareMeters)} м²`;

/**
 * SVG text uses drawing-world units, unlike an HTML foreignObject. Keep the
 * metrics in that same world space so the label follows the room at every
 * zoom, while capping the backing to the largest uninterrupted clear cell of
 * its own region. The cap is what prevents an L region's label from crossing
 * a partition just because its bounding box is large.
 */
const getRoomRegionLabelPlacement = (
    region: {
        x: number;
        y: number;
        name?: string;
        areaSquareMillimeters: number;
        labelBounds: ScreenRect;
    },
    millimetersPerPixel: number,
    screenMillimetersPerPixel: number,
    dimensionExclusions: ScreenRect[] = [],
): RoomRegionLabelPlacement | null => {
    const clearBounds = region.labelBounds;
    const clearWidth = clearBounds.right - clearBounds.left;
    const clearHeight = clearBounds.bottom - clearBounds.top;
    if (clearWidth <= 0 || clearHeight <= 0) return null;

    const heightValue = `H=${Math.round(ROOM_CEILING_HEIGHT_MM / 10)}`;
    const areaValue = formatRoomArea(region.areaSquareMillimeters / 1_000_000);
    const title = region.name && !/^Помещение \d+$/.test(region.name) ? region.name : null;
    const lineCount = title ? 3 : 2;
    const clearShortestSide = Math.min(clearWidth, clearHeight);
    const horizontalPadding = clamp(clearShortestSide * 0.04, 24, 48);
    const verticalPadding = clamp(clearShortestSide * 0.03, 18, 40);
    const screenFontCap = screenMillimetersPerPixel * ROOM_LABEL_MAX_SCREEN_FONT_PX;
    const desiredFont = Math.min(
        ROOM_LABEL_MAX_FONT_MM,
        screenFontCap,
        clearWidth * 0.145,
        clearHeight * 0.2,
    );
    // Compact CAD labels deliberately use metric-only text and a tight
    // letter-spacing, so a 14 px S=… value can still fit a narrow 85 cm bay.
    const areaCharacterWidth = Math.max(areaValue.length * 0.52, (title?.length ?? 0) * 0.56);
    const maximumByWidth = (clearWidth - horizontalPadding * 2) / areaCharacterWidth;
    const linesHeight = lineCount === 3 ? 3.8 : 2.55;
    const maximumByHeight = (clearHeight - verticalPadding * 2) / linesHeight;
    const fontSize = Math.min(desiredFont, maximumByWidth, maximumByHeight);
    if (!Number.isFinite(fontSize) || fontSize < Math.min(ROOM_LABEL_MIN_FONT_MM, screenFontCap))
        return null;

    const width =
        Math.max(heightValue.length * fontSize * 0.56, areaCharacterWidth * fontSize) +
        horizontalPadding * 2;
    // Chromium's SVG text box includes the painted glyph ascenders/descenders
    // beyond its nominal line height. Reserve that real visual height so the
    // white backing remains a full container at every zoom level.
    const height = fontSize * linesHeight + verticalPadding * 2;
    if (width > clearWidth || height > clearHeight) return null;

    // Clear-face bounds already exclude material. Do not spend the few
    // remaining millimetres in a narrow 107 cm bay on an artificial inset.
    const inset = 0;
    const minX = clearBounds.left + width / 2 + inset;
    const maxX = clearBounds.right - width / 2 - inset;
    const minY = clearBounds.top + height / 2 + inset;
    const maxY = clearBounds.bottom - height / 2 - inset;
    if (minX > maxX || minY > maxY) return null;

    const preferred = {
        x: clamp(region.x, minX, maxX),
        y: clamp(region.y, minY, maxY),
    };
    const uniqueCoordinates = (values: number[]) =>
        Array.from(new Set(values.map((value) => Number(value.toFixed(3)))));
    const horizontalCandidates = uniqueCoordinates([
        preferred.x,
        minX,
        maxX,
        (minX + preferred.x) / 2,
        (maxX + preferred.x) / 2,
    ]);
    const verticalCandidates = uniqueCoordinates([
        preferred.y,
        maxY,
        minY,
        (maxY + preferred.y) / 2,
        (minY + preferred.y) / 2,
    ]);
    const backingFor = (x: number, y: number): ScreenRect => ({
        left: x - width / 2,
        right: x + width / 2,
        top: y - height / 2,
        bottom: y + height / 2,
    });
    const exclusionPadding = Math.max(8, millimetersPerPixel * 1.2);
    const candidate = horizontalCandidates
        .flatMap((x) => verticalCandidates.map((y) => ({ x, y })))
        .sort(
            (first, second) =>
                (first.x - preferred.x) ** 2 +
                    (first.y - preferred.y) ** 2 -
                    ((second.x - preferred.x) ** 2 + (second.y - preferred.y) ** 2) ||
                // When a top partition chain blocks the centre, prefer the
                // lower clean bay before moving toward the chain again.
                second.y - first.y,
        )
        .find((position) =>
            dimensionExclusions.every(
                (exclusion) =>
                    !rectsOverlap(backingFor(position.x, position.y), exclusion, exclusionPadding),
            ),
        );
    if (!candidate) return null;

    return {
        x: candidate.x,
        y: candidate.y,
        width,
        height,
        fontSize,
        title,
        heightValue,
        areaValue,
        clearBounds,
    };
};

/**
 * Finds a visual centre in the usable (inner-face) polygon, not merely in its
 * bounding box. Candidates are rejected whenever the card would touch a
 * displayed dimension label or line. This is intentionally recalculated from
 * millimetres-per-pixel, so the mobile fallback is a genuine screen-space
 * policy and not a hard-coded L-room offset.
 */
const getRoomSummaryPlacement = (
    contour: Point[],
    thickness: number,
    millimetersPerPixel: number,
    screenMillimetersPerPixel: number,
    dimensions: PositionedDimension[],
    view: CanvasViewBox,
): RoomSummaryPlacement | null => {
    if (!contour.length) return null;
    const faces = getDrawRoomWallFaceContours(contour, thickness);
    if (!faces) return null;
    const usableContour = faces.innerFaceContour;
    const bounds = getContourBounds(usableContour);
    const areaSquareMeters = getRoomClearAreaSquareMeters(contour, thickness);
    const heightValue = `H=${Math.round(ROOM_CEILING_HEIGHT_MM / 10)}`;
    const areaValue = formatRoomArea(areaSquareMeters);
    const smallestClearSpan = Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top);
    const baseFontSize = Math.min(
        clamp(smallestClearSpan * 0.12, ROOM_LABEL_MIN_FONT_MM, ROOM_LABEL_MAX_FONT_MM),
        screenMillimetersPerPixel * ROOM_LABEL_MAX_SCREEN_FONT_PX,
    );
    const heightFontSize = baseFontSize * 0.95;
    const areaFontSize = baseFontSize * 1.08;
    const heightOffset = baseFontSize * 0.72;
    const areaOffset = baseFontSize * 0.82;
    // These conservative glyph metrics deliberately exceed Chromium's
    // painted SVG bounds. The physical clear bay may be too small for the
    // callout, but the exterior callout must never shrink its backing below
    // the H/S text that the reader actually sees.
    const glyphBounds = (value: string, fontSize: number, offset: number): ScreenRect => ({
        left: -value.length * fontSize * 0.31,
        right: value.length * fontSize * 0.31,
        top: offset - fontSize * 0.65,
        bottom: offset + fontSize * 0.65,
    });
    const heightGlyphBounds = glyphBounds(heightValue, heightFontSize, -heightOffset);
    const areaGlyphBounds = glyphBounds(areaValue, areaFontSize, areaOffset);
    const contentBounds = {
        left: Math.min(heightGlyphBounds.left, areaGlyphBounds.left),
        right: Math.max(heightGlyphBounds.right, areaGlyphBounds.right),
        top: Math.min(heightGlyphBounds.top, areaGlyphBounds.top),
        bottom: Math.max(heightGlyphBounds.bottom, areaGlyphBounds.bottom),
    };
    const summaryPadding = clamp(baseFontSize * 0.32, 24, 56);
    const width = contentBounds.right - contentBounds.left + summaryPadding * 2;
    const height = contentBounds.bottom - contentBounds.top + summaryPadding * 2;
    const halfDiagonal = Math.hypot(width / 2, height / 2);
    const candidates: Point[] = [];
    const cardFor = (point: Point): ScreenRect => ({
        left: point.x - width / 2,
        right: point.x + width / 2,
        top: point.y - height / 2,
        bottom: point.y + height / 2,
    });
    const textBoundsFor = (point: Point) => [
        {
            left: point.x + heightGlyphBounds.left,
            right: point.x + heightGlyphBounds.right,
            top: point.y + heightGlyphBounds.top,
            bottom: point.y + heightGlyphBounds.bottom,
        },
        {
            left: point.x + areaGlyphBounds.left,
            right: point.x + areaGlyphBounds.right,
            top: point.y + areaGlyphBounds.top,
            bottom: point.y + areaGlyphBounds.bottom,
        },
    ];
    const calloutClearsDimensions = (point: Point) =>
        [cardFor(point), ...textBoundsFor(point)].every((rect) =>
            dimensions.every((dimension) => !dimensionIntersectsRect(dimension, rect)),
        );

    // A regular candidate lattice avoids the misleading bounding-box centre
    // inside concave niches, while the small centre candidate keeps a simple
    // rectangle visually balanced when it is truly clear.
    for (let yRatio = 0.1; yRatio < 0.95; yRatio += 0.1) {
        for (let xRatio = 0.1; xRatio < 0.95; xRatio += 0.1) {
            candidates.push({
                x: bounds.left + (bounds.right - bounds.left) * xRatio,
                y: bounds.top + (bounds.bottom - bounds.top) * yRatio,
            });
        }
    }
    candidates.push({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });

    const safeCandidates = candidates
        .map((point) => {
            const card = cardFor(point);
            if (!rectFitsPolygon(card, usableContour)) return null;
            if (!calloutClearsDimensions(point)) return null;
            const wallClearance = usableContour.reduce((minimum, start, index) => {
                const end = usableContour[(index + 1) % usableContour.length];
                return Math.min(minimum, distanceToSegment(point, start, end));
            }, Number.POSITIVE_INFINITY);
            if (wallClearance < halfDiagonal + millimetersPerPixel * 7) return null;
            return { point, clearance: wallClearance };
        })
        .filter((candidate): candidate is { point: Point; clearance: number } => Boolean(candidate))
        .sort((first, second) => second.clearance - first.clearance);

    // A narrow clear bay can honestly show all four inner face dimensions or
    // a two-line H/S summary, but not both in the same physical space. Keep
    // the chain authoritative and move the summary to the nearest clear
    // exterior callout lane instead of falling back to a colliding centre.
    const dimensionBounds = dimensions.flatMap((dimension) => [
        getDimensionLabelBounds(dimension),
        getLineBounds(
            dimension.extensionStart,
            dimension.dimensionStart,
            Math.max(8, millimetersPerPixel),
        ),
        getLineBounds(
            dimension.extensionEnd,
            dimension.dimensionEnd,
            Math.max(8, millimetersPerPixel),
        ),
        getLineBounds(
            dimension.dimensionStart,
            dimension.dimensionEnd,
            Math.max(8, millimetersPerPixel),
        ),
    ]);
    const occupiedBounds = dimensionBounds.reduce(
        (occupied, item) => ({
            left: Math.min(occupied.left, item.left),
            right: Math.max(occupied.right, item.right),
            top: Math.min(occupied.top, item.top),
            bottom: Math.max(occupied.bottom, item.bottom),
        }),
        { ...bounds },
    );
    const exteriorGap = Math.max(24, millimetersPerPixel * 3);
    const centre = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
    const exteriorCandidates = [
        { x: centre.x, y: occupiedBounds.bottom + height / 2 + exteriorGap },
        { x: centre.x, y: occupiedBounds.top - height / 2 - exteriorGap },
        { x: occupiedBounds.right + width / 2 + exteriorGap, y: centre.y },
        { x: occupiedBounds.left - width / 2 - exteriorGap, y: centre.y },
    ];
    const cardFitsView = (card: ScreenRect) =>
        card.left >= view.x &&
        card.right <= view.x + view.width &&
        card.top >= view.y &&
        card.bottom <= view.y + view.height;
    const exteriorSummary = exteriorCandidates.find((point) => {
        const card = cardFor(point);
        return cardFitsView(card) && calloutClearsDimensions(point);
    });
    const chosen = safeCandidates[0] ?? (exteriorSummary ? { point: exteriorSummary } : null);
    if (!chosen) return null;
    return {
        ...chosen.point,
        width,
        height,
        heightFontSize,
        areaFontSize,
        heightOffset,
        areaOffset,
        heightValue,
        areaValue,
    };
};

const DrawRoom: React.FC = () => {
    const router = useRouter();
    const boardRef = useRef<SVGSVGElement>(null);
    const [tool, setTool] = useState<Tool>("wall");
    const [activeToolGroup, setActiveToolGroup] = useState<ToolGroup>("walls");
    const [selectedRegionSignature, setSelectedRegionSignature] = useState<string | null>(null);
    // On narrow screens a group sheet covers much of the canvas, so it folds
    // away once a tool is picked and its group button toggles it back.
    const [toolSheetCollapsed, setToolSheetCollapsed] = useState(false);
    const [toolSheetOverlaysCanvas, setToolSheetOverlaysCanvas] = useState(false);
    const autoFitPendingRef = useRef(false);
    // Set when a whole room appears at once (template, converted room).
    const fitAfterSceneChangeRef = useRef(false);
    const [templateOpen, setTemplateOpen] = useState(false);
    const [templateError, setTemplateError] = useState("");
    const [newerPlannerRoom, setNewerPlannerRoom] = useState<Room | null>(null);
    const [selectedDoorKind, setSelectedDoorKind] = useState<DoorKind>("room");
    const [slidingMount, setSlidingMount] =
        useState<NonNullable<DoorOpening["slidingMount"]>>("inward");
    const [slidingDirection, setSlidingDirection] =
        useState<NonNullable<DoorOpening["slidingDirection"]>>("start");
    const [keyboardEntryOpen, setKeyboardEntryOpen] = useState(false);
    const [keyboardTool, setKeyboardTool] = useState<KeyboardTool>("wall");
    const [keyboardEntry, setKeyboardEntry] = useState({
        startX: "1000",
        startY: "1000",
        endX: "5000",
        endY: "1000",
    });
    const [history, setHistory] = useState<History>({ past: [], present: EMPTY_SCENE, future: [] });
    const [editorSessionReady, setEditorSessionReady] = useState(false);
    const wallDrawingRef = useRef(false);
    const wallDrawingAnchorRef = useRef<{
        start: Point;
        segmentCount: number;
        attachment: WallAnchorAttachment;
    } | null>(null);
    const capturedPointerRef = useRef<number | null>(null);
    const contourWallDragRef = useRef<WallDrag | null>(null);
    const panningRef = useRef(false);
    const panPointerRef = useRef<number | null>(null);
    const panStartRef = useRef<{
        pointerId: number;
        startClientX: number;
        startClientY: number;
        startViewBox: CanvasViewBox;
    } | null>(null);
    const sceneForInteractionRef = useRef<Scene>(EMPTY_SCENE);
    const [wallDrawingAnchorPoint, setWallDrawingAnchorPoint] = useState<Point | null>(null);
    const [wallDrawingAnchorAttachment, setWallDrawingAnchorAttachment] =
        useState<WallAnchorAttachment | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [viewBox, setViewBox] = useState<CanvasViewBox>(DEFAULT_VIEW_BOX);
    const [gridPresentationLevel, setGridPresentationLevel] =
        useState<DrawRoomGridPresentationLevel | null>(null);
    const viewInitializedRef = useRef(false);
    const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
    const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
    const [selectedOpening, setSelectedOpening] = useState<SelectedOpening | null>(null);
    const [selectedRadiatorId, setSelectedRadiatorId] = useState<string | null>(null);
    const [selectedContourWallEdge, setSelectedContourWallEdge] = useState<number | null>(null);
    const [selectedSegmentWallId, setSelectedSegmentWallId] = useState<string | null>(null);
    const [activeContourWallGrab, setActiveContourWallGrab] = useState<{
        edgeIndex: number;
        grab: ContourWallGrab;
    } | null>(null);
    const openingDragRef = useRef<
        | (SelectedOpening & { startPoint: Point; startOffset: number; allowedOffsets?: number[] })
        | null
    >(null);
    const [openingDragSelection, setOpeningDragSelection] = useState<SelectedOpening | null>(null);
    const [openingDragPreview, setOpeningDragPreview] = useState<OpeningPreview | null>(null);
    const [notice, setNotice] = useState(
        "Зажмите левую кнопку и ведите по сетке — стена рисуется сразу под курсором.",
    );
    const [autosaveStatus, setAutosaveStatus] = useState<"loading" | "saved" | "error">("loading");
    const [layers, setLayers] = useState(DEFAULT_DRAWING_LAYERS);
    const [measuring, setMeasuring] = useState(false);
    useEffect(() => {
        if (tool !== "select" || activeToolGroup !== "walls") setMeasuring(false);
    }, [tool, activeToolGroup]);
    const [spacePan, setSpacePan] = useState(false);
    const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
    const viewBoxRef = useRef(DEFAULT_VIEW_BOX);
    const wheelZoomFrameRef = useRef<number | null>(null);
    const zoomStatusRef = useRef<HTMLSpanElement | null>(null);
    const wheelZoomSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingWheelZoomRef = useRef<PendingWheelZoom[]>([]);

    const scene = history.present;
    const sceneSnapMm = getSceneSnapMm(scene);
    const previews = useMemo(() => getRoomPreviews(scene), [scene]);
    const furnitureDoorObstacles = useMemo(
        () =>
            previews.flatMap((owner) =>
                owner.room.doors.flatMap((door) =>
                    getDoorFurnitureObstacles(door, owner.room).map((rect) => ({
                        ...rect,
                        x: rect.x + owner.origin.x,
                        y: rect.y + owner.origin.y,
                    })),
                ),
            ),
        [previews],
    );
    const furnitureRadiatorObstacles = useMemo(
        () =>
            previews.flatMap((owner) =>
                (owner.room.radiators ?? []).flatMap((radiator) =>
                    [
                        getRadiatorBody(radiator, owner.room),
                        getRadiatorServiceObstacle(radiator, owner.room),
                    ].map((rect) => ({
                        ...rect,
                        x: rect.x + owner.origin.x,
                        y: rect.y + owner.origin.y,
                    })),
                ),
            ),
        [previews],
    );
    const preview = previews[0] ?? null;
    const roomRegions = useMemo(() => (preview ? getDrawRoomRegions(preview.room) : []), [preview]);
    const renderedRoomRegions = useMemo(
        () =>
            previews.flatMap((owner) =>
                getDrawRoomRegions(owner.room).map((region) => ({
                    ...region,
                    signature: regionPrefix(owner) + region.signature,
                    buildingId: regionPrefix(owner),
                    origin: owner.origin,
                    x: owner.origin.x + region.center.x,
                    y: owner.origin.y + region.center.y,
                    bounds: {
                        left: owner.origin.x + region.bounds.left,
                        right: owner.origin.x + region.bounds.right,
                        top: owner.origin.y + region.bounds.top,
                        bottom: owner.origin.y + region.bounds.bottom,
                    },
                    labelBounds: {
                        left: owner.origin.x + region.labelBounds.left,
                        right: owner.origin.x + region.labelBounds.right,
                        top: owner.origin.y + region.labelBounds.top,
                        bottom: owner.origin.y + region.labelBounds.bottom,
                    },
                })),
            ),
        [previews],
    );
    const roomRegionGroups = useMemo(
        () =>
            previews
                .map((owner, index) => ({
                    id: regionPrefix(owner),
                    name: `Постройка ${index + 1}`,
                    regions: renderedRoomRegions.filter(
                        (region) => region.buildingId === regionPrefix(owner),
                    ),
                }))
                .filter((group) => group.regions.length > 0),
        [previews, renderedRoomRegions],
    );
    const boundarySegments = useMemo(
        () => (preview ? getRoomBoundarySegments(preview.room) : []),
        [preview],
    );
    const hasBoundary = boundarySegments.length > 0;
    const selectedOpeningData = useMemo(() => {
        if (!selectedOpening) return null;
        const item =
            selectedOpening.kind === "door"
                ? scene.doors.find((door) => door.id === selectedOpening.id)
                : scene.windows.find((window) => window.id === selectedOpening.id);
        if (!item) return null;
        const owner = openingOwner(previews, item);
        const segment = owner ? getRoomSegment(owner.room, item) : null;
        return segment && owner ? { ...selectedOpening, item, segment, owner } : null;
    }, [previews, scene.doors, scene.windows, selectedOpening]);
    const selectedOpeningError = useMemo(
        () =>
            selectedOpeningData?.kind === "door"
                ? getDoorCandidateError(
                      selectedOpeningData.owner.room,
                      selectedOpeningData.item as DoorOpening,
                  )
                : null,
        [selectedOpeningData],
    );
    const fitViewBox = useMemo(() => getFitViewBox(canvasSize), [canvasSize]);
    const zoomPercent = useMemo(() => {
        return Math.round((fitViewBox.width / viewBox.width) * 100);
    }, [fitViewBox.width, viewBox.width]);
    const millimetersPerPixel = useMemo(
        () =>
            Math.max(
                viewBox.width / Math.max(canvasSize.width, 1),
                viewBox.height / Math.max(canvasSize.height, 1),
            ),
        [canvasSize.height, canvasSize.width, viewBox.height, viewBox.width],
    );
    const annotationMillimetersPerPixel = Math.min(
        millimetersPerPixel,
        MAX_ANNOTATION_MM_PER_PIXEL,
    );
    const gridPresentation = useMemo(
        () => getDrawRoomGridPresentation(millimetersPerPixel, gridPresentationLevel),
        [gridPresentationLevel, millimetersPerPixel],
    );
    const openingPreview = useMemo<OpeningPreview | null>(() => {
        if (!preview || !cursorPoint || (tool !== "door" && tool !== "window")) return null;
        const target = openingTarget(previews, cursorPoint);
        if (!target) return null;
        const owner = target.owner;
        const width = getOpeningWidth(tool, undefined, selectedDoorKind, sceneSnapMm);
        const resolved = resolveOpeningOffset(
            scopedOpeningScene(scene, owner),
            target.segment,
            target.offset,
            width,
        );
        const partition = owner.room.partitions?.some(
            (candidate) => candidate.id === target.segment.id,
        );
        const candidate =
            tool === "door" && resolved.valid
                ? createDoorOpening(
                      "door-preview",
                      target.segment,
                      resolved.offset,
                      width,
                      selectedDoorKind,
                      Boolean(partition),
                      slidingMount,
                      slidingDirection,
                  )
                : null;
        const materialError = candidate ? getDoorCandidateError(owner.room, candidate) : null;
        return {
            origin: owner.origin,
            kind: tool,
            ...(tool === "door"
                ? {
                      doorKind: selectedDoorKind,
                      swingDirection: "inward" as const,
                      slidingMount,
                      slidingDirection,
                  }
                : {}),
            segment: target.segment,
            width,
            ...resolved,
            valid: resolved.valid && !materialError,
            ...(materialError ? { message: materialError } : {}),
        };
    }, [
        cursorPoint,
        previews,
        preview,
        scene,
        sceneSnapMm,
        selectedDoorKind,
        slidingMount,
        slidingDirection,
        tool,
    ]);
    useEffect(() => {
        setGridPresentationLevel((current) =>
            current === gridPresentation.level ? current : gridPresentation.level,
        );
    }, [gridPresentation.level]);
    // Material thickness is scene-owned: new constructive drawings use 10 cm,
    // while restored pre-constructive drafts keep their original 5 cm faces.
    const renderedWallThickness = getSceneWallThickness(scene);
    const contourWallEditHitRadius = Math.max(
        millimetersPerPixel * 22,
        renderedWallThickness * 0.8,
    );
    const contourWallEditVisualRadius = Math.max(
        millimetersPerPixel * 5.5,
        renderedWallThickness * 0.3,
    );
    const wallOpeningMaskBounds = useMemo(() => {
        // `maskUnits="userSpaceOnUse"` makes SVG's percentage defaults depend
        // on a mask region rather than the board world. At an altered viewBox
        // that implicit region can clip the hatched union itself. Give the
        // region an explicit world-space envelope, with enough material bleed
        // around the visible CAD plane. This also covers walls drawn in a
        // responsive viewport gutter rather than only in the old artboard.
        const bleed = renderedWallThickness;
        return {
            x: viewBox.x - bleed,
            y: viewBox.y - bleed,
            width: viewBox.width + bleed * 2,
            height: viewBox.height + bleed * 2,
        };
    }, [renderedWallThickness, viewBox.height, viewBox.width, viewBox.x, viewBox.y]);
    const constructionGridOrigin =
        renderedWallThickness === WALL_THICKNESS_MM ? 0 : DRAW_ROOM_GRID_ORIGIN_MM;
    const previewContourPoints = useMemo(
        () => (preview ? getPreviewContourPoints(preview) : []),
        [preview],
    );
    const wallMoveGrip = useCallback(
        (start: Point, end: Point): Point => {
            const horizontal = start.y === end.y;
            const axis = horizontal ? "x" : "y";
            const cross = horizontal ? "y" : "x";
            const low = Math.min(start[axis], end[axis]),
                high = Math.max(start[axis], end[axis]);
            const centre = (low + high) / 2;
            const blocked = previews.flatMap((owner) =>
                [...owner.room.doors, ...owner.room.windows].flatMap((item) => {
                    const segment = getRoomSegment(owner.room, item);
                    if (!segment) return [];
                    const line = openingLine(segment, owner.origin, item.offset, item.width);
                    if (
                        Math.abs(line.start[cross] - start[cross]) > renderedWallThickness ||
                        Math.abs(line.end[cross] - start[cross]) > renderedWallThickness
                    )
                        return [];
                    return [
                        [
                            Math.min(line.start[axis], line.end[axis]) - contourWallEditHitRadius,
                            Math.max(line.start[axis], line.end[axis]) + contourWallEditHitRadius,
                        ],
                    ];
                }),
            );
            if (!blocked.some(([a, b]) => centre >= a && centre <= b))
                return { ...start, [axis]: centre };
            let free = [[low + contourWallEditHitRadius, high - contourWallEditHitRadius]];
            blocked.forEach(([a, b]) => {
                free = free.flatMap(([from, to]) =>
                    b <= from || a >= to
                        ? [[from, to]]
                        : [
                              [from, Math.min(to, a)],
                              [Math.max(from, b), to],
                          ].filter(([x, y]) => y > x),
                );
            });
            const best = free
                .filter(([a, b]) => b > a)
                .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
            return { ...start, [axis]: best ? (best[0] + best[1]) / 2 : centre };
        },
        [previews, renderedWallThickness, contourWallEditHitRadius],
    );
    const selectedContourWall = useMemo(() => {
        if (!preview || selectedContourWallEdge === null) return null;
        const start = preview.contour[selectedContourWallEdge];
        const end = preview.contour[(selectedContourWallEdge + 1) % preview.contour.length];
        return {
            edgeIndex: selectedContourWallEdge,
            start,
            end,
            middle: wallMoveGrip(start, end),
        };
    }, [preview, selectedContourWallEdge, wallMoveGrip]);
    const selectedSegmentWall = useMemo(() => {
        if (selectedSegmentWallId === null) return null;
        const segment = getDrawWallRun(scene.segments, selectedSegmentWallId);
        if (!segment) return null;
        return {
            segmentId: selectedSegmentWallId,
            segmentIds: segment.segmentIds,
            start: { ...segment.start },
            end: { ...segment.end },
            middle: wallMoveGrip(segment.start, segment.end),
        };
    }, [scene.segments, selectedSegmentWallId, wallMoveGrip]);
    const selectedWallInspector =
        tool === "select" &&
        !selectedOpening &&
        Boolean(selectedSegmentWall ?? selectedContourWall);
    const closedRoomArea = useMemo(
        () =>
            preview
                ? formatRoomArea(
                      roomRegions.length
                          ? roomRegions.reduce(
                                (total, region) => total + region.areaSquareMillimeters,
                                0,
                            ) / 1_000_000
                          : getRoomClearAreaSquareMeters(
                                previewContourPoints,
                                renderedWallThickness,
                            ),
                  )
                : null,
        [preview, previewContourPoints, renderedWallThickness, roomRegions],
    );
    const closedRoomBranchSegments = useMemo(
        () =>
            preview
                ? scene.segments.filter(
                      (segment) => !isGraphSegmentOnClosedContour(segment, previewContourPoints),
                  )
                : [],
        [preview, previewContourPoints, scene.segments],
    );
    const detachedOpenWallSegments = useMemo(() => {
        if (!preview) return scene.segments;
        return getConnectedWallComponents(scene.segments)
            .filter(
                (component) => !wallComponentTouchesClosedContour(component, previewContourPoints),
            )
            .flat();
    }, [preview, previewContourPoints, scene.segments]);
    const closedWallUnionPath = useMemo(
        () => getClosedWallUnionPath(previewContourPoints, renderedWallThickness),
        [previewContourPoints, renderedWallThickness],
    );
    const closedWallMaterialPath = useMemo(
        () =>
            closedRoomBranchSegments.length
                ? getOpenWallUnionPath(scene.segments, renderedWallThickness)
                : closedWallUnionPath,
        [
            closedRoomBranchSegments.length,
            closedWallUnionPath,
            renderedWallThickness,
            scene.segments,
        ],
    );
    const dimensionFontSize = useMemo(
        () => annotationMillimetersPerPixel * DIMENSION_FONT_PX,
        [annotationMillimetersPerPixel],
    );
    const drawingExtentMm = useMemo(() => {
        const points = scene.segments.flatMap((segment) => [segment.start, segment.end]);
        if (!points.length) return 0;
        const bounds = getContourBounds(points);
        return Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top);
    }, [scene.segments]);
    const showCommittedDimensions =
        dimensionFontSize / millimetersPerPixel >= MIN_READABLE_ANNOTATION_PX &&
        drawingExtentMm / millimetersPerPixel >=
            Math.min(MIN_ANNOTATED_DRAWING_PX, canvasSize.width * 0.4);
    // Committed annotations belong to the drawing, not to the camera.
    // A viewport-clipped extension must not remove/reposition the entire
    // dimension when panning. Only live drawing hints use the viewport.
    const dimensionLayoutBounds = useMemo<CanvasViewBox>(() => {
        const points = scene.segments.flatMap((segment) => [segment.start, segment.end]);
        if (!points.length) return DEFAULT_VIEW_BOX;
        const bounds = getContourBounds(points);
        const padding = Math.max(renderedWallThickness * 4, annotationMillimetersPerPixel * 320);
        return {
            x: bounds.left - padding,
            y: bounds.top - padding,
            width: bounds.right - bounds.left + padding * 2,
            height: bounds.bottom - bounds.top + padding * 2,
        };
    }, [scene.segments, renderedWallThickness, annotationMillimetersPerPixel]);
    const persistentWallDimensions = useMemo(
        () =>
            getPersistentWallDimensions(
                detachedOpenWallSegments,
                renderedWallThickness,
                dimensionLayoutBounds,
                annotationMillimetersPerPixel,
                !preview,
            ),
        [
            detachedOpenWallSegments,
            annotationMillimetersPerPixel,
            preview,
            renderedWallThickness,
            dimensionLayoutBounds,
        ],
    );
    const closedRoomDimensions = useMemo(
        () =>
            preview
                ? getClosedRoomDimensions(
                      previewContourPoints,
                      renderedWallThickness,
                      annotationMillimetersPerPixel,
                  )
                : [],
        [annotationMillimetersPerPixel, preview, previewContourPoints, renderedWallThickness],
    );
    // Partitions that split the contour hand the clear values over to each room.
    const roomRegionInnerDimensions = useMemo(
        () =>
            preview && roomRegions.length > 1
                ? getRoomRegionInnerDimensions(
                      roomRegions,
                      preview.origin,
                      annotationMillimetersPerPixel,
                  )
                : [],
        [annotationMillimetersPerPixel, preview, roomRegions],
    );
    const closedBranchDimensions = useMemo(
        () =>
            preview && roomRegionInnerDimensions.length === 0
                ? getClosedBranchDimensions(
                      closedRoomBranchSegments,
                      previewContourPoints,
                      renderedWallThickness,
                      annotationMillimetersPerPixel,
                      dimensionLayoutBounds,
                  )
                : [],
        [
            closedRoomBranchSegments,
            annotationMillimetersPerPixel,
            preview,
            previewContourPoints,
            renderedWallThickness,
            dimensionLayoutBounds,
            roomRegionInnerDimensions.length,
        ],
    );
    const displayedClosedRoomDimensions = useMemo(
        () =>
            roomRegionInnerDimensions.length
                ? [
                      ...closedRoomDimensions.filter((dimension) => dimension.kind === "outer"),
                      ...roomRegionInnerDimensions,
                  ]
                : closedRoomDimensions,
        [closedRoomDimensions, roomRegionInnerDimensions],
    );
    const compactClosedDimensionFallback =
        Boolean(preview) &&
        previewContourPoints.length > 0 &&
        displayedClosedRoomDimensions.length === 0;
    const compactDimensionFallback = compactClosedDimensionFallback;
    const roomRegionDimensionExclusions = useMemo(
        () =>
            showCommittedDimensions
                ? getRoomRegionDimensionExclusions(
                      [...displayedClosedRoomDimensions, ...closedBranchDimensions],
                      annotationMillimetersPerPixel,
                  )
                : [],
        [
            closedBranchDimensions,
            displayedClosedRoomDimensions,
            annotationMillimetersPerPixel,
            showCommittedDimensions,
        ],
    );
    const roomRegionLabelPlacements = useMemo(
        () =>
            renderedRoomRegions.flatMap((region) => {
                const label = getRoomRegionLabelPlacement(
                    region,
                    annotationMillimetersPerPixel,
                    millimetersPerPixel,
                    roomRegionDimensionExclusions,
                );
                return label ? [{ region, label }] : [];
            }),
        [
            annotationMillimetersPerPixel,
            millimetersPerPixel,
            renderedRoomRegions,
            roomRegionDimensionExclusions,
        ],
    );
    const roomSummary = useMemo(() => {
        // A single clean room retains the large, central H/S drafting mark.
        // Once the same face geometry derives multiple clear regions, each
        // owns its H/S label so no total silently includes partition material.
        // Do not infer this from graph branches: a divider can be split into
        // contour attachments while still being a real room partition.
        if (!preview || renderedRoomRegions.length > 1) return null;
        return getRoomSummaryPlacement(
            previewContourPoints,
            renderedWallThickness,
            annotationMillimetersPerPixel,
            millimetersPerPixel,
            showCommittedDimensions
                ? [...displayedClosedRoomDimensions, ...closedBranchDimensions]
                : [],
            viewBox,
        );
    }, [
        closedBranchDimensions,
        displayedClosedRoomDimensions,
        annotationMillimetersPerPixel,
        millimetersPerPixel,
        preview,
        previewContourPoints,
        renderedRoomRegions.length,
        renderedWallThickness,
        showCommittedDimensions,
        viewBox,
    ]);
    const renderedOpenings = useMemo<RenderedOpening[]>(() => {
        if (!preview) return [];
        const resolve = (item: DoorOpening | WindowOpening) => {
            const owner = openingOwner(previews, item);
            const segment = owner ? getRoomSegment(owner.room, item) : null;
            return segment && owner ? { segment, origin: owner.origin } : null;
        };
        const doors: RenderedOpening[] = scene.doors.reduce<RenderedOpening[]>((entries, item) => {
            const resolved = resolve(item);
            if (resolved) entries.push({ kind: "door", item, ...resolved });
            return entries;
        }, []);
        const windows: RenderedOpening[] = scene.windows.reduce<RenderedOpening[]>(
            (entries, item) => {
                const resolved = resolve(item);
                if (resolved) entries.push({ kind: "window", item, ...resolved });
                return entries;
            },
            [],
        );
        const entries: RenderedOpening[] = [...doors, ...windows];
        if (openingDragPreview && openingDragSelection) {
            const drag = openingDragSelection;
            return entries.map((entry) =>
                entry.kind === drag.kind && entry.item.id === drag.id
                    ? {
                          ...entry,
                          item: { ...entry.item, offset: openingDragPreview.offset },
                          segment: openingDragPreview.segment,
                          preview: true,
                          previewValid: openingDragPreview.valid,
                      }
                    : entry,
            ) as RenderedOpening[];
        }
        return entries;
    }, [openingDragPreview, openingDragSelection, preview, previews, scene.doors, scene.windows]);
    // Every door and window splits the values of its wall into a chain, so
    // the drawing always says where each opening sits. The opening being
    // placed or dragged takes part too: its chain follows the cursor. So does
    // the wall tool's cursor resting on a wall, before a partition is started:
    // its chain says how far the new wall would be from each corner.
    const wallHoverCut =
        tool === "wall" && hoverPoint && !wallDrawingAnchorPoint ? hoverPoint : null;
    const openingChainDimensions = useMemo(() => {
        const cuts: DimensionCut[] = renderedOpenings.map((opening) =>
            openingLine(opening.segment, opening.origin, opening.item.offset, opening.item.width),
        );
        if (openingPreview) {
            cuts.push(
                openingLine(
                    openingPreview.segment,
                    openingPreview.origin,
                    openingPreview.offset,
                    openingPreview.width,
                ),
            );
        }
        if (wallHoverCut) cuts.push({ start: wallHoverCut, end: wallHoverCut });
        return splitDimensionsAtCuts(
            displayedClosedRoomDimensions,
            cuts,
            renderedWallThickness,
            annotationMillimetersPerPixel,
        );
    }, [
        annotationMillimetersPerPixel,
        displayedClosedRoomDimensions,
        openingPreview,
        renderedOpenings,
        renderedWallThickness,
        wallHoverCut,
    ]);
    // Keep the diagonal material legible at every zoom level: 8px between
    // hatches avoids the mobile aliasing that turned narrow vertical walls into
    // a solid fill while keeping the drafting texture restrained on desktop.
    const hatchSpacing = useMemo(
        () => clamp(millimetersPerPixel * 8, 70, 520),
        [millimetersPerPixel],
    );
    // Same perpendicular distance between lines as the former diagonal tile.
    const hatchPitch = hatchSpacing / Math.SQRT2;

    const labelInViewMargin = annotationMillimetersPerPixel * 16;
    const inView = <T extends Parameters<typeof keepDimensionLabelInView>[0]>(dimension: T) =>
        keepDimensionLabelInView(dimension, viewBox, labelInViewMargin);

    useEffect(() => {
        if (!canvasSize.width || !canvasSize.height) return;
        if (!viewInitializedRef.current) {
            setViewBox(fitViewBox);
            viewBoxRef.current = fitViewBox;
            viewInitializedRef.current = true;
            return;
        }

        const zoom = fitViewBox.width / viewBox.width;
        const nextWidth = clamp(
            fitViewBox.width / zoom,
            fitViewBox.width / MAX_ZOOM,
            fitViewBox.width / MIN_ZOOM,
        );
        const nextHeight = nextWidth / (fitViewBox.width / fitViewBox.height);
        const centerX = viewBox.x + viewBox.width / 2;
        const centerY = viewBox.y + viewBox.height / 2;
        const nextViewBox = clampViewBox(
            {
                x: centerX - nextWidth / 2,
                y: centerY - nextHeight / 2,
                width: nextWidth,
                height: nextHeight,
            },
            fitViewBox,
        );
        if (
            Math.abs(nextViewBox.x - viewBox.x) > 0.001 ||
            Math.abs(nextViewBox.y - viewBox.y) > 0.001 ||
            Math.abs(nextViewBox.width - viewBox.width) > 0.001 ||
            Math.abs(nextViewBox.height - viewBox.height) > 0.001
        ) {
            viewBoxRef.current = nextViewBox;
            setViewBox(nextViewBox);
        }
    }, [canvasSize.height, canvasSize.width, fitViewBox, viewBox]);

    const verticalRulerTicks = useMemo(
        () =>
            Array.from({ length: 6 }, (_, index) => viewBox.y + (viewBox.height * (5 - index)) / 5),
        [viewBox.y, viewBox.height],
    );

    useEffect(() => {
        const media = window.matchMedia(TOOL_SHEET_MEDIA_QUERY);
        const update = () => setToolSheetOverlaysCanvas(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        const board = boardRef.current;
        if (!board) return;
        const updateSize = () => {
            const next = board.getBoundingClientRect();
            setCanvasSize({ width: next.width, height: next.height });
        };
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(board);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        const body = document.body;
        const scrollPosition = { x: window.scrollX, y: window.scrollY };
        const previousRootStyles = {
            height: root.style.height,
            overflow: root.style.overflow,
            overscrollBehavior: root.style.overscrollBehavior,
        };
        const previousBodyStyles = {
            height: body.style.height,
            overflow: body.style.overflow,
            overscrollBehavior: body.style.overscrollBehavior,
        };

        root.style.height = "100%";
        root.style.overflow = "hidden";
        root.style.overscrollBehavior = "none";
        body.style.height = "100%";
        body.style.overflow = "hidden";
        body.style.overscrollBehavior = "none";

        return () => {
            root.style.height = previousRootStyles.height;
            root.style.overflow = previousRootStyles.overflow;
            root.style.overscrollBehavior = previousRootStyles.overscrollBehavior;
            body.style.height = previousBodyStyles.height;
            body.style.overflow = previousBodyStyles.overflow;
            body.style.overscrollBehavior = previousBodyStyles.overscrollBehavior;
            window.scrollTo(scrollPosition.x, scrollPosition.y);
        };
    }, []);

    useEffect(() => {
        sceneForInteractionRef.current = scene;
    }, [scene]);

    useEffect(() => {
        const saved = readEditorSession();
        const plannerRoom = readPlannerRoom();
        if (saved) {
            const withOpenings = plannerRoom ? takePlannerOpenings(saved, plannerRoom) : saved;
            // A layout made on the former layout step lives beside the drawing;
            // when the drawing has no furniture yet and shows that very room,
            // its pieces join the drawing where they stood.
            const layout = readPlannerLayout();
            const host =
                plannerRoom && layout.length && !(withOpenings.furniture ?? []).length
                    ? getRoomPreviews(withOpenings).find(
                          (preview) => roomShapeKey(preview.room) === roomShapeKey(plannerRoom),
                      )
                    : undefined;
            const restored = host
                ? {
                      ...withOpenings,
                      furniture: solvedToDrawFurniture(layout, host.origin, "furniture-layout"),
                  }
                : withOpenings;
            if (plannerRoom) setNewerPlannerRoom(getNewerPlannerRoom(restored, plannerRoom));
            sceneForInteractionRef.current = restored;
            setHistory({ past: [], present: restored, future: [] });
            if (getRoomPreview(restored)) setTool("select");
            setNotice(
                "Восстановлен сохранённый чертёж. Имена помещений и проёмы можно продолжать редактировать.",
            );
        } else if (plannerRoom) {
            const converted = roomToDrawingScene(plannerRoom, readPlannerLayout());
            if (converted) {
                const scene = bindLegacyOpenings(cloneScene(converted));
                sceneForInteractionRef.current = scene;
                setHistory({ past: [], present: scene, future: [] });
                setTool("select");
                fitAfterSceneChangeRef.current = true;
                setNotice(
                    converted.furniture?.length
                        ? "Комната и расстановка перенесены в планировщик. Стены, проёмы и мебель можно менять."
                        : "Комната перенесена с шага расстановки. Её стены и проёмы можно менять.",
                );
            }
        }
        setEditorSessionReady(true);
    }, []);

    useEffect(() => {
        if (!editorSessionReady || typeof window === "undefined") return;
        try {
            const persisted = {
                ...scene,
                // The current derived signature list is saved along with the
                // graph, so a browser refresh never renames a stable region.
                regions: {
                    version: 1,
                    items: renderedRoomRegions.map(toRoomRegionMetadata),
                },
            };
            const storage = getProjectStorage();
            if (!storage) throw new Error("storage unavailable");
            storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(persisted));
            setAutosaveStatus("saved");
        } catch {
            setAutosaveStatus("error");
        }
    }, [editorSessionReady, renderedRoomRegions, scene]);

    useEffect(() => {
        viewBoxRef.current = viewBox;
    }, [viewBox]);

    const commitScene = useCallback((next: Scene) => {
        const current = bindLegacyOpenings(sceneForInteractionRef.current);
        next = {
            ...next,
            doors: next.doors.map((item) => ({
                ...item,
                drawingHostId:
                    item.drawingHostId ??
                    current.doors.find((old) => old.id === item.id)?.drawingHostId,
            })),
            windows: next.windows.map((item) => ({
                ...item,
                drawingHostId:
                    item.drawingHostId ??
                    current.windows.find((old) => old.id === item.id)?.drawingHostId,
            })),
        };
        sceneForInteractionRef.current = cloneScene(next);
        setHistory((current) => ({
            past: [...current.past, cloneScene(current.present)].slice(-MAX_HISTORY),
            present: cloneScene(next),
            future: [],
        }));
    }, []);

    const pointFromEvent = useCallback(
        (event: React.PointerEvent<SVGSVGElement>, snapToGrid = true): Point | null => {
            const board = boardRef.current;
            if (!board) return null;
            const bounds = board.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return null;
            const camera = viewBoxRef.current;
            const rendered = getRenderedViewBounds(bounds, camera);
            const raw = {
                x: camera.x + ((event.clientX - rendered.left) / rendered.width) * camera.width,
                y: camera.y + ((event.clientY - rendered.top) / rendered.height) * camera.height,
            };
            return snapToGrid
                ? {
                      x: snapDrawRoomCoordinate(raw.x, sceneSnapMm),
                      y: snapDrawRoomCoordinate(raw.y, sceneSnapMm),
                  }
                : raw;
        },
        [sceneSnapMm],
    );

    const selectTool = useCallback(
        (nextTool: Tool, nextDoorKind?: DoorKind) => {
            setMeasuring(false);
            const doorKind = nextDoorKind ?? selectedDoorKind;
            if (nextTool !== "wall") {
                wallDrawingRef.current = false;
                wallDrawingAnchorRef.current = null;
                setWallDrawingAnchorPoint(null);
                setWallDrawingAnchorAttachment(null);
                if (capturedPointerRef.current !== null) {
                    try {
                        boardRef.current?.releasePointerCapture(capturedPointerRef.current);
                    } catch {
                        // ignore
                    }
                    capturedPointerRef.current = null;
                }
            }
            if (nextDoorKind) setSelectedDoorKind(nextDoorKind);
            if (nextTool !== "select") {
                setSelectedContourWallEdge(null);
                setSelectedSegmentWallId(null);
            }
            setTool(nextTool);
            setToolSheetCollapsed(true);
            setHoverPoint(null);
            setNotice(
                nextTool === "wall"
                    ? preview
                        ? "Зажмите левую кнопку и ведите по сетке — новая внутренняя стена станет перегородкой автоматически."
                        : "Зажмите левую кнопку и ведите по сетке — стройте внешний контур комнаты."
                    : nextTool === "door"
                      ? preview
                          ? `Нажмите на стену или перегородку — добавим ${getDoorCatalogItem(doorKind).label.toLocaleLowerCase("ru-RU")} дверь.`
                          : "Дверь выбрана. Сначала завершите внешний контур, затем нажмите на стену."
                      : nextTool === "window"
                        ? preview
                            ? "Нажмите на внешнюю стену — добавим окно шириной 1 200 мм."
                            : "Окно выбрано. Сначала завершите внешний контур, затем нажмите на стену."
                        : preview
                          ? "Тяните стену за середину, чтобы сдвинуть её целиком; за конец — чтобы оставить второй стык на месте."
                          : "Перемещайте поле ЛКМ. Для рисования выберите «Стена».",
            );
        },
        [preview, selectedDoorKind],
    );

    const selectContourWall = useCallback(
        (event: React.PointerEvent<SVGElement>, edgeIndex: number) => {
            if (!preview || tool !== "select" || !event.isPrimary) return;
            event.preventDefault();
            event.stopPropagation();
            setActiveToolGroup("walls");
            setSelectedContourWallEdge(edgeIndex);
            setSelectedSegmentWallId(null);
            setSelectedOpening(null);
            setHoverPoint(null);
            setNotice(
                "Стена выбрана. Потяните верхнюю, центральную или нижнюю точку, чтобы изменить её.",
            );
        },
        [preview, tool],
    );

    const selectSegmentWall = useCallback(
        (event: React.PointerEvent<SVGElement>, segmentId: string) => {
            if (tool !== "select" || !event.isPrimary) return;
            event.preventDefault();
            event.stopPropagation();
            setSelectedContourWallEdge(null);
            setActiveToolGroup("walls");
            setSelectedSegmentWallId(segmentId);
            setSelectedOpening(null);
            setHoverPoint(null);
            setNotice(
                "Стена выбрана. Потяните верхнюю, центральную или нижнюю точку, чтобы изменить её.",
            );
        },
        [tool],
    );

    const startContourWallDrag = useCallback(
        (
            event: React.PointerEvent<SVGElement>,
            selectedEdgeIndex: number,
            grab: ContourWallGrab,
        ) => {
            if (
                !preview ||
                tool !== "select" ||
                !event.isPrimary ||
                selectedContourWallEdge !== selectedEdgeIndex
            ) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const movingEdgeIndex = getContourDragMovingEdge(
                preview.contour.length,
                selectedEdgeIndex,
                grab,
            );
            contourWallDragRef.current = {
                kind: "contour",
                selectedEdgeIndex,
                movingEdgeIndex,
                grab,
                startScene: cloneScene(scene),
                startPreview: preview,
                changed: false,
            };
            setActiveContourWallGrab({ edgeIndex: selectedEdgeIndex, grab });
            setSelectedOpening(null);
            setHoverPoint(null);
            setNotice(
                grab === "middle"
                    ? "Тяните середину: вся стена смещается, а примыкающие стены сохраняют стыки."
                    : "Тяните конец: противоположный конец этой стены остаётся закреплённым.",
            );
            try {
                boardRef.current?.setPointerCapture(event.pointerId);
                capturedPointerRef.current = event.pointerId;
            } catch {
                // Pointer capture is progressive enhancement only.
            }
        },
        [preview, scene, selectedContourWallEdge, tool],
    );

    const startSegmentWallDrag = useCallback(
        (event: React.PointerEvent<SVGElement>, segmentId: string, grab: ContourWallGrab) => {
            if (
                tool !== "select" ||
                !event.isPrimary ||
                selectedSegmentWallId !== segmentId ||
                !scene.segments.some((segment) => segment.id === segmentId)
            ) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const segment = getDrawWallRun(scene.segments, segmentId)!;
            const selectedWallIsHorizontal = segment.start.y === segment.end.y;
            const attachedPoint = grab === "start" ? segment.start : segment.end;
            const supportingContourEdge =
                grab === "middle" || !preview
                    ? -1
                    : getPerpendicularContourEdgeAtPoint(
                          preview.contour,
                          attachedPoint,
                          selectedWallIsHorizontal,
                      );
            contourWallDragRef.current =
                supportingContourEdge >= 0
                    ? {
                          kind: "contour",
                          selectedEdgeIndex: supportingContourEdge,
                          movingEdgeIndex: supportingContourEdge,
                          grab,
                          startScene: cloneScene(scene),
                          startPreview: preview!,
                          changed: false,
                      }
                    : {
                          kind: "segment",
                          segmentId,
                          grab,
                          startScene: cloneScene(scene),
                          startPreview: preview,
                          changed: false,
                      };
            setSelectedOpening(null);
            setHoverPoint(null);
            setNotice(
                grab === "middle"
                    ? "Тяните середину: вся стена смещается вместе с проёмами и стыками."
                    : supportingContourEdge >= 0
                      ? "Тяните край: противоположный край остаётся закреплённым, а примыкающая стена сохраняет стык."
                      : "Тяните край вдоль стены: её длина изменится, противоположный конец останется на месте.",
            );
            try {
                boardRef.current?.setPointerCapture(event.pointerId);
                capturedPointerRef.current = event.pointerId;
            } catch {
                // Pointer capture is progressive enhancement only.
            }
        },
        [preview, scene, selectedSegmentWallId, tool],
    );

    const handleBoardPointerMove = useCallback(
        (event: React.PointerEvent<SVGSVGElement>) => {
            const contourDrag = contourWallDragRef.current;
            if (contourDrag) {
                const point = pointFromEvent(event, false);
                if (!point) return;
                const moved =
                    contourDrag.kind === "contour"
                        ? moveDrawWallContourSegment(
                              contourDrag.startScene.segments,
                              contourDrag.startPreview.contour,
                              contourDrag.movingEdgeIndex,
                              point,
                              getSceneSnapMm(contourDrag.startScene),
                          )
                        : contourDrag.grab === "middle"
                          ? moveDrawWallRun(
                                contourDrag.startScene.segments,
                                contourDrag.segmentId,
                                point,
                                getSceneSnapMm(contourDrag.startScene),
                            )
                          : resizeDrawWallRun(
                                contourDrag.startScene.segments,
                                contourDrag.segmentId,
                                contourDrag.grab,
                                point,
                                getSceneSnapMm(contourDrag.startScene),
                            );
                if (moved.status === "invalid") {
                    setNotice(moved.message);
                    return;
                }
                const movingStart =
                    contourDrag.kind === "contour"
                        ? contourDrag.startPreview.contour[contourDrag.movingEdgeIndex]
                        : contourDrag.startScene.segments.find(
                              (segment) => segment.id === contourDrag.segmentId,
                          )?.start;
                const movingEnd =
                    contourDrag.kind === "contour"
                        ? contourDrag.startPreview.contour[
                              (contourDrag.movingEdgeIndex + 1) %
                                  contourDrag.startPreview.contour.length
                          ]
                        : contourDrag.startScene.segments.find(
                              (segment) => segment.id === contourDrag.segmentId,
                          )?.end;
                if (!movingStart || !movingEnd) {
                    setNotice("Эта стена больше недоступна для перемещения.");
                    return;
                }
                const after = getRoomPreview({
                    ...contourDrag.startScene,
                    segments: moved.segments,
                });
                if (contourDrag.startPreview && !after) {
                    setNotice(
                        "После перемещения не останется замкнутого контура. Верните стену назад.",
                    );
                    return;
                }
                const reanchored =
                    contourDrag.startPreview && after
                        ? reanchorOpeningsAfterWallMove(contourDrag.startScene, moved.segments)
                        : {
                              scene: {
                                  ...contourDrag.startScene,
                                  segments: moved.segments,
                              },
                          };
                if ("error" in reanchored) {
                    setNotice(reanchored.error);
                    return;
                }
                contourDrag.changed =
                    JSON.stringify(reanchored.scene.segments) !==
                    JSON.stringify(contourDrag.startScene.segments);
                if (contourDrag.kind === "segment") {
                    const run = getDrawWallRun(
                        contourDrag.startScene.segments,
                        contourDrag.segmentId,
                    );
                    const retained = moved.segments.find((item) =>
                        run?.segmentIds.includes(item.id),
                    );
                    setSelectedSegmentWallId(retained?.id ?? null);
                }
                sceneForInteractionRef.current = cloneScene(reanchored.scene);
                setHistory((current) => ({ ...current, present: cloneScene(reanchored.scene) }));
                if (contourDrag.kind === "contour" && after) {
                    const selectedEdgeIndex = findMovedDrawWallContourEdge(
                        contourDrag.startScene.segments,
                        moved.segments,
                        contourDrag.startPreview.contour,
                        after.contour,
                        contourDrag.selectedEdgeIndex,
                    );
                    setSelectedContourWallEdge(selectedEdgeIndex >= 0 ? selectedEdgeIndex : null);
                    setActiveContourWallGrab(
                        selectedEdgeIndex >= 0
                            ? { edgeIndex: selectedEdgeIndex, grab: contourDrag.grab }
                            : null,
                    );
                }
                setCursorPoint(point);
                return;
            }
            if (openingDragRef.current && preview) {
                const dragged = openingDragRef.current;
                const current =
                    dragged.kind === "door"
                        ? sceneForInteractionRef.current.doors.find(
                              (door) => door.id === dragged.id,
                          )
                        : sceneForInteractionRef.current.windows.find(
                              (window) => window.id === dragged.id,
                          );
                // getRoomSegment resolves both exterior segmentId and
                // partitionId. Looking only in boundarySegments made a real
                // partition door selectable but impossible to drag.
                const owner = current ? openingOwner(previews, current) : null;
                const segment = current && owner ? getRoomSegment(owner.room, current) : null;
                const point = pointFromEvent(event, false);
                if (!current || !segment || !point || !owner) return;
                const direction = {
                    x: (segment.end.x - segment.start.x) / segment.length,
                    y: (segment.end.y - segment.start.y) / segment.length,
                };
                // Keep the grabbed point attached to the pointer. Once captured,
                // project motion onto the host even if the pointer leaves its band.
                const delta =
                    (point.x - dragged.startPoint.x) * direction.x +
                    (point.y - dragged.startPoint.y) * direction.y;
                let resolved = resolveOpeningOffset(
                    scopedOpeningScene(sceneForInteractionRef.current, owner),
                    segment,
                    dragged.startOffset + delta + current.width / 2,
                    current.width,
                    current.id,
                    dragged.allowedOffsets ? 10 : getSceneSnapMm(sceneForInteractionRef.current),
                );
                if (dragged.allowedOffsets?.length) {
                    const offset = dragged.allowedOffsets.reduce((best, candidate) =>
                        Math.abs(candidate - resolved.offset) < Math.abs(best - resolved.offset)
                            ? candidate
                            : best,
                    );
                    resolved = { offset, valid: true };
                }
                const materialError =
                    dragged.kind === "door" && resolved.valid
                        ? getDoorCandidateError(owner.room, {
                              ...(current as DoorOpening),
                              offset: resolved.offset,
                          })
                        : null;
                setOpeningDragPreview({
                    origin: owner.origin,
                    kind: dragged.kind,
                    segment,
                    width: current.width,
                    ...resolved,
                    valid: resolved.valid && !materialError,
                    ...(materialError ? { message: materialError } : {}),
                });
                setCursorPoint(point);
                return;
            }
            if (panningRef.current && panStartRef.current) {
                const board = boardRef.current;
                if (!board) return;
                const bounds = board.getBoundingClientRect();
                if (!bounds.width || !bounds.height) return;
                const rendered = getRenderedViewBounds(bounds, panStartRef.current.startViewBox);

                const deltaX = event.clientX - panStartRef.current.startClientX;
                const deltaY = event.clientY - panStartRef.current.startClientY;
                const next = {
                    x:
                        panStartRef.current.startViewBox.x -
                        (deltaX / rendered.width) * panStartRef.current.startViewBox.width,
                    y:
                        panStartRef.current.startViewBox.y -
                        (deltaY / rendered.height) * panStartRef.current.startViewBox.height,
                    width: panStartRef.current.startViewBox.width,
                    height: panStartRef.current.startViewBox.height,
                };
                const clamped = clampViewBox(next, fitViewBox);
                viewBoxRef.current = clamped;
                setViewBox(clamped);
                setCursorPoint(pointFromEvent(event, false));
                return;
            }

            const point = pointFromEvent(event);
            setCursorPoint(point);
            if (tool === "wall") {
                if (!point) {
                    setHoverPoint(null);
                    return;
                }
                const activeScene = sceneForInteractionRef.current;
                const activeDrawing = wallDrawingAnchorRef.current;
                if (wallDrawingRef.current && activeDrawing) {
                    setHoverPoint(
                        resolveDragEnd(
                            activeScene.segments,
                            activeDrawing.start,
                            point,
                            getSceneSnapMm(activeScene),
                        ),
                    );
                    return;
                }
                setHoverPoint(point);
            } else {
                setHoverPoint(null);
            }
        },
        [fitViewBox, pointFromEvent, preview, previews, tool],
    );

    const startPan = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
        if (wallDrawingRef.current || panningRef.current) return;
        panningRef.current = true;
        panStartRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startViewBox: viewBoxRef.current,
        };
        try {
            if (!panPointerRef.current) {
                event.currentTarget.setPointerCapture(event.pointerId);
                panPointerRef.current = event.pointerId;
            }
        } catch {
            // ignore
        }
        setNotice("Режим перемещения: тяните поле мышью.");
    }, []);

    const stopPan = useCallback(() => {
        if (!panningRef.current) return;
        panningRef.current = false;
        panStartRef.current = null;
        if (panPointerRef.current !== null) {
            try {
                boardRef.current?.releasePointerCapture(panPointerRef.current);
            } catch {
                // ignore
            }
            panPointerRef.current = null;
        }
    }, []);

    const commitWallSegmentFromDrag = useCallback(
        (event: React.PointerEvent<SVGSVGElement>) => {
            if (!wallDrawingRef.current) return;
            const anchor = wallDrawingAnchorRef.current;
            wallDrawingRef.current = false;
            wallDrawingAnchorRef.current = null;
            setWallDrawingAnchorPoint(null);
            setWallDrawingAnchorAttachment(null);
            setHoverPoint(null);

            if (!anchor) return;
            const pointerId = capturedPointerRef.current;
            capturedPointerRef.current = null;

            const point = pointFromEvent(event);
            if (!point) {
                setNotice("Сейчас ничего не добавлено. Попробуйте ещё раз.");
                if (pointerId !== null) {
                    try {
                        event.currentTarget.releasePointerCapture(pointerId);
                    } catch {
                        // ignore
                    }
                }
                return;
            }

            const end = resolveDragEnd(
                sceneForInteractionRef.current.segments,
                anchor.start,
                point,
                getSceneSnapMm(sceneForInteractionRef.current),
            );
            setCursorPoint(end);
            // Do not leave a construction crosshair or a dotted tail at the
            // finished endpoint. The idle affordance returns on the next real
            // pointer move, while the committed material stays clean.
            setHoverPoint(null);
            const length = Math.abs(end.x - anchor.start.x) + Math.abs(end.y - anchor.start.y);
            if (length === 0) {
                setNotice("Нужно потянуть стену дальше по сетке.");
                return;
            }
            const snapshot = sceneForInteractionRef.current;
            if (snapshot.segments.length !== anchor.segmentCount) {
                setNotice("Контур изменился во время рисования. Повторите стену.");
                return;
            }
            const added = addDrawWallSegment(
                snapshot.segments,
                anchor.start,
                end,
                getSceneSnapMm(snapshot),
            );
            if (added.status === "invalid") {
                setNotice(added.message);
                return;
            }
            if (wouldOrphanPartitionDoor(snapshot, added.segments)) {
                setNotice(
                    "Новая стена изменила бы перегородку с дверью. Сначала перенесите или удалите этот проём.",
                );
                return;
            }
            const endAttachment = getWallAnchorFeedback(
                snapshot.segments,
                end,
                getWallMagnetRadius(snapshot, sceneSnapMm, millimetersPerPixel),
                sceneSnapMm,
            ).attachment;
            const completedRoom = deriveDrawWallGraphRoom(
                added.segments,
                getSceneWallThickness(snapshot),
            );
            // Before the exterior perimeter is complete, a wall that joins two
            // existing wall sides can close an accidental small pocket. That
            // must never silently redefine the whole room as a partition bay.
            if (
                !preview &&
                anchor.attachment === "side" &&
                endAttachment === "side" &&
                completedRoom
            ) {
                setNotice(
                    "Сначала замкните внешний контур. Новая стена не должна превращать часть незавершённого эскиза в комнату.",
                );
                return;
            }
            commitScene({ ...snapshot, segments: added.segments });
            if (!preview && completedRoom) {
                setTool("select");
                autoFitPendingRef.current = true;
            }
            setNotice(
                !preview && completedRoom
                    ? "Контур замкнут. Режим «Выбрать» включён: нажмите на стену, чтобы открыть три точки перемещения."
                    : snapshot.segments.length === 0
                      ? "Первая стена добавлена. Её размеры остаются на чертеже; следующую стену можно начать в любой точке."
                      : "Сегмент добавлен. Его размеры остаются на чертеже; новую стену можно начать в любой точке или от существующей.",
            );
            if (pointerId !== null) {
                try {
                    event.currentTarget.releasePointerCapture(pointerId);
                } catch {
                    // ignore
                }
            }
        },
        [commitScene, millimetersPerPixel, pointFromEvent, preview, sceneSnapMm],
    );

    const beginWallDrawing = useCallback(
        (event: React.PointerEvent<SVGSVGElement>, point: Point) => {
            const snapshot = sceneForInteractionRef.current;
            const anchor = getWallAnchorFeedback(
                snapshot.segments,
                point,
                getWallMagnetRadius(snapshot, sceneSnapMm, millimetersPerPixel),
                sceneSnapMm,
            );
            wallDrawingRef.current = true;
            wallDrawingAnchorRef.current = {
                start: anchor.point,
                segmentCount: snapshot.segments.length,
                attachment: anchor.attachment,
            };
            setWallDrawingAnchorPoint(anchor.point);
            setWallDrawingAnchorAttachment(anchor.attachment);
            setNotice(
                anchor.attachment === "endpoint"
                    ? "Стену начнём от конца существующего сегмента. Тяните по сетке."
                    : anchor.attachment === "side"
                      ? "Стену начнём от стороны существующего сегмента. Тяните по сетке."
                      : "Тяните стену по сетке не менее чем на 500 мм и отпустите.",
            );
            setHoverPoint(anchor.point);
            try {
                if (!capturedPointerRef.current) {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    capturedPointerRef.current = event.pointerId;
                }
            } catch {
                // ignore pointer capture failures on older browsers
            }
        },
        [millimetersPerPixel, sceneSnapMm],
    );

    const addOpening = useCallback(
        (kind: "door" | "window", point: Point) => {
            if (!preview) {
                setNotice(
                    "Сначала замкните контур комнаты — у проёма должна быть настоящая стена.",
                );
                return;
            }
            const target = openingTarget(previews, point);
            if (!target) {
                setNotice("Наведите курсор ближе к линии стены и нажмите ещё раз.");
                return;
            }
            const owner = target.owner;
            const partition = owner.room.partitions?.find(
                (candidate) => candidate.id === target.segment.id,
            );
            if (kind === "window" && partition) {
                setNotice(
                    "Окно можно поставить только во внешней стене. В перегородку добавьте дверь.",
                );
                return;
            }
            const width = getOpeningWidth(kind, undefined, selectedDoorKind, sceneSnapMm);
            const resolved = resolveOpeningOffset(
                scopedOpeningScene(scene, owner),
                target.segment,
                target.offset,
                width,
            );
            if (!resolved.valid) {
                setNotice(resolved.message ?? "Этот проём нельзя поставить в выбранное место.");
                return;
            }
            const offset = resolved.offset;
            if (kind === "door") {
                const id = `door-${scene.doors.length + 1}`;
                const candidate = createDoorOpening(
                    id,
                    target.segment,
                    offset,
                    width,
                    selectedDoorKind,
                    Boolean(partition),
                    slidingMount,
                    slidingDirection,
                );
                candidate.drawingHostId = owner.wallIds?.[0];
                const materialError = getDoorCandidateError(owner.room, candidate);
                if (materialError) {
                    setNotice(materialError);
                    return;
                }
                commitScene({
                    ...scene,
                    doors: [...scene.doors, candidate],
                });
                setSelectedOpening({ kind, id });
                // Placement is complete: returning to selection keeps the new
                // object's inspector in view instead of leaving a second ghost
                // over the just-created door.
                setTool("select");
                setNotice(
                    partition
                        ? `${getDoorCatalogItem(selectedDoorKind).label} дверь добавлена в перегородку. Настройте её в карточке.`
                        : `${getDoorCatalogItem(selectedDoorKind).label} дверь добавлена. Уточните ширину и положение в карточке.`,
                );
            } else {
                const id = `window-${scene.windows.length + 1}`;
                commitScene({
                    ...scene,
                    windows: [
                        ...scene.windows,
                        {
                            id,
                            wall: target.segment.wall,
                            segmentId: target.segment.id,
                            offset,
                            width,
                            windowKind: "standard",
                            drawingHostId: owner.wallIds?.[0],
                        },
                    ],
                });
                setSelectedOpening({ kind, id });
                setTool("select");
                setNotice("Окно добавлено. Его ширину и отступ можно уточнить в карточке.");
            }
        },
        [
            commitScene,
            previews,
            preview,
            scene,
            sceneSnapMm,
            selectedDoorKind,
            slidingMount,
            slidingDirection,
        ],
    );

    const addRadiator = useCallback(
        (point: Point) => {
            if (!preview) {
                setNotice("Сначала замкните контур комнаты — радиатор ставится к стене.");
                return;
            }
            const target = openingTarget(previews, point);
            if (!target) {
                setNotice("Наведите курсор ближе к стене и нажмите ещё раз.");
                return;
            }
            const owner = target.owner;
            if (owner.room.partitions?.some((partition) => partition.id === target.segment.id)) {
                setNotice("Радиатор ставится у внешней стены.");
                return;
            }
            const width = Math.min(RADIATOR_DEFAULT_WIDTH_MM, target.segment.length);
            const offset = clamp(
                snapDrawRoomCoordinate(target.offset - width / 2, sceneSnapMm),
                0,
                target.segment.length - width,
            );
            const id = `radiator-${
                Math.max(
                    0,
                    ...(scene.radiators ?? []).map(
                        (radiator) => Number(radiator.id.split("-")[1]) || 0,
                    ),
                ) + 1
            }`;
            const radiator: RadiatorObstacle = {
                id,
                drawingHostId: owner.wallIds?.[0],
                wall: target.segment.wall,
                segmentId: target.segment.id,
                offset,
                width,
                depth: RADIATOR_DEPTH_MM,
                clearanceDepth: RADIATOR_CLEARANCE_MM,
            };
            const problem = validateRoomGeometry({
                ...owner.room,
                radiators: [...(owner.room.radiators ?? []), radiator],
            });
            if (problem) {
                setNotice(`Радиатор не помещается здесь: ${problem}`);
                return;
            }
            commitScene({ ...scene, radiators: [...(scene.radiators ?? []), radiator] });
            setSelectedOpening(null);
            setSelectedRadiatorId(id);
            setTool("select");
            setNotice("Радиатор добавлен. Ширину и отступ можно уточнить в карточке.");
        },
        [commitScene, preview, previews, scene, sceneSnapMm],
    );

    const selectedRadiatorData = useMemo(() => {
        if (!selectedRadiatorId) return null;
        for (const owner of previews) {
            const radiator = owner.room.radiators?.find((item) => item.id === selectedRadiatorId);
            const segment = radiator && getRoomSegment(owner.room, radiator);
            if (radiator && segment) return { owner, radiator, segment };
        }
        return null;
    }, [previews, selectedRadiatorId]);

    const updateSelectedRadiator = useCallback(
        (patch: Partial<Pick<RadiatorObstacle, "width" | "offset">>) => {
            if (!selectedRadiatorData) return;
            const { owner, radiator } = selectedRadiatorData;
            if (
                ![patch.width, patch.offset].every(
                    (value) => value === undefined || Number.isFinite(value),
                )
            )
                return;
            const next = { ...radiator, ...patch };
            const problem = validateRoomGeometry({
                ...owner.room,
                radiators: (owner.room.radiators ?? []).map((item) =>
                    item.id === radiator.id ? next : item,
                ),
            });
            if (problem) {
                setNotice(`Радиатор так не помещается: ${problem}`);
                return;
            }
            commitScene({
                ...scene,
                radiators: (scene.radiators ?? []).map((item) =>
                    item.id === radiator.id ? next : item,
                ),
            });
        },
        [commitScene, scene, selectedRadiatorData],
    );

    const deleteSelectedRadiator = useCallback(() => {
        if (!selectedRadiatorId) return;
        commitScene({
            ...scene,
            radiators: (scene.radiators ?? []).filter((item) => item.id !== selectedRadiatorId),
        });
        setSelectedRadiatorId(null);
        setNotice("Радиатор удалён.");
    }, [commitScene, scene, selectedRadiatorId]);

    const openKeyboardEntry = useCallback(
        (requestedTool?: KeyboardTool) => {
            // Radiators are placed on the plan only; typed entry starts a wall.
            const nextTool =
                requestedTool ?? (tool === "select" || tool === "radiator" ? "wall" : tool);
            const seed = cursorPoint ?? { x: 1000, y: 1000 };
            setKeyboardTool(nextTool);
            setKeyboardEntry((current) => ({
                startX: current.startX || String(seed.x),
                startY: current.startY || String(seed.y),
                endX: current.endX || String(seed.x + 4000),
                endY: current.endY || String(seed.y),
            }));
            setKeyboardEntryOpen(true);
            setNotice(
                "Ввод по координатам открыт. Tab перемещает между полями, Enter добавляет объект.",
            );
        },
        [cursorPoint, tool],
    );

    const submitKeyboardGeometry = useCallback(
        (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const coordinate = (value: string) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? snapDrawRoomCoordinate(parsed, sceneSnapMm) : null;
            };
            const endX = coordinate(keyboardEntry.endX);
            const endY = coordinate(keyboardEntry.endY);
            if (endX === null || endY === null) {
                setNotice("Введите корректные координаты в миллиметрах.");
                return;
            }
            const end = { x: endX, y: endY };
            if (keyboardTool === "door" || keyboardTool === "window") {
                addOpening(keyboardTool, end);
                setKeyboardEntryOpen(false);
                return;
            }
            const startX = coordinate(keyboardEntry.startX);
            const startY = coordinate(keyboardEntry.startY);
            if (startX === null || startY === null) {
                setNotice("Введите корректные координаты в миллиметрах.");
                return;
            }
            const added = addDrawWallSegment(
                scene.segments,
                { x: startX, y: startY },
                end,
                sceneSnapMm,
            );
            if (added.status === "invalid") {
                setNotice(added.message);
                return;
            }
            if (wouldOrphanPartitionDoor(scene, added.segments)) {
                setNotice(
                    "Новая стена изменила бы перегородку с дверью. Сначала перенесите или удалите этот проём.",
                );
                return;
            }
            commitScene({ ...scene, segments: added.segments });
            setTool(keyboardTool);
            setKeyboardEntryOpen(false);
            setNotice(
                preview
                    ? "Внутренняя стена добавлена по координатам. Помещения и размеры обновлены."
                    : "Сегмент добавлен по координатам. Следующий объект можно добавить тем же способом.",
            );
        },
        [addOpening, commitScene, keyboardEntry, keyboardTool, preview, scene, sceneSnapMm],
    );

    const updateSelectedOpening = useCallback(
        (patch: Partial<DoorOpening & WindowOpening>) => {
            if (!selectedOpeningData) return;
            const { kind, item, segment, owner } = selectedOpeningData;
            const currentDoorKind =
                kind === "door"
                    ? patch.doorKind ?? (item as DoorOpening).doorKind ?? "room"
                    : "room";
            let nextWidth: number;
            if (patch.width !== undefined) {
                const requestedWidth = resolveOpeningWidthEdit(
                    kind,
                    patch.width,
                    currentDoorKind,
                    sceneSnapMm,
                );
                if (!requestedWidth.valid) {
                    setNotice(requestedWidth.message);
                    return;
                }
                nextWidth = requestedWidth.width;
            } else {
                // Switching a door kind retains the established catalogue
                // normalization (for example, one leaf to double leaf).
                nextWidth = getOpeningWidth(kind, item.width, currentDoorKind, sceneSnapMm);
            }
            const nextOffset = resolveOpeningOffset(
                scopedOpeningScene(scene, owner),
                segment,
                (patch.offset ?? item.offset) + nextWidth / 2,
                nextWidth,
                item.id,
            );
            if (!nextOffset.valid) {
                setNotice(nextOffset.message ?? "Не удалось изменить проём.");
                return;
            }
            if (kind === "door") {
                const candidate: DoorOpening = {
                    ...(item as DoorOpening),
                    ...patch,
                    doorKind: currentDoorKind,
                    width: nextWidth,
                    offset: nextOffset.offset,
                    ...(patch.width !== undefined || patch.doorKind !== undefined
                        ? { clearanceDepth: nextWidth }
                        : {}),
                    ...(isHingedDoor({ doorKind: currentDoorKind })
                        ? {}
                        : { hinge: undefined, swingDirection: undefined }),
                };
                const materialError = preview
                    ? getDoorCandidateError(owner.room, candidate)
                    : "Не удалось найти комнату для проверки двери.";
                if (materialError) {
                    setNotice(materialError);
                    return;
                }
                commitScene({
                    ...scene,
                    doors: scene.doors.map((door) => (door.id === item.id ? candidate : door)),
                });
            } else {
                commitScene({
                    ...scene,
                    windows: scene.windows.map((window) =>
                        window.id === item.id
                            ? { ...window, ...patch, width: nextWidth, offset: nextOffset.offset }
                            : window,
                    ),
                });
            }
        },
        [commitScene, preview, scene, sceneSnapMm, selectedOpeningData],
    );

    const updateRegion = useCallback(
        (signature: string, patch: { name?: string; kind?: RoomKind }) => {
            if (!preview) return;
            const name = patch.name?.trim().replace(/\s+/g, " ");
            if (patch.name !== undefined && !name) {
                setNotice("Название помещения не может быть пустым.");
                return;
            }
            const items = renderedRoomRegions.map((region) => {
                if (region.signature !== signature) return toRoomRegionMetadata(region);
                const kind = patch.kind ?? region.kind;
                // A chosen kind names the room until the person types a name.
                const nextName =
                    name?.slice(0, 80) ??
                    (patch.kind && isGeneratedRoomName(region.name)
                        ? roomKindLabel(patch.kind)
                        : region.name);
                return toRoomRegionMetadata({ signature, name: nextName, kind });
            });
            commitScene({ ...scene, regions: { version: 1, items } });
            const updated = items.find((item) => item.signature === signature);
            if (updated)
                setNotice(
                    patch.kind
                        ? updated.name === roomKindLabel(patch.kind)
                            ? `Помещение отмечено: ${updated.name.toLowerCase()}.`
                            : `«${updated.name}» — ${roomKindLabel(patch.kind).toLowerCase()}.`
                        : `Название помещения сохранено: «${updated.name}».`,
                );
        },
        [commitScene, preview, renderedRoomRegions, scene],
    );

    const deleteSelectedOpening = useCallback(() => {
        if (!selectedOpening) return;
        commitScene({
            ...scene,
            doors:
                selectedOpening.kind === "door"
                    ? scene.doors.filter((door) => door.id !== selectedOpening.id)
                    : scene.doors,
            windows:
                selectedOpening.kind === "window"
                    ? scene.windows.filter((window) => window.id !== selectedOpening.id)
                    : scene.windows,
        });
        setSelectedOpening(null);
        setNotice("Проём удалён. Размеры комнаты не изменились.");
    }, [commitScene, scene, selectedOpening]);

    const deleteSelectedWall = useCallback(() => {
        const removedIds = new Set(
            selectedSegmentWall
                ? selectedSegmentWall.segmentIds
                : selectedContourWall
                  ? getContourEdgeSegmentIds(
                        scene.segments,
                        selectedContourWall.start,
                        selectedContourWall.end,
                    )
                  : [],
        );
        if (!removedIds.size) return;
        const removed = scene.segments.filter((segment) => removedIds.has(segment.id));
        const segments = scene.segments.filter((segment) => !removedIds.has(segment.id));
        // An opening cannot outlive the wall it was cut into. Openings on
        // other walls stay in the scene and reappear once the room is closed.
        const thickness = getSceneWallThickness(scene);
        const isOnRemovedWall = (opening: RenderedOpening) => {
            const { segment, origin, item } = opening;
            const along = item.offset + item.width / 2;
            const centre = {
                x:
                    origin.x +
                    segment.start.x +
                    ((segment.end.x - segment.start.x) / segment.length) * along,
                y:
                    origin.y +
                    segment.start.y +
                    ((segment.end.y - segment.start.y) / segment.length) * along,
            };
            return removed.some((wall) => {
                const horizontal = wall.start.y === wall.end.y;
                const axis = horizontal ? "x" : "y";
                const cross = horizontal ? "y" : "x";
                return (
                    Math.abs(centre[cross] - wall.start[cross]) <= thickness &&
                    centre[axis] >= Math.min(wall.start[axis], wall.end[axis]) &&
                    centre[axis] <= Math.max(wall.start[axis], wall.end[axis])
                );
            });
        };
        const removedOpenings = renderedOpenings.filter(isOnRemovedWall);
        const removedDoorIds = new Set(
            removedOpenings.filter((entry) => entry.kind === "door").map((entry) => entry.item.id),
        );
        const removedWindowIds = new Set(
            removedOpenings
                .filter((entry) => entry.kind === "window")
                .map((entry) => entry.item.id),
        );
        const next: Scene = {
            ...scene,
            segments,
            doors: scene.doors.filter((door) => !removedDoorIds.has(door.id)),
            windows: scene.windows.filter((window) => !removedWindowIds.has(window.id)),
        };
        if (wouldOrphanPartitionDoor(next, segments)) {
            setNotice(
                "Без этой стены перегородка с дверью потеряет опору. Сначала перенесите или удалите этот проём.",
            );
            return;
        }
        commitScene(next);
        setSelectedContourWallEdge(null);
        setSelectedSegmentWallId(null);
        setSelectedOpening(null);
        setNotice(
            removedOpenings.length
                ? `Стена удалена вместе с проёмами: ${removedOpenings.length}. Отменить: Ctrl/⌘+Z.`
                : "Стена удалена. Отменить: Ctrl/⌘+Z.",
        );
    }, [commitScene, renderedOpenings, scene, selectedContourWall, selectedSegmentWall]);

    const convertSelectedWindowToBalconyDoor = useCallback(() => {
        if (selectedOpeningData?.kind !== "window") return;

        const window = selectedOpeningData.item;
        const id = `door-balcony-${Date.now()}`;
        const candidate: DoorOpening = {
            id,
            wall: window.wall,
            segmentId: window.segmentId,
            offset: window.offset,
            width: window.width,
            clearanceDepth: window.width,
            hinge: "start",
            swingDirection: "inward",
            doorKind: "balcony",
            drawingHostId: window.drawingHostId,
        };
        const materialError = preview
            ? getDoorCandidateError(
                  {
                      ...selectedOpeningData.owner.room,
                      windows: selectedOpeningData.owner.room.windows.filter(
                          (item) => item.id !== window.id,
                      ),
                  },
                  candidate,
              )
            : "Не удалось найти комнату для проверки балконной двери.";
        if (materialError) {
            setNotice(materialError);
            return;
        }
        commitScene({
            ...scene,
            doors: [...scene.doors, candidate],
            windows: scene.windows.filter((item) => item.id !== window.id),
        });
        setSelectedOpening({ kind: "door", id });
        setNotice("Окно стало балконной дверью. Уточните петли и направление открывания.");
    }, [commitScene, preview, scene, selectedOpeningData]);

    const convertSelectedBalconyDoorToWindow = useCallback(() => {
        if (selectedOpeningData?.kind !== "door") {
            return;
        }

        const door = selectedOpeningData.item as DoorOpening;
        if (door.doorKind !== "balcony") return;
        const id = `window-${Date.now()}`;
        commitScene({
            ...scene,
            doors: scene.doors.filter((item) => item.id !== door.id),
            windows: [
                ...scene.windows,
                {
                    id,
                    wall: door.wall,
                    segmentId: door.segmentId,
                    drawingHostId: door.drawingHostId,
                    offset: door.offset,
                    width: door.width,
                    windowKind: "standard",
                },
            ],
        });
        setSelectedOpening({ kind: "window", id });
        setNotice("Балконная дверь снова стала обычным окном.");
    }, [commitScene, scene, selectedOpeningData]);

    const startOpeningDrag = useCallback(
        (event: React.PointerEvent<SVGSVGElement>, opening: SelectedOpening) => {
            const current =
                opening.kind === "door"
                    ? sceneForInteractionRef.current.doors.find((item) => item.id === opening.id)
                    : sceneForInteractionRef.current.windows.find((item) => item.id === opening.id);
            const startPoint = pointFromEvent(event, false);
            if (!current || !startPoint) return;
            let allowedOffsets: number[] | undefined;
            if (opening.kind === "door" && !isHingedDoor(current as DoorOpening)) {
                const source = sceneForInteractionRef.current;
                const owner = openingOwner(previews, current);
                const segment = owner ? getRoomSegment(owner.room, current) : null;
                if (owner && segment) {
                    const step = 10;
                    const valid: number[] = [];
                    const scoped = scopedOpeningScene(source, owner);
                    for (
                        let offset = OPENING_END_CLEARANCE_MM;
                        offset <= segment.length - current.width - OPENING_END_CLEARANCE_MM;
                        offset += step
                    ) {
                        const candidate = resolveOpeningOffset(
                            scoped,
                            segment,
                            offset + current.width / 2,
                            current.width,
                            current.id,
                            step,
                        );
                        if (
                            candidate.valid &&
                            !getDoorCandidateError(owner.room, {
                                ...(current as DoorOpening),
                                offset: candidate.offset,
                            })
                        )
                            valid.push(candidate.offset);
                    }
                    // Preserve a valid legacy offset even when it is between grid points.
                    if (
                        !valid.includes(current.offset) &&
                        resolveOpeningOffset(
                            scoped,
                            segment,
                            current.offset + current.width / 2,
                            current.width,
                            current.id,
                            0.001,
                        ).valid &&
                        !getDoorCandidateError(owner.room, current as DoorOpening)
                    ) {
                        valid.push(current.offset);
                        valid.sort((a, b) => a - b);
                    }
                    // Do not jump through a blocking wall into a separate valid interval.
                    // An old invalid placement can still be repaired by dragging into one.
                    const startIndex = valid.indexOf(current.offset);
                    if (startIndex >= 0) {
                        let first = startIndex;
                        let last = startIndex;
                        while (first > 0 && valid[first] - valid[first - 1] <= step) first--;
                        while (last + 1 < valid.length && valid[last + 1] - valid[last] <= step)
                            last++;
                        allowedOffsets = valid.slice(first, last + 1);
                    } else allowedOffsets = valid;
                }
            }
            openingDragRef.current = {
                ...opening,
                startPoint,
                startOffset: current.offset,
                allowedOffsets,
            };
            event.preventDefault();
            setActiveToolGroup("openings");
            setOpeningDragSelection(opening);
            setSelectedContourWallEdge(null);
            setSelectedSegmentWallId(null);
            setSelectedOpening(opening);
            setOpeningDragPreview(null);
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
                capturedPointerRef.current = event.pointerId;
            } catch {
                // Pointer capture is a progressive enhancement only.
            }
        },
        [pointFromEvent, previews],
    );

    const handleBoardPointerDown = useCallback(
        (event: React.PointerEvent<SVGSVGElement>) => {
            if (
                !event.isPrimary ||
                (event.pointerType === "mouse" &&
                    event.button !== 0 &&
                    event.button !== 1 &&
                    !spacePan)
            ) {
                return;
            }
            const openingTarget = (event.target as Element | null)?.closest?.(
                "[data-draw-room-opening-id]",
            );
            const openingId = openingTarget?.getAttribute("data-draw-room-opening-id");
            const openingKind = openingTarget?.getAttribute("data-draw-room-opening-kind");
            if (
                openingId &&
                (openingKind === "door" || openingKind === "window") &&
                (tool === "select" || tool === "door" || tool === "window")
            ) {
                startOpeningDrag(event, { id: openingId, kind: openingKind });
                return;
            }
            if (tool === "select" || spacePan || event.button === 1) {
                if (tool === "select" && event.button === 0 && !spacePan) {
                    setSelectedContourWallEdge(null);
                    setSelectedSegmentWallId(null);
                    setSelectedOpening(null);
                    setSelectedRadiatorId(null);
                    if (activeToolGroup === "rooms" || activeToolGroup === "furniture") {
                        const point = pointFromEvent(event, false);
                        const hit =
                            point &&
                            renderedRoomRegions.find((region) =>
                                region.clearRects.some(
                                    (rect) =>
                                        point.x >= region.origin.x + rect.left &&
                                        point.x <= region.origin.x + rect.right &&
                                        point.y >= region.origin.y + rect.top &&
                                        point.y <= region.origin.y + rect.bottom,
                                ),
                            );
                        // While furnishing, a click beside the plan keeps the room in hand.
                        if (hit || activeToolGroup === "rooms")
                            setSelectedRegionSignature(hit ? hit.signature : null);
                    }
                }
                startPan(event);
                return;
            }
            // Do not round before resolving a magnetic candidate: the hit area
            // is measured from where the pointer actually went down.  A free
            // point is still snapped by the graph to the common 50 mm datum.
            const point = pointFromEvent(event, tool === "wall" ? false : true);
            if (!point) return;
            if (tool === "wall") {
                beginWallDrawing(event, point);
                return;
            }
            if (tool === "door" || tool === "window") addOpening(tool, point);
            if (tool === "radiator") addRadiator(point);
        },
        [
            activeToolGroup,
            addOpening,
            addRadiator,
            beginWallDrawing,
            pointFromEvent,
            renderedRoomRegions,
            spacePan,
            startOpeningDrag,
            startPan,
            tool,
        ],
    );

    const flushPendingWheelZoom = useCallback(() => {
        wheelZoomFrameRef.current = null;
        const board = boardRef.current;
        const pending = pendingWheelZoomRef.current.splice(0);
        if (!board || pending.length === 0) return;

        const bounds = board.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;

        let next = viewBoxRef.current;
        for (const wheel of pending) {
            const rendered = getRenderedViewBounds(bounds, next);
            const ratioX = clamp((wheel.clientX - rendered.left) / rendered.width, 0, 1);
            const ratioY = clamp((wheel.clientY - rendered.top) / rendered.height, 0, 1);
            const focus = {
                x: next.x + ratioX * next.width,
                y: next.y + ratioY * next.height,
            };
            // A smaller SVG viewBox means a larger drawing. Browser wheel-up is negative.
            const factor = Math.exp(wheel.deltaY * WHEEL_ZOOM_SENSITIVITY);
            const nextWidth = clamp(
                next.width * factor,
                fitViewBox.width / MAX_ZOOM,
                fitViewBox.width / MIN_ZOOM,
            );
            const nextHeight = nextWidth / (fitViewBox.width / fitViewBox.height);
            next = clampViewBox(
                {
                    x: focus.x - ratioX * nextWidth,
                    y: focus.y - ratioY * nextHeight,
                    width: nextWidth,
                    height: nextHeight,
                },
                fitViewBox,
            );
        }

        // Camera motion must not run annotation collision/layout or reconcile
        // the whole editor on every wheel tick. SVG applies the camera now;
        // React settles screen-space annotations once the gesture ends.
        viewBoxRef.current = next;
        board.setAttribute("viewBox", `${next.x} ${next.y} ${next.width} ${next.height}`);
        board.setAttribute("data-camera-moving", "true");
        if (zoomStatusRef.current) {
            zoomStatusRef.current.textContent = `Масштаб: ${Math.max(1, Math.round((fitViewBox.width / next.width) * 100))}%`;
        }
        const bleed = renderedWallThickness;
        board.querySelectorAll("[data-camera-envelope]").forEach((element) => {
            element.setAttribute("x", String(next.x - bleed));
            element.setAttribute("y", String(next.y - bleed));
            element.setAttribute("width", String(next.width + bleed * 2));
            element.setAttribute("height", String(next.height + bleed * 2));
        });
        if (wheelZoomSettleRef.current !== null) clearTimeout(wheelZoomSettleRef.current);
        wheelZoomSettleRef.current = setTimeout(() => {
            wheelZoomSettleRef.current = null;
            board.removeAttribute("data-camera-moving");
            setViewBox({ ...viewBoxRef.current });
        }, 120);
    }, [fitViewBox, renderedWallThickness]);

    const queueWheelZoom = useCallback(
        (clientX: number, clientY: number, deltaY: number, deltaMode: number) => {
            const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
            pendingWheelZoomRef.current.push({
                clientX,
                clientY,
                deltaY: clamp(deltaY * multiplier, -900, 900),
            });
            if (wheelZoomFrameRef.current === null) {
                wheelZoomFrameRef.current = requestAnimationFrame(flushPendingWheelZoom);
            }
        },
        [flushPendingWheelZoom],
    );

    useEffect(() => {
        const board = boardRef.current;
        if (!board) return;
        const handleNativeWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            queueWheelZoom(event.clientX, event.clientY, event.deltaY, event.deltaMode);
        };
        board.addEventListener("wheel", handleNativeWheel, { passive: false });
        return () => board.removeEventListener("wheel", handleNativeWheel);
    }, [queueWheelZoom]);

    const cancelContourWallDrag = useCallback((message = "Перемещение стены отменено.") => {
        const drag = contourWallDragRef.current;
        if (!drag) return false;
        contourWallDragRef.current = null;
        setActiveContourWallGrab(null);
        sceneForInteractionRef.current = cloneScene(drag.startScene);
        setHistory((current) => ({ ...current, present: cloneScene(drag.startScene) }));
        if (capturedPointerRef.current !== null) {
            try {
                boardRef.current?.releasePointerCapture(capturedPointerRef.current);
            } catch {
                // Pointer capture may already have been released by the browser.
            }
            capturedPointerRef.current = null;
        }
        setNotice(message);
        return true;
    }, []);

    const handleBoardPointerUp = useCallback(
        (event: React.PointerEvent<SVGSVGElement>) => {
            const contourDrag = contourWallDragRef.current;
            if (contourDrag) {
                contourWallDragRef.current = null;
                setActiveContourWallGrab(null);
                if (capturedPointerRef.current !== null) {
                    try {
                        event.currentTarget.releasePointerCapture(capturedPointerRef.current);
                    } catch {
                        // Capture may already have been released by the browser.
                    }
                    capturedPointerRef.current = null;
                }
                if (!contourDrag.changed) {
                    sceneForInteractionRef.current = cloneScene(contourDrag.startScene);
                    setHistory((current) => ({
                        ...current,
                        present: cloneScene(contourDrag.startScene),
                    }));
                    setNotice("Стена осталась на прежнем месте.");
                    return;
                }
                setHistory((current) => ({
                    past: [...current.past, cloneScene(contourDrag.startScene)].slice(-MAX_HISTORY),
                    present: cloneScene(current.present),
                    future: [],
                }));
                setNotice(
                    contourDrag.grab === "middle"
                        ? "Стена перемещена целиком. Проёмы и стыки сохранены."
                        : "Конец стены перемещён; противоположный стык остался закреплённым.",
                );
                return;
            }
            if (openingDragRef.current) {
                const dragged = openingDragRef.current;
                const candidate = openingDragPreview;
                openingDragRef.current = null;
                setOpeningDragSelection(null);
                setOpeningDragPreview(null);
                if (capturedPointerRef.current !== null) {
                    try {
                        event.currentTarget.releasePointerCapture(capturedPointerRef.current);
                    } catch {
                        // capture may have already been released
                    }
                    capturedPointerRef.current = null;
                }
                if (candidate?.valid) {
                    const collection = dragged.kind === "door" ? scene.doors : scene.windows;
                    const item = collection.find((opening) => opening.id === dragged.id);
                    if (item) {
                        if (dragged.kind === "door") {
                            commitScene({
                                ...scene,
                                doors: scene.doors.map((door) =>
                                    door.id === item.id
                                        ? { ...door, offset: candidate.offset }
                                        : door,
                                ),
                            });
                        } else {
                            commitScene({
                                ...scene,
                                windows: scene.windows.map((window) =>
                                    window.id === item.id
                                        ? { ...window, offset: candidate.offset }
                                        : window,
                                ),
                            });
                        }
                        setNotice(
                            `Проём перемещён вдоль этой стены с шагом ${dragged.allowedOffsets ? 10 : sceneSnapMm} мм.`,
                        );
                    }
                } else if (candidate?.message) {
                    setNotice(candidate.message);
                }
                return;
            }
            if (panningRef.current) {
                stopPan();
                setNotice("Перемещение поля завершено.");
                return;
            }
            if (!wallDrawingRef.current) return;
            commitWallSegmentFromDrag(event);
        },
        [commitScene, commitWallSegmentFromDrag, openingDragPreview, scene, sceneSnapMm, stopPan],
    );

    const stopWallDrawing = useCallback(() => {
        if (!wallDrawingRef.current) return;
        wallDrawingRef.current = false;
        wallDrawingAnchorRef.current = null;
        setWallDrawingAnchorPoint(null);
        setWallDrawingAnchorAttachment(null);
        setHoverPoint(null);
        setNotice("Незавершённый сегмент отменён.");
        if (capturedPointerRef.current !== null) {
            try {
                boardRef.current?.releasePointerCapture(capturedPointerRef.current);
            } catch {
                // capture already released
            }
            capturedPointerRef.current = null;
        }
    }, []);

    const handleBoardPointerLeave = useCallback(() => {
        setHoverPoint(null);
        setCursorPoint(null);
        stopPan();
        stopWallDrawing();
    }, [stopPan, stopWallDrawing]);

    const handleBoardPointerCancel = useCallback(() => {
        stopPan();
        stopWallDrawing();
        cancelContourWallDrag();
    }, [cancelContourWallDrag, stopPan, stopWallDrawing]);

    useEffect(() => {
        const stopActiveDrawing = () => {
            stopPan();
            stopWallDrawing();
            cancelContourWallDrag();
        };
        window.addEventListener("blur", stopActiveDrawing);
        return () => window.removeEventListener("blur", stopActiveDrawing);
    }, [cancelContourWallDrag, stopPan, stopWallDrawing]);

    useEffect(() => {
        return () => {
            if (
                wallDrawingRef.current ||
                contourWallDragRef.current ||
                capturedPointerRef.current !== null ||
                panPointerRef.current !== null
            ) {
                stopWallDrawing();
                stopPan();
                cancelContourWallDrag();
            }
        };
    }, [cancelContourWallDrag, stopPan, stopWallDrawing]);

    // The effect above re-runs its cleanup whenever those callbacks change.
    // A pending wheel frame or camera settle must survive such re-renders,
    // otherwise the zoomed camera never reaches React state; cancel them only
    // when the editor actually unmounts.
    useEffect(
        () => () => {
            if (wheelZoomFrameRef.current !== null) {
                cancelAnimationFrame(wheelZoomFrameRef.current);
            }
            if (wheelZoomSettleRef.current !== null) clearTimeout(wheelZoomSettleRef.current);
        },
        [],
    );

    const undo = useCallback(() => {
        setHistory((current) => {
            const previous = current.past[current.past.length - 1];
            if (!previous) return current;
            return {
                past: current.past.slice(0, -1),
                present: cloneScene(previous),
                future: [cloneScene(current.present), ...current.future],
            };
        });
        setNotice("Последнее действие отменено.");
    }, []);

    const redo = useCallback(() => {
        setHistory((current) => {
            const next = current.future[0];
            if (!next) return current;
            return {
                past: [...current.past, cloneScene(current.present)],
                present: cloneScene(next),
                future: current.future.slice(1),
            };
        });
        setNotice("Действие возвращено.");
    }, []);

    const clearScene = useCallback(() => {
        if (
            !scene.segments.length &&
            !scene.doors.length &&
            !scene.windows.length &&
            !scene.furniture?.length
        )
            return;
        if (!window.confirm("Очистить контур, проёмы и всю мебель?")) return;
        commitScene(EMPTY_SCENE);
        setTool("wall");
        setNotice("Поле очищено. Зажмите левую кнопку и ведите по сетке, чтобы нарисовать стену.");
    }, [
        commitScene,
        scene.doors.length,
        scene.segments.length,
        scene.windows.length,
        scene.furniture?.length,
    ]);

    /**
     * The tool rail and its open group panel float over the canvas's left
     * edge on desktop and tablet. A phone docks them as wide bottom sheets,
     * which are ignored here.
     */
    const getSideOverlayInset = useCallback(() => {
        const board = boardRef.current;
        const area = board?.closest("section");
        if (!board || !area) return 0;
        const boardBox = board.getBoundingClientRect();
        let right = boardBox.left;
        area.querySelectorAll(`.${styles.toolRail}, .${styles.toolGroupPanel}`).forEach(
            (element) => {
                const box = element.getBoundingClientRect();
                if (!box.width || !box.height) return;
                if (box.left > boardBox.left + 80 || box.width > boardBox.width * 0.6) return;
                right = Math.max(right, box.right);
            },
        );
        return clamp(right - boardBox.left, 0, boardBox.width / 2);
    }, []);

    /** Frames the drawing like "Вместить"; returns false when there is nothing to frame. */
    const fitDrawingToView = useCallback(() => {
        const leftInset = getSideOverlayInset();
        const contourFit = preview
            ? getContourFitViewBox(
                  previewContourPoints,
                  renderedWallThickness,
                  canvasSize,
                  leftInset,
              )
            : getSegmentsFitViewBox(scene.segments, renderedWallThickness, canvasSize, leftInset);
        const next = contourFit
            ? clampViewBox(contourFit, fitViewBox)
            : clampViewBox(fitViewBox, fitViewBox);
        viewBoxRef.current = next;
        setViewBox(next);
        return Boolean(contourFit);
    }, [
        canvasSize,
        fitViewBox,
        getSideOverlayInset,
        preview,
        previewContourPoints,
        renderedWallThickness,
        scene.segments,
    ]);

    useEffect(() => {
        if (!fitAfterSceneChangeRef.current || !preview || !canvasSize.width) return;
        fitAfterSceneChangeRef.current = false;
        fitDrawingToView();
    }, [canvasSize.width, fitDrawingToView, preview]);

    const applyRectTemplate = useCallback(
        (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const width = parseMeters(String(data.get("width") ?? ""));
            const depth = parseMeters(String(data.get("depth") ?? ""));
            const inRange = (value: number | null): value is number =>
                value !== null &&
                value >= RECT_TEMPLATE_LIMITS.min &&
                value <= RECT_TEMPLATE_LIMITS.max;
            if (!inRange(width) || !inRange(depth)) {
                setTemplateError(
                    `Ширина и глубина — от ${formatMeters(RECT_TEMPLATE_LIMITS.min)} до ${formatMeters(RECT_TEMPLATE_LIMITS.max)}.`,
                );
                return;
            }
            const current = sceneForInteractionRef.current;
            const templateRoom = createRectTemplateRoom(width, depth, current.wallThickness);
            const template = roomToDrawingScene(templateRoom);
            if (!template) {
                setTemplateError("Не удалось построить комнату с такими размерами.");
                return;
            }
            const hadDrawing = current.segments.length > 0;
            setMeasuring(false);
            stopWallDrawing();
            commitScene(bindLegacyOpenings(cloneScene(template)));
            setSelectedOpening(null);
            setSelectedContourWallEdge(null);
            setSelectedSegmentWallId(null);
            setTool("select");
            setActiveToolGroup("openings");
            setTemplateOpen(false);
            setTemplateError("");
            fitAfterSceneChangeRef.current = true;
            setNotice(
                `Комната ${formatMeters(templateRoom.width)} × ${formatMeters(templateRoom.depth)} построена с дверью и окном — передвиньте их на свои места.` +
                    (hadDrawing ? " Прежний чертёж вернёт кнопка «Отменить»." : ""),
            );
        },
        [commitScene, stopWallDrawing],
    );

    const takeNewerPlannerRoom = useCallback(() => {
        const converted = newerPlannerRoom && roomToDrawingScene(newerPlannerRoom);
        setNewerPlannerRoom(null);
        if (!converted) {
            setNotice("Не удалось перенести комнату с шага расстановки.");
            return;
        }
        stopWallDrawing();
        commitScene(bindLegacyOpenings(cloneScene(converted)));
        setSelectedOpening(null);
        setSelectedContourWallEdge(null);
        setSelectedSegmentWallId(null);
        setTool("select");
        fitAfterSceneChangeRef.current = true;
        setNotice("Стены взяты с шага расстановки. Прежний чертёж вернёт кнопка «Отменить».");
    }, [commitScene, newerPlannerRoom, stopWallDrawing]);

    // A phone shows the whole 16 m sheet, so a freshly closed room is a small
    // sketch with its dimensions hidden. Frame it once the cards around the
    // canvas have settled; the camera stays the person's after that.
    useEffect(() => {
        if (!autoFitPendingRef.current || !preview) return;
        if (!toolSheetOverlaysCanvas) {
            autoFitPendingRef.current = false;
            return;
        }
        fitDrawingToView();
        const timer = window.setTimeout(() => {
            autoFitPendingRef.current = false;
        }, AUTO_FIT_SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [fitDrawingToView, preview, toolSheetOverlaysCanvas]);

    const resetToOriginal = useCallback(() => {
        stopPan();
        stopWallDrawing();
        cancelContourWallDrag();
        pendingWheelZoomRef.current = [];
        if (wheelZoomFrameRef.current !== null) {
            cancelAnimationFrame(wheelZoomFrameRef.current);
            wheelZoomFrameRef.current = null;
        }
        if (wheelZoomSettleRef.current !== null) {
            // A wheel gesture paints the camera straight into the SVG and only
            // settles it into state later. Commit that painted camera first,
            // so the fit below is a real change React writes back to the DOM.
            clearTimeout(wheelZoomSettleRef.current);
            wheelZoomSettleRef.current = null;
            boardRef.current?.removeAttribute("data-camera-moving");
            flushSync(() => setViewBox({ ...viewBoxRef.current }));
        }
        sceneForInteractionRef.current = cloneScene(EMPTY_SCENE);
        setSelectedContourWallEdge(null);
        setSelectedSegmentWallId(null);
        setSelectedOpening(null);
        // The notice below invites drawing, so the blank sheet starts with walls.
        setTool("wall");
        setActiveToolGroup("walls");
        setHistory({ past: [], present: EMPTY_SCENE, future: [] });
        setHoverPoint(null);
        setCursorPoint(null);
        const nextViewBox = clampViewBox(fitViewBox, fitViewBox);
        viewBoxRef.current = nextViewBox;
        setViewBox(nextViewBox);
        setResetConfirmationOpen(false);
        try {
            getProjectStorage()?.removeItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY);
        } catch {
            // Ignore unavailable local storage; the visual reset still succeeded.
        }
        setNotice(
            "Чистый лист восстановлен. Зажмите левую кнопку и ведите по сетке, чтобы нарисовать стену.",
        );
    }, [cancelContourWallDrag, fitViewBox, stopPan, stopWallDrawing]);

    const requestResetToOriginal = useCallback(() => {
        const hasDrawingContent =
            scene.segments.length ||
            scene.doors.length ||
            scene.windows.length ||
            (scene.furniture?.length ?? 0);
        if (!hasDrawingContent) {
            resetToOriginal();
            return;
        }
        setResetConfirmationOpen(true);
    }, [
        resetToOriginal,
        scene.doors.length,
        scene.segments.length,
        scene.windows.length,
        scene.furniture?.length,
    ]);

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isTyping = Boolean(
                target?.closest(
                    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
                ),
            );
            if (event.altKey && event.key.toLowerCase() === "k") {
                event.preventDefault();
                openKeyboardEntry();
                return;
            }
            if (isTyping) return;
            if (
                (event.key === "Delete" || event.key === "Backspace") &&
                selectedRadiatorData &&
                !selectedOpening &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !keyboardEntryOpen
            ) {
                event.preventDefault();
                deleteSelectedRadiator();
                return;
            }
            if (
                (event.key === "Delete" || event.key === "Backspace") &&
                selectedOpening &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !keyboardEntryOpen
            ) {
                event.preventDefault();
                deleteSelectedOpening();
                return;
            }
            if (
                (event.key === "Delete" || event.key === "Backspace") &&
                tool === "select" &&
                (selectedContourWallEdge !== null || selectedSegmentWallId !== null) &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !keyboardEntryOpen
            ) {
                event.preventDefault();
                deleteSelectedWall();
                return;
            }
            if (event.code === "Space") {
                event.preventDefault();
                setSpacePan(true);
                setNotice("Режим перемещения включен. Тяни поле мышью.");
                return;
            }
            if (event.key === "Escape" && keyboardEntryOpen) {
                setKeyboardEntryOpen(false);
                setNotice("Ввод по координатам закрыт.");
                return;
            }
            if (event.key === "Escape" && cancelContourWallDrag()) {
                return;
            }
            if (
                event.key === "Escape" &&
                (selectedContourWallEdge !== null || selectedSegmentWallId !== null)
            ) {
                setSelectedContourWallEdge(null);
                setSelectedSegmentWallId(null);
                setNotice("Выделение стены снято.");
                return;
            }
            if (event.key === "Escape" && hoverPoint) {
                setHoverPoint(null);
                setNotice("Незавершённый сегмент отменён.");
                stopWallDrawing();
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (event.shiftKey) redo();
                else undo();
            }
        };
        window.addEventListener("keydown", handleKey);
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                setSpacePan(false);
                setNotice("Режим перемещения отключен.");
            }
        };
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKey);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [
        cancelContourWallDrag,
        deleteSelectedOpening,
        deleteSelectedRadiator,
        deleteSelectedWall,
        selectedOpening,
        selectedRadiatorData,
        hoverPoint,
        keyboardEntryOpen,
        openKeyboardEntry,
        redo,
        selectedContourWallEdge,
        selectedSegmentWallId,
        stopWallDrawing,
        tool,
        undo,
    ]);

    const ghost = useMemo(
        () =>
            tool === "wall" && wallDrawingAnchorPoint && hoverPoint
                ? { start: wallDrawingAnchorPoint, end: hoverPoint }
                : null,
        [hoverPoint, tool, wallDrawingAnchorPoint],
    );
    // Hover stays deliberately quiet: only the 50 mm cell moves under the
    // cursor.  The magnet is resolved and revealed on pointer down, not while
    // merely passing an existing wall.
    const wallCursor = tool === "wall" ? ghost?.end ?? hoverPoint : null;
    const wallCursorCellOrigin = wallCursor
        ? getWallCursorCellOrigin(wallCursor, renderedWallThickness)
        : null;
    const hasMagneticDrawingAnchor =
        Boolean(ghost) &&
        wallDrawingAnchorAttachment !== null &&
        wallDrawingAnchorAttachment !== "free";
    const constructionGuidePoint = hasMagneticDrawingAnchor ? ghost?.start ?? null : null;
    const constructionGuideAttachment = hasMagneticDrawingAnchor
        ? wallDrawingAnchorAttachment
        : null;
    const guideMarkerRadius = Math.max(18, millimetersPerPixel * 5);
    const guideMagnetRadius = Math.max(180, millimetersPerPixel * 18);
    const liveDimensionObstacles: LiveDimensionObstacle[] = [
        ...(showCommittedDimensions
            ? getPersistentDimensionObstacles(
                  persistentWallDimensions,
                  annotationMillimetersPerPixel,
              )
            : []),
        ...(constructionGuidePoint
            ? [
                  {
                      rect: {
                          left: constructionGuidePoint.x - guideMagnetRadius,
                          right: constructionGuidePoint.x + guideMagnetRadius,
                          top: constructionGuidePoint.y - guideMagnetRadius,
                          bottom: constructionGuidePoint.y + guideMagnetRadius,
                      },
                      // Extension lines are allowed to begin at the magnetic
                      // wall corner; only a text label must stay clear of it.
                      blockLines: false,
                  },
              ]
            : []),
        ...(wallCursorCellOrigin
            ? [
                  {
                      rect: {
                          left: wallCursorCellOrigin.x,
                          right: wallCursorCellOrigin.x + renderedWallThickness,
                          top: wallCursorCellOrigin.y,
                          bottom: wallCursorCellOrigin.y + renderedWallThickness,
                      },
                      blockLines: false,
                  },
              ]
            : []),
    ];
    const liveWallDimensions = ghost
        ? getLiveWallDimensions(
              ghost,
              renderedWallThickness,
              annotationMillimetersPerPixel,
              wallDrawingAnchorAttachment,
              liveDimensionObstacles,
              viewBox,
          )
        : [];
    // While a wall is being dragged its live values take priority: a committed
    // label the live overlay could not avoid steps aside until release.
    const liveLabelBounds = liveWallDimensions.map(getLiveDimensionLabelBounds);
    const visiblePersistentWallDimensions = liveLabelBounds.length
        ? persistentWallDimensions.filter((dimension) => {
              const label = getPersistentDimensionLabelBounds(
                  dimension,
                  annotationMillimetersPerPixel,
              );
              return !liveLabelBounds.some((live) => rectsOverlap(label, live, 0));
          })
        : persistentWallDimensions;
    const liveWallEnvelope = ghost
        ? getWallEnvelopeFromPoints(ghost.start, ghost.end, renderedWallThickness)
        : null;
    const liveWallLength =
        ghost && liveWallEnvelope
            ? ghost.start.y === ghost.end.y
                ? liveWallEnvelope.right - liveWallEnvelope.left
                : liveWallEnvelope.bottom - liveWallEnvelope.top
            : 0;
    const liveDimensionLayout =
        ghost && liveWallLength > 0 && liveWallDimensions.length < 4 ? "compact" : "full";
    const roomInspectorOpen = activeToolGroup === "rooms" && renderedRoomRegions.length > 0;
    // Room H/S labels would sit on top of the pieces being placed.
    const furnitureStep = activeToolGroup === "furniture";
    const selectedRegion =
        renderedRoomRegions.find((region) => region.signature === selectedRegionSignature) ?? null;
    // Furniture goes into one room; without a choice yet, the first room is it.
    const furnitureRegion = selectedRegion ?? renderedRoomRegions[0] ?? null;
    const regionRooms = useMemo(
        () =>
            renderedRoomRegions.map((region) => ({
                region,
                room: {
                    name: region.name,
                    kind: region.kind,
                    rects: region.clearRects.map((rect) => ({
                        left: region.origin.x + rect.left,
                        right: region.origin.x + rect.right,
                        top: region.origin.y + rect.top,
                        bottom: region.origin.y + rect.bottom,
                    })),
                } satisfies FurnitureRoom,
            })),
        [renderedRoomRegions],
    );
    const resultStep = activeToolGroup === "result";
    const resultSummary = useMemo(() => {
        if (!resultStep) return null;
        const items = scene.furniture ?? [];
        const rooms: ResultRoom[] = regionRooms.map(({ region }) => ({
            signature: region.signature,
            name: region.name,
            areaSquareMillimeters: region.areaSquareMillimeters,
            items: [],
        }));
        const unassigned: ResultItem[] = [];
        const placements: { item: DrawFurniture; roomName?: string }[] = [];
        let conflictCount = 0;
        items.forEach((item) => {
            const index = regionRooms.findIndex(({ room }) => furnitureBelongsToRoom(item, room));
            const owner = index >= 0 ? regionRooms[index] : null;
            const conflict = Boolean(
                furnitureError(
                    item,
                    items,
                    scene.segments,
                    renderedWallThickness,
                    furnitureDoorObstacles,
                    owner?.room ?? null,
                    furnitureRadiatorObstacles,
                ),
            );
            if (conflict) conflictCount += 1;
            const { width, depth } = furnitureGeometry(item);
            const entry: ResultItem = {
                id: item.id,
                label: furnitureDefinition(item.definitionId)?.label ?? item.definitionId,
                width,
                depth,
                conflict,
            };
            if (index >= 0) rooms[index].items.push(entry);
            else unassigned.push(entry);
            // The file holds the main building; its rooms carry the prefix.
            if (!preview || (owner && owner.region.buildingId === regionPrefix(preview)))
                placements.push({ item, roomName: owner?.region.name });
        });
        return { rooms, unassigned, conflictCount, placements };
    }, [
        furnitureDoorObstacles,
        furnitureRadiatorObstacles,
        preview,
        regionRooms,
        renderedWallThickness,
        resultStep,
        scene.furniture,
        scene.segments,
    ]);
    const [resultStatus, setResultStatus] = useState("");
    const [resultBusy, setResultBusy] = useState(false);
    const [printImageUrl, setPrintImageUrl] = useState<string | null>(null);
    const renderResultPng = useCallback(async () => {
        if (!preview || !resultSummary) throw new Error("Сначала замкните контур квартиры.");
        const specification = buildDrawingPlanSpecification({
            room: preview.room,
            placements: resultSummary.placements.map(({ item, roomName }) => ({
                instanceId: item.id,
                definitionId: item.definitionId,
                x: item.x - preview.origin.x,
                y: item.y - preview.origin.y,
                rotation: item.rotation,
                width: item.width,
                depth: item.depth,
                ...(roomName ? { roomName } : {}),
            })),
            conflictCount: resultSummary.conflictCount,
            caveats:
                previews.length > 1
                    ? ["В файл вошла основная постройка; отдельно стоящие контуры не показаны."]
                    : [],
            generatedAt: new Date().toISOString(),
        });
        return {
            blob: await renderPlanSpecificationPng(specification),
            filename: getPlanExportFilename(specification.generatedAt),
            items: specification.items.length,
        };
    }, [preview, previews.length, resultSummary]);
    const downloadResult = useCallback(async () => {
        setResultBusy(true);
        setResultStatus("Готовим PNG…");
        try {
            const { blob, filename, items } = await renderResultPng();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            setResultStatus("PNG сохранён.");
            trackGoal("plan_png_export", { items, source: "drawing" });
        } catch (error) {
            setResultStatus(error instanceof Error ? error.message : "Не удалось сохранить PNG.");
        } finally {
            setResultBusy(false);
        }
    }, [renderResultPng]);
    const printResult = useCallback(async () => {
        setResultBusy(true);
        setResultStatus("Готовим лист для печати…");
        try {
            const { blob } = await renderResultPng();
            // The print sheet shows this image only; the dialog opens once it loads.
            setPrintImageUrl(URL.createObjectURL(blob));
            trackGoal("plan_print", { source: "drawing" });
        } catch (error) {
            setResultBusy(false);
            setResultStatus(
                error instanceof Error ? error.message : "Не удалось подготовить печать.",
            );
        }
    }, [renderResultPng]);
    useEffect(() => {
        if (!printImageUrl) return;
        const done = () => {
            URL.revokeObjectURL(printImageUrl);
            setPrintImageUrl(null);
            setResultBusy(false);
            setResultStatus("Лист отправлен в системный диалог печати.");
        };
        window.addEventListener("afterprint", done, { once: true });
        return () => window.removeEventListener("afterprint", done);
    }, [printImageUrl]);
    const furnitureRoom = useMemo<FurnitureRoom | null>(
        () =>
            furnitureRegion
                ? {
                      name: furnitureRegion.name,
                      kind: furnitureRegion.kind,
                      rects: furnitureRegion.clearRects.map((rect) => ({
                          left: furnitureRegion.origin.x + rect.left,
                          right: furnitureRegion.origin.x + rect.right,
                          top: furnitureRegion.origin.y + rect.top,
                          bottom: furnitureRegion.origin.y + rect.bottom,
                      })),
                  }
                : null,
        [furnitureRegion],
    );

    // «Авторасстановка»: the room's own pieces, solved in a worker for that room alone.
    const [autoLayoutSolving, setAutoLayoutSolving] = useState(false);
    const [autoLayoutStatus, setAutoLayoutStatus] = useState("");
    const [autoLayoutApplied, setAutoLayoutApplied] = useState<number | null>(null);
    const [autoLayoutVariants, setAutoLayoutVariants] = useState<{
        signature: string;
        /** The pieces they were solved for; a piece added or removed makes them stale. */
        setKey: string;
        variants: {
            summary: AutoLayoutVariantSummary;
            pieces: DrawFurniture[];
            observation?: PlannerObservationCreateInput;
        }[];
    } | null>(null);
    const { isAuthenticated } = useAuth();
    // Saved review-queue records of the offered variants, by variant index.
    const [autoLayoutObservationIds, setAutoLayoutObservationIds] = useState<
        Record<number, number>
    >({});
    const [autoLayoutReviewStatus, setAutoLayoutReviewStatus] = useState("");
    const submitAutoLayoutReview = useCallback(
        async (review: { verdict: PlannerObservationVerdict; comment: string }) => {
            const index = autoLayoutApplied;
            const variant = index === null ? null : autoLayoutVariants?.variants[index];
            if (index === null || !variant?.observation) return;
            if (!isAuthEnabled || !isAuthenticated) {
                setAutoLayoutReviewStatus("Войдите, чтобы отправить вариант на разбор.");
                return;
            }
            setAutoLayoutReviewStatus("Отправляем…");
            try {
                const id =
                    autoLayoutObservationIds[index] ??
                    (await plannerObservationService.create(variant.observation)).id;
                setAutoLayoutObservationIds((current) => ({ ...current, [index]: id }));
                await plannerObservationService.saveReview(id, review);
                setAutoLayoutReviewStatus("Отзыв отправлен на разбор. Спасибо!");
            } catch (error) {
                setAutoLayoutReviewStatus(
                    error instanceof Error ? error.message : "Не удалось отправить отзыв.",
                );
            }
        },
        [autoLayoutApplied, autoLayoutObservationIds, autoLayoutVariants, isAuthenticated],
    );
    const autoLayoutWorker = useRef<Worker | null>(null);
    useEffect(() => () => autoLayoutWorker.current?.terminate(), []);
    const autoLayoutPieces = useMemo(
        () =>
            furnitureRoom
                ? (scene.furniture ?? []).filter((item) =>
                      furnitureBelongsToRoom(item, furnitureRoom),
                  )
                : [],
        [furnitureRoom, scene.furniture],
    );
    const autoLayoutSet = useMemo(() => roomFurnitureSet(autoLayoutPieces), [autoLayoutPieces]);
    const autoLayoutSetKey = JSON.stringify(autoLayoutSet);
    // The solver knows catalogue sizes only.
    const autoLayoutResized = autoLayoutPieces.some((item) => {
        const definition = furnitureDefinition(item.definitionId);
        if (!definition || definition.mounting === "upper") return false;
        const base = getRotatedGeometry(definition, 0);
        return item.width !== base.width || item.depth !== base.depth;
    });
    const autoLayoutTarget = useMemo(() => {
        if (!furnitureRegion || !furnitureRoom) return null;
        const owner = previews.find((item) => regionPrefix(item) === furnitureRegion.buildingId);
        if (!owner) return null;
        const items = scene.furniture ?? [];
        const own = items.filter((item) => furnitureBelongsToRoom(item, furnitureRoom));
        if (own.some((item) => item.locked))
            return {
                status: "unsupported" as const,
                message:
                    "В комнате есть закреплённые предметы. Снимите закрепление, чтобы подобрать расстановку.",
            };
        const cut = buildRegionSolverRoom(owner.room, furnitureRegion);
        if (cut.status !== "ready") return cut;
        return {
            ...cut,
            offset: { x: owner.origin.x + cut.origin.x, y: owner.origin.y + cut.origin.y },
            // Upper units are not rearranged; they stay over the worktop.
            kept: items.filter(
                (item) =>
                    !own.includes(item) ||
                    furnitureDefinition(item.definitionId)?.mounting === "upper",
            ),
        };
    }, [furnitureRegion, furnitureRoom, previews, scene.furniture]);
    const requestSolver = useCallback(
        (request: SolverPayload) =>
            new Promise<SolverWorkerResponse>((resolve, reject) => {
                autoLayoutWorker.current?.terminate();
                const worker = new Worker(
                    new URL("../../lib/furniture-planner/solver.worker.ts", import.meta.url),
                );
                autoLayoutWorker.current = worker;
                worker.onmessage = (event: MessageEvent<SolverWorkerResponse>) => {
                    worker.terminate();
                    resolve(event.data);
                };
                worker.onerror = (event) => {
                    worker.terminate();
                    reject(new Error(event.message || "Не удалось выполнить расчёт."));
                };
                worker.postMessage({ ...request, requestId: 1 } as SolverWorkerRequest);
            }),
        [],
    );
    const solveAutoLayout = useCallback(async () => {
        if (!furnitureRegion || !furnitureRoom || autoLayoutTarget?.status !== "ready") return;
        const target = autoLayoutTarget;
        const instances = buildRoomInstances(autoLayoutSet);
        setAutoLayoutSolving(true);
        setAutoLayoutStatus("Подбираем варианты…");
        setAutoLayoutApplied(null);
        try {
            let solved: (PlannerObservationTarget & { label: string })[] = [];
            const response = await requestSolver({
                action: "solve-variants",
                room: target.room,
                instances,
                preferences: {},
                limit: 3,
            });
            if (response.ok && response.action === "solve-variants") {
                if (response.result.status === "success") {
                    solved = response.result.variants.map((variant) => ({
                        id: variant.variantId,
                        label: variant.profile.label,
                        profile: variant.profile,
                        placements: variant.placements,
                        exploredNodes: variant.exploredNodes,
                        score: variant.score,
                        notes: variant.notes,
                        solverStatus: "success" as const,
                    }));
                } else {
                    // As on the layout step: fall back to what fits, dropping optional pieces.
                    const fallback = await requestSolver({
                        action: "solve-preferred-fallback",
                        room: target.room,
                        instances,
                        preferences: {},
                    });
                    if (
                        fallback.ok &&
                        fallback.action === "solve-preferred-fallback" &&
                        fallback.result.result.status === "success"
                    )
                        solved = [
                            {
                                id: WORKING_CORE_OBSERVATION_ID,
                                label: fallback.result.unplacedInstances.length
                                    ? `Не поместилось: ${Array.from(
                                          new Set(
                                              fallback.result.unplacedInstances.map(
                                                  (instance) =>
                                                      furnitureDefinition(instance.definitionId)
                                                          ?.label ?? instance.definitionId,
                                              ),
                                          ),
                                      ).join(", ")}`
                                    : "Всё поместилось",
                                placements: fallback.result.result.placements,
                                exploredNodes: fallback.result.result.exploredNodes,
                                score: fallback.result.result.score,
                                notes: fallback.result.result.notes,
                                solverStatus: "partial" as const,
                                workingCore: {
                                    requestedItemCount: instances.length,
                                    unplacedInstanceIds: fallback.result.unplacedInstances.map(
                                        (instance) => instance.instanceId,
                                    ),
                                },
                            },
                        ];
                }
            }
            // A variant must also hold in the whole apartment, as hand-placed pieces do.
            const variants = solved.flatMap((variant, index) => {
                const pieces = solvedToDrawFurniture(
                    variant.placements,
                    target.offset,
                    `furniture-auto-${Date.now()}-${index + 1}`,
                );
                const all = [...target.kept, ...pieces];
                const fits = pieces.every(
                    (piece) =>
                        !furnitureError(
                            piece,
                            all,
                            scene.segments,
                            renderedWallThickness,
                            furnitureDoorObstacles,
                            furnitureRoom,
                            furnitureRadiatorObstacles,
                        ),
                );
                return fits && pieces.length
                    ? [
                          {
                              summary: { label: variant.label, count: pieces.length },
                              pieces,
                              target: variant,
                          },
                      ]
                    : [];
            });
            // Each offered variant goes to the designer review queue, as on the layout step.
            const observationRequests = createPlannerObservationRequests({
                room: target.room,
                selection: autoLayoutSet,
                priorities: Object.fromEntries(
                    instances.map((instance) => [instance.definitionId, instance.priority]),
                ),
                preferences: {},
                instances,
                targets: variants.map((variant) => variant.target),
                generatedAt: new Date().toISOString(),
                inputSignature: JSON.stringify({ room: target.room, set: autoLayoutSet }),
            });
            setAutoLayoutVariants({
                signature: furnitureRegion.signature,
                setKey: autoLayoutSetKey,
                variants: variants.map((variant) => ({
                    ...variant,
                    observation: observationRequests[variant.target.id],
                })),
            });
            setAutoLayoutObservationIds({});
            if (isAuthEnabled && isAuthenticated) {
                void Promise.allSettled(
                    variants.map(async (variant, index) => {
                        const request = observationRequests[variant.target.id];
                        if (!request) return;
                        const saved = await plannerObservationService.create(request);
                        setAutoLayoutObservationIds((current) => ({
                            ...current,
                            [index]: saved.id,
                        }));
                    }),
                );
            }
            setAutoLayoutStatus(
                variants.length
                    ? "Выберите вариант — он заменит мебель этой комнаты. Отменить можно кнопкой «Отменить»."
                    : "Не получилось расставить эту мебель. Уберите часть предметов и попробуйте ещё раз.",
            );
            trackGoal(variants.length ? "layout_generated" : "layout_failed", {
                source: "drawing",
                variants: variants.length,
            });
        } catch (error) {
            setAutoLayoutStatus(
                error instanceof Error ? error.message : "Не удалось выполнить расчёт.",
            );
        } finally {
            setAutoLayoutSolving(false);
        }
    }, [
        autoLayoutSet,
        autoLayoutSetKey,
        autoLayoutTarget,
        isAuthenticated,
        furnitureDoorObstacles,
        furnitureRadiatorObstacles,
        furnitureRegion,
        furnitureRoom,
        renderedWallThickness,
        requestSolver,
        scene.segments,
    ]);
    const currentAutoLayoutVariants = useMemo(
        () =>
            autoLayoutVariants &&
            autoLayoutVariants.signature === furnitureRegion?.signature &&
            autoLayoutVariants.setKey === autoLayoutSetKey
                ? autoLayoutVariants.variants
                : [],
        [autoLayoutVariants, autoLayoutSetKey, furnitureRegion?.signature],
    );
    const applyAutoLayout = useCallback(
        (index: number) => {
            const variant = currentAutoLayoutVariants[index];
            if (!variant || autoLayoutTarget?.status !== "ready") return;
            commitScene({ ...scene, furniture: [...autoLayoutTarget.kept, ...variant.pieces] });
            setAutoLayoutApplied(index);
            setNotice(`Вариант ${index + 1} расставлен. Предметы можно двигать вручную.`);
        },
        [autoLayoutTarget, commitScene, currentAutoLayoutVariants, scene],
    );
    // Opening the contour again takes away the rooms and the furniture step.
    const activeStepLost =
        (activeToolGroup === "rooms" && renderedRoomRegions.length === 0) ||
        ((activeToolGroup === "furniture" || activeToolGroup === "result") && !preview);
    useEffect(() => {
        if (activeStepLost) setActiveToolGroup("walls");
    }, [activeStepLost]);
    // «Итог» in the project steps opens the planner on its result step, also
    // when the planner is already open and only the address changes.
    const handledStepLink = useRef<string | null>(null);
    useEffect(() => {
        if (!router.isReady || !preview || handledStepLink.current === router.asPath) return;
        handledStepLink.current = router.asPath;
        if (router.query.step === "result") setActiveToolGroup("result");
    }, [preview, router.asPath, router.isReady, router.query.step]);
    const stepAvailable = (group: ToolGroup) =>
        group === "rooms"
            ? renderedRoomRegions.length > 0
            : group === "furniture" || group === "result"
              ? Boolean(preview)
              : true;
    const selectStep = (group: ToolGroup) => {
        if (group === "walls" || group === "openings") {
            toggleToolGroup(group);
            return;
        }
        setTool("select");
        setMeasuring(false);
        setSelectedOpening(null);
        setSelectedContourWallEdge(null);
        setSelectedSegmentWallId(null);
        setActiveToolGroup(group);
        setToolSheetCollapsed(false);
    };
    const isToolSheetOpen = (group: ToolGroup) =>
        activeToolGroup === group && !(toolSheetOverlaysCanvas && toolSheetCollapsed);
    const toggleToolGroup = (group: ToolGroup) => {
        if (toolSheetOverlaysCanvas && isToolSheetOpen(group)) {
            setToolSheetCollapsed(true);
            return;
        }
        if (toolSheetOverlaysCanvas) {
            // A selected door or wall card takes the sheet's place on a phone;
            // asking for tools again means the person is done with that card.
            setSelectedOpening(null);
            setSelectedContourWallEdge(null);
            setSelectedSegmentWallId(null);
        }
        setActiveToolGroup(group);
        setToolSheetCollapsed(false);
    };
    const visibleNotice = measuring
        ? "Линейка: укажите две точки на плане. Esc — закрыть."
        : activeToolGroup === "furniture"
          ? "Выберите мебель на плане. Потяните, чтобы переместить."
          : ghost
            ? wallDrawingAnchorAttachment === "endpoint"
                ? "От конца стены"
                : wallDrawingAnchorAttachment === "side"
                  ? "От стороны стены"
                  : "Тяните стену"
            : openingPreview?.message ?? openingDragPreview?.message ?? notice;
    const openWallComponents = useMemo(
        () =>
            getConnectedWallComponents(scene.segments).map((segments, index) => ({
                id: `open-wall-component-${index + 1}`,
                segments,
                path: getOpenWallUnionPath(segments, renderedWallThickness),
            })),
        [renderedWallThickness, scene.segments],
    );

    return (
        <>
            <Head>
                <title>Планировщик квартиры · StyleFinder</title>
                <meta
                    name="description"
                    content="Нарисуйте квартиру, расставьте мебель по комнатам и получите план с проверкой проходов."
                />
                <meta name="robots" content="noindex,follow" />
            </Head>
            <main
                className={styles.editor}
                data-draw-room-editor="true"
                data-show-dimensions={layers.dimensions}
                data-show-rooms={layers.rooms}
                data-show-furniture={layers.furniture}
                data-show-grid={layers.grid}
            >
                <header className={styles.appBar}>
                    <div className={styles.identity}>
                        <Link
                            href="/projects"
                            className={styles.backButton}
                            aria-label="Назад к проектам"
                        >
                            <ToolIcon name="back" />
                            <span>К проектам</span>
                        </Link>
                        <Link
                            href="/"
                            className={styles.brand}
                            aria-label="StyleFinder — на главную"
                        >
                            <span className={styles.brandMark} aria-hidden="true">
                                S
                            </span>
                            <span>StyleFinder</span>
                        </Link>
                        <span className={styles.crumb}>
                            Планировщик <b>/</b> Квартира
                        </span>
                        <h1>Планировщик квартиры</h1>
                    </div>
                    <div className={styles.topTools} aria-label="Действия чертежа">
                        <button
                            type="button"
                            onClick={undo}
                            disabled={history.past.length === 0}
                            aria-label="Отменить"
                            title="Отменить"
                        >
                            <ToolIcon name="undo" />
                        </button>
                        <button
                            type="button"
                            onClick={redo}
                            disabled={history.future.length === 0}
                            aria-label="Вернуть"
                            title="Вернуть"
                        >
                            <ToolIcon name="redo" />
                        </button>
                        <button
                            type="button"
                            className={`${styles.resetButton} ${styles.templateButton}`}
                            data-draw-room-tool="rect-template"
                            onClick={() => setTemplateOpen(true)}
                            aria-haspopup="dialog"
                            aria-label="Прямоугольная комната по размерам"
                            title="Прямоугольная комната по размерам"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                            >
                                <rect x="4" y="6" width="16" height="12" />
                                <path d="M4 3v2M20 3v2M4 4h16" />
                            </svg>
                            <span>Комната по размерам</span>
                        </button>
                        <button
                            type="button"
                            className={styles.resetButton}
                            onClick={requestResetToOriginal}
                            aria-haspopup="dialog"
                            aria-label="Вернуться к исходнику"
                            title="Вернуться к исходнику"
                        >
                            <ToolIcon name="reset" />
                            <span>Вернуться к исходнику</span>
                        </button>
                        <span className={styles.separator} aria-hidden="true" />
                        <button
                            type="button"
                            onClick={() => {
                                const contourFit = fitDrawingToView();
                                setNotice(
                                    contourFit
                                        ? preview
                                            ? "Контур показан целиком с размерными цепочками."
                                            : "Нарисованные стены показаны целиком."
                                        : "Поле показано целиком.",
                                );
                            }}
                            className={styles.fitButton}
                            aria-label="Вместить"
                            title="Вместить"
                        >
                            <ToolIcon name="fit" />
                            <span>Вместить</span>
                        </button>
                        <button
                            type="button"
                            className={styles.primary}
                            onClick={() => selectStep("result")}
                            disabled={!preview}
                            title={
                                preview
                                    ? "Список мебели по комнатам, PNG и печать"
                                    : "Сначала замкните стены квартиры"
                            }
                        >
                            К итогу
                        </button>
                    </div>
                </header>
                <ProjectTools
                    scene={{
                        ...scene,
                        regions: {
                            version: 1,
                            items: renderedRoomRegions.map(toRoomRegionMetadata),
                        },
                    }}
                    measuring={measuring}
                    onMeasure={() => {
                        selectTool("select");
                        setMeasuring(!measuring);
                        setActiveToolGroup("walls");
                        setSelectedOpening(null);
                        setSelectedContourWallEdge(null);
                        setSelectedSegmentWallId(null);
                    }}
                    steps={
                        <nav className={styles.stepTabs} aria-label="Шаги чертежа">
                            {DRAW_STEPS.map((step, index) => (
                                <button
                                    key={step.group}
                                    type="button"
                                    className={styles.stepTab}
                                    data-draw-room-step={step.group}
                                    aria-current={
                                        activeToolGroup === step.group ? "step" : undefined
                                    }
                                    aria-controls={step.controls}
                                    aria-expanded={
                                        step.controls ? isToolSheetOpen(step.group) : undefined
                                    }
                                    disabled={!stepAvailable(step.group)}
                                    title={
                                        stepAvailable(step.group)
                                            ? undefined
                                            : step.group === "rooms"
                                              ? "Помещения появятся, когда стены замкнут контур"
                                              : "Сначала замкните стены"
                                    }
                                    onClick={() => selectStep(step.group)}
                                >
                                    <span aria-hidden="true">{index + 1}</span>
                                    {step.label}
                                </button>
                            ))}
                        </nav>
                    }
                    status={autosaveStatus}
                    layers={layers}
                    onLayers={setLayers}
                    onLoad={(loaded) => {
                        setMeasuring(false);
                        commitScene(bindLegacyOpenings(cloneScene(loaded)));
                        setSelectedOpening(null);
                        setSelectedContourWallEdge(null);
                        setSelectedSegmentWallId(null);
                        setActiveToolGroup("walls");
                        setTool("select");
                        setLayers(DEFAULT_DRAWING_LAYERS);
                        setNotice(
                            "Чертёж открыт. Предыдущий чертёж можно вернуть кнопкой «Отменить».",
                        );
                    }}
                />

                <Dialog
                    open={templateOpen}
                    title="Прямоугольная комната"
                    onCancel={() => {
                        setTemplateOpen(false);
                        setTemplateError("");
                    }}
                    actions={
                        <>
                            <button data-variant="primary" form="draw-room-template" type="submit">
                                Построить
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setTemplateOpen(false);
                                    setTemplateError("");
                                }}
                            >
                                Отмена
                            </button>
                        </>
                    }
                >
                    {templateOpen ? (
                        <form
                            id="draw-room-template"
                            className={styles.templateForm}
                            onSubmit={applyRectTemplate}
                            noValidate
                        >
                            <p>
                                Размеры внутри комнаты, от стены до стены. Стены, двери и окна можно
                                поправить после.
                            </p>
                            <label>
                                Ширина, м
                                <input
                                    name="width"
                                    inputMode="decimal"
                                    defaultValue={
                                        preview
                                            ? String(preview.room.width / 1000).replace(".", ",")
                                            : "3,6"
                                    }
                                    required
                                />
                            </label>
                            <label>
                                Глубина, м
                                <input
                                    name="depth"
                                    inputMode="decimal"
                                    defaultValue={
                                        preview
                                            ? String(preview.room.depth / 1000).replace(".", ",")
                                            : "4,2"
                                    }
                                    required
                                />
                            </label>
                            {templateError ? <p role="alert">{templateError}</p> : null}
                            {scene.segments.length > 0 ? (
                                <p>
                                    Текущий чертёж заменится; вернуть его можно кнопкой «Отменить».
                                </p>
                            ) : null}
                        </form>
                    ) : null}
                </Dialog>

                {resetConfirmationOpen && (
                    <div
                        className={styles.resetDialogBackdrop}
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget)
                                setResetConfirmationOpen(false);
                        }}
                    >
                        <section
                            className={styles.resetDialog}
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby="draw-room-reset-title"
                            aria-describedby="draw-room-reset-copy"
                            data-draw-room-reset-dialog="true"
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setResetConfirmationOpen(false);
                                }
                            }}
                        >
                            <div className={styles.resetDialogIcon} aria-hidden="true">
                                <ToolIcon name="reset" />
                            </div>
                            <div>
                                <h2 id="draw-room-reset-title">Вернуться к исходнику?</h2>
                                <p id="draw-room-reset-copy">
                                    Удалить стены, проёмы, мебель и историю действий?
                                </p>
                            </div>
                            <div className={styles.resetDialogActions}>
                                <button
                                    type="button"
                                    className={styles.resetCancelButton}
                                    onClick={() => setResetConfirmationOpen(false)}
                                    autoFocus
                                >
                                    Отмена
                                </button>
                                <button
                                    type="button"
                                    className={styles.resetConfirmButton}
                                    onClick={resetToOriginal}
                                >
                                    Удалить всё
                                </button>
                            </div>
                        </section>
                    </div>
                )}

                <div className={styles.canvasMeta} aria-live="polite">
                    <span className={styles.activeToolLabel}>
                        <i aria-hidden="true">
                            <ToolIcon name={tool} />
                        </i>
                        <b>
                            {tool === "wall"
                                ? "Стена"
                                : tool === "door"
                                  ? "Дверь"
                                  : tool === "window"
                                    ? "Окно"
                                    : tool === "radiator"
                                      ? "Радиатор"
                                      : "Выбор"}
                        </b>
                    </span>
                    <span className={styles.canvasNotice} data-draw-room-notice="true">
                        {visibleNotice}
                    </span>
                    {newerPlannerRoom && (
                        <span
                            className={styles.plannerRoomOffer}
                            data-draw-room-planner-room="newer"
                        >
                            Размеры комнаты меняли на шаге расстановки, здесь — прежние стены.{" "}
                            <button type="button" onClick={takeNewerPlannerRoom}>
                                Взять комнату оттуда
                            </button>
                        </span>
                    )}
                    <button
                        type="button"
                        className={styles.keyboardEntryTrigger}
                        onClick={() => openKeyboardEntry()}
                        aria-keyshortcuts="Alt+K"
                        aria-haspopup="dialog"
                    >
                        Координаты <kbd>⌥K</kbd>
                    </button>
                    {!hasBoundary && (tool === "door" || tool === "window") && (
                        <span id="draw-room-openings-hint" className={styles.openingHint}>
                            Инструмент уже выбран. Завершите внешний контур и нажмите на стену.
                        </span>
                    )}
                    <span id="draw-room-keyboard-hint" className={styles.openingHint}>
                        Для точного ввода без мыши нажмите Alt+K или кнопку «Координаты».
                    </span>
                </div>

                <section
                    className={styles.drawingArea}
                    aria-label="Поле чертежа комнаты"
                    data-draw-room-overlay={
                        keyboardEntryOpen
                            ? "keyboard"
                            : selectedOpeningData
                              ? "opening"
                              : selectedWallInspector
                                ? "wall"
                                : roomInspectorOpen || activeToolGroup === "result"
                                  ? "regions"
                                  : "tools"
                    }
                >
                    {/* Rooms and furniture bring their own panels; drawing tools belong to the wall steps. */}
                    {(activeToolGroup === "walls" || activeToolGroup === "openings") && (
                        <aside className={styles.toolRail} aria-label="Инструменты чертежа">
                            {isToolSheetOpen("walls") && (
                                <div id="draw-room-walls-tools" className={styles.toolGroupPanel}>
                                    <button
                                        type="button"
                                        className={styles.toolButton}
                                        data-draw-room-tool="select"
                                        aria-pressed={tool === "select"}
                                        onClick={() => selectTool("select")}
                                    >
                                        <ToolIcon name="select" />
                                        <span className={styles.toolCopy}>
                                            <b>Выбрать</b>
                                            <small>Панорамирование и объект</small>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.toolButton}
                                        data-draw-room-tool="wall"
                                        aria-pressed={tool === "wall"}
                                        onClick={() => selectTool("wall")}
                                    >
                                        <ToolIcon name="wall" />
                                        <span className={styles.toolCopy}>
                                            <b>Стена</b>
                                            <small>
                                                {preview
                                                    ? "Внутренняя стена создаст перегородку"
                                                    : "Стройте внешний контур по сетке"}
                                            </small>
                                        </span>
                                    </button>
                                </div>
                            )}
                            {isToolSheetOpen("openings") && (
                                <div id="draw-room-opening-tools" className={styles.toolGroupPanel}>
                                    <span className={styles.toolGroupCaption}>Двери</span>
                                    {DOOR_CATALOG.map((item) => (
                                        <button
                                            type="button"
                                            key={item.kind}
                                            className={styles.toolButton}
                                            data-draw-room-door-kind={item.kind}
                                            aria-pressed={
                                                tool === "door" && selectedDoorKind === item.kind
                                            }
                                            onClick={() => selectTool("door", item.kind)}
                                        >
                                            <ToolIcon name="door" />
                                            <span className={styles.toolCopy}>
                                                <b>{item.label}</b>
                                                <small>{item.description}</small>
                                            </span>
                                        </button>
                                    ))}
                                    {tool === "door" &&
                                        !isHingedDoor({ doorKind: selectedDoorKind }) && (
                                            <SlidingDoorSettings
                                                mount={slidingMount}
                                                direction={slidingDirection}
                                                double={selectedDoorKind === "sliding-double"}
                                                onChange={(patch) => {
                                                    if (patch.slidingMount)
                                                        setSlidingMount(patch.slidingMount);
                                                    if (patch.slidingDirection)
                                                        setSlidingDirection(patch.slidingDirection);
                                                }}
                                            />
                                        )}
                                    <span className={styles.toolGroupCaption}>Окна</span>
                                    <button
                                        type="button"
                                        className={styles.toolButton}
                                        data-draw-room-tool="window"
                                        aria-pressed={tool === "window"}
                                        onClick={() => selectTool("window")}
                                    >
                                        <ToolIcon name="window" />
                                        <span className={styles.toolCopy}>
                                            <b>Окно</b>
                                            <small>Только во внешней стене</small>
                                        </span>
                                    </button>
                                    <span className={styles.toolGroupCaption}>Отопление</span>
                                    <button
                                        type="button"
                                        className={styles.toolButton}
                                        data-draw-room-tool="radiator"
                                        aria-pressed={tool === "radiator"}
                                        onClick={() => selectTool("radiator")}
                                    >
                                        <ToolIcon name="radiator" />
                                        <span className={styles.toolCopy}>
                                            <b>Радиатор</b>
                                            <small>У внешней стены, можно под окном</small>
                                        </span>
                                    </button>
                                </div>
                            )}
                            <button
                                type="button"
                                className={`${styles.toolButton} ${styles.clearButton}`}
                                onClick={clearScene}
                                title="Очистить контур"
                                aria-label="Очистить контур"
                            >
                                <ToolIcon name="clear" />
                                <span className={styles.toolCopy}>
                                    <b>Очистить</b>
                                    <small>Удалить контур, проёмы и мебель</small>
                                </span>
                            </button>
                        </aside>
                    )}

                    {keyboardEntryOpen && (
                        <aside
                            className={styles.keyboardEntry}
                            role="dialog"
                            aria-modal="false"
                            aria-labelledby="draw-room-keyboard-entry-title"
                            data-draw-room-keyboard-entry="true"
                        >
                            <div className={styles.keyboardEntryHeading}>
                                <div>
                                    <b id="draw-room-keyboard-entry-title">
                                        Добавить по координатам
                                    </b>
                                    <small>Tab — следующее поле · Enter — добавить</small>
                                </div>
                                <button
                                    type="button"
                                    aria-label="Закрыть ввод по координатам"
                                    onClick={() => setKeyboardEntryOpen(false)}
                                >
                                    ×
                                </button>
                            </div>
                            <form onSubmit={submitKeyboardGeometry}>
                                <label className={styles.keyboardEntryControl}>
                                    <span>Объект</span>
                                    <select
                                        value={keyboardTool}
                                        onChange={(event) =>
                                            setKeyboardTool(event.target.value as KeyboardTool)
                                        }
                                    >
                                        <option value="wall">
                                            {preview ? "Стена (внутренняя)" : "Стена (контур)"}
                                        </option>
                                        <option value="door">
                                            Дверь: {getDoorCatalogItem(selectedDoorKind).label}
                                        </option>
                                        <option value="window">Окно</option>
                                    </select>
                                </label>
                                {keyboardTool === "wall" && (
                                    <div className={styles.keyboardEntryGrid}>
                                        <label className={styles.keyboardEntryControl}>
                                            <span>Начало X, мм</span>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                step={sceneSnapMm}
                                                value={keyboardEntry.startX}
                                                onChange={(event) =>
                                                    setKeyboardEntry((current) => ({
                                                        ...current,
                                                        startX: event.target.value,
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label className={styles.keyboardEntryControl}>
                                            <span>Начало Y, мм</span>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                step={sceneSnapMm}
                                                value={keyboardEntry.startY}
                                                onChange={(event) =>
                                                    setKeyboardEntry((current) => ({
                                                        ...current,
                                                        startY: event.target.value,
                                                    }))
                                                }
                                            />
                                        </label>
                                    </div>
                                )}
                                <div className={styles.keyboardEntryGrid}>
                                    <label className={styles.keyboardEntryControl}>
                                        <span>
                                            {keyboardTool === "door" || keyboardTool === "window"
                                                ? "Точка на стене X, мм"
                                                : "Конец X, мм"}
                                        </span>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            step={sceneSnapMm}
                                            value={keyboardEntry.endX}
                                            onChange={(event) =>
                                                setKeyboardEntry((current) => ({
                                                    ...current,
                                                    endX: event.target.value,
                                                }))
                                            }
                                        />
                                    </label>
                                    <label className={styles.keyboardEntryControl}>
                                        <span>
                                            {keyboardTool === "door" || keyboardTool === "window"
                                                ? "Точка на стене Y, мм"
                                                : "Конец Y, мм"}
                                        </span>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            step={sceneSnapMm}
                                            value={keyboardEntry.endY}
                                            onChange={(event) =>
                                                setKeyboardEntry((current) => ({
                                                    ...current,
                                                    endY: event.target.value,
                                                }))
                                            }
                                        />
                                    </label>
                                </div>
                                <p>
                                    {keyboardTool === "door" || keyboardTool === "window"
                                        ? "Точка должна лежать на подходящей стене; привязка и безопасные отступы проверятся автоматически."
                                        : "Сегмент должен быть горизонтальным или вертикальным и не короче 500 мм."}
                                </p>
                                <button type="submit" className={styles.keyboardEntrySubmit}>
                                    Добавить{" "}
                                    {keyboardTool === "wall"
                                        ? "стену"
                                        : keyboardTool === "door"
                                          ? "дверь"
                                          : "окно"}
                                </button>
                            </form>
                        </aside>
                    )}

                    <div className={styles.canvasShell}>
                        <div
                            className={styles.rulerSide}
                            aria-hidden="true"
                            data-draw-room-ruler="side"
                        >
                            {verticalRulerTicks.map((tick) => (
                                <span key={tick}>{formatMeters(tick)}</span>
                            ))}
                        </div>
                        <svg
                            ref={boardRef}
                            className={`${styles.canvas} ${tool === "wall" ? styles.canvasWallMode : ""}`}
                            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                            preserveAspectRatio="xMidYMid meet"
                            role="application"
                            aria-label={`Поле чертежа с сеткой 50 миллиметров, отображение ${gridPresentation.label}`}
                            aria-describedby="draw-room-keyboard-hint"
                            tabIndex={0}
                            data-draw-room-board="true"
                            data-draw-room-dimension-lod={
                                showCommittedDimensions ? "full" : "hidden"
                            }
                            data-grid-snap-mm={sceneSnapMm}
                            data-grid-presentation-level={gridPresentation.level}
                            onPointerMove={handleBoardPointerMove}
                            onPointerLeave={handleBoardPointerLeave}
                            onPointerCancel={handleBoardPointerCancel}
                            onPointerUp={handleBoardPointerUp}
                            onPointerDown={handleBoardPointerDown}
                        >
                            <defs>
                                <pattern
                                    id="minor-grid"
                                    x={constructionGridOrigin}
                                    y={constructionGridOrigin}
                                    width={gridPresentation.minorStepMm}
                                    height={gridPresentation.minorStepMm}
                                    patternUnits="userSpaceOnUse"
                                >
                                    <path
                                        d={`M ${gridPresentation.minorStepMm} 0 L 0 0 0 ${gridPresentation.minorStepMm}`}
                                        className={styles.minorGrid}
                                    />
                                </pattern>
                                <pattern
                                    id="medium-grid"
                                    x={constructionGridOrigin}
                                    y={constructionGridOrigin}
                                    width={gridPresentation.mediumStepMm}
                                    height={gridPresentation.mediumStepMm}
                                    patternUnits="userSpaceOnUse"
                                >
                                    <rect
                                        width={gridPresentation.mediumStepMm}
                                        height={gridPresentation.mediumStepMm}
                                        fill="url(#minor-grid)"
                                    />
                                    <path
                                        d={`M ${gridPresentation.mediumStepMm} 0 L 0 0 0 ${gridPresentation.mediumStepMm}`}
                                        className={styles.mediumGrid}
                                    />
                                </pattern>
                                <pattern
                                    id="major-grid"
                                    x={constructionGridOrigin}
                                    y={constructionGridOrigin}
                                    width={gridPresentation.majorStepMm}
                                    height={gridPresentation.majorStepMm}
                                    patternUnits="userSpaceOnUse"
                                >
                                    <rect
                                        width={gridPresentation.majorStepMm}
                                        height={gridPresentation.majorStepMm}
                                        fill="url(#medium-grid)"
                                    />
                                    <path
                                        d={`M ${gridPresentation.majorStepMm} 0 L 0 0 0 ${gridPresentation.majorStepMm}`}
                                        className={styles.majorGrid}
                                    />
                                </pattern>
                                {/* A diagonal drawn corner-to-corner in a square tile
                                    loses its stroke ends at every tile corner, which
                                    shows up as broken, rounded-off hatches when zoomed
                                    in. Rotating the tile instead lets one straight
                                    line run edge to edge, so the tiles join seamlessly. */}
                                <pattern
                                    id="wall-hatch"
                                    width={hatchPitch}
                                    height={hatchPitch}
                                    patternUnits="userSpaceOnUse"
                                    patternTransform="rotate(45)"
                                >
                                    <rect
                                        width={hatchPitch}
                                        height={hatchPitch}
                                        className={styles.wallHatchBase}
                                    />
                                    <path
                                        d={`M ${hatchPitch / 2} 0 V ${hatchPitch}`}
                                        className={styles.wallHatchLine}
                                    />
                                </pattern>
                                <mask
                                    id="wall-opening-mask"
                                    data-camera-envelope="true"
                                    maskUnits="userSpaceOnUse"
                                    maskContentUnits="userSpaceOnUse"
                                    x={wallOpeningMaskBounds.x}
                                    y={wallOpeningMaskBounds.y}
                                    width={wallOpeningMaskBounds.width}
                                    height={wallOpeningMaskBounds.height}
                                >
                                    <rect
                                        data-camera-envelope="true"
                                        x={wallOpeningMaskBounds.x}
                                        y={wallOpeningMaskBounds.y}
                                        width={wallOpeningMaskBounds.width}
                                        height={wallOpeningMaskBounds.height}
                                        fill="#fff"
                                    />
                                    {preview &&
                                        renderedOpenings.map((opening) => (
                                            <polygon
                                                key={`cut-${opening.kind}-${opening.item.id}`}
                                                points={getOpeningCutPolygon(
                                                    opening.segment,
                                                    opening.origin,
                                                    opening.item.offset,
                                                    opening.item.width,
                                                    renderedWallThickness,
                                                    Boolean(
                                                        "partitionId" in opening.item &&
                                                            opening.item.partitionId,
                                                    ),
                                                )}
                                                fill="#000"
                                            />
                                        ))}
                                    {preview && openingPreview?.valid && (
                                        <polygon
                                            points={getOpeningCutPolygon(
                                                openingPreview.segment,
                                                openingPreview.origin,
                                                openingPreview.offset,
                                                openingPreview.width,
                                                renderedWallThickness,
                                                previews.some((owner) =>
                                                    owner.room.partitions?.some(
                                                        (partition) =>
                                                            partition.id ===
                                                            openingPreview.segment.id,
                                                    ),
                                                ),
                                            )}
                                            fill="#000"
                                        />
                                    )}
                                </mask>
                                {wallCursorCellOrigin && (
                                    <clipPath
                                        id="wall-cursor-cell-clip"
                                        clipPathUnits="userSpaceOnUse"
                                    >
                                        <rect
                                            x={wallCursorCellOrigin.x}
                                            y={wallCursorCellOrigin.y}
                                            width={renderedWallThickness}
                                            height={renderedWallThickness}
                                        />
                                    </clipPath>
                                )}
                            </defs>
                            <rect
                                data-draw-room-grid="true"
                                data-camera-envelope="true"
                                x={viewBox.x}
                                y={viewBox.y}
                                width={viewBox.width}
                                height={viewBox.height}
                                className={styles.boardPaper}
                            />
                            <rect
                                data-camera-envelope="true"
                                x={viewBox.x}
                                y={viewBox.y}
                                width={viewBox.width}
                                height={viewBox.height}
                                fill="url(#major-grid)"
                                data-draw-room-grid-pattern="true"
                            />
                            {preview && (
                                <g className={styles.roomLayer} data-draw-room-preview="true">
                                    {previews.map((owner) => (
                                        <polygon
                                            key={owner.wallIds?.[0]}
                                            points={getPreviewContourPoints(owner)
                                                .map((point) => `${point.x},${point.y}`)
                                                .join(" ")}
                                        />
                                    ))}
                                    {(activeToolGroup === "rooms" ||
                                        (furnitureStep && renderedRoomRegions.length > 1)) && (
                                        <g
                                            pointerEvents="none"
                                            shapeRendering="crispEdges"
                                            data-draw-room-region-fills="true"
                                        >
                                            {renderedRoomRegions.map((region) => {
                                                const selected = furnitureStep
                                                    ? region.signature ===
                                                      furnitureRegion?.signature
                                                    : region.signature === selectedRegionSignature;
                                                // Furnishing greys out the other rooms; the
                                                // rooms step tints all and marks the choice.
                                                if (furnitureStep && selected) return null;
                                                return (
                                                    <g
                                                        key={region.signature}
                                                        fill={furnitureStep ? "#26313a" : "#e97800"}
                                                        fillOpacity={
                                                            furnitureStep
                                                                ? 0.1
                                                                : selected
                                                                  ? 0.16
                                                                  : 0.04
                                                        }
                                                        data-draw-room-region-fill={
                                                            selected ? "selected" : "idle"
                                                        }
                                                    >
                                                        {region.clearRects.map((rect) => (
                                                            <rect
                                                                key={`${rect.left},${rect.top}`}
                                                                x={region.origin.x + rect.left}
                                                                y={region.origin.y + rect.top}
                                                                width={rect.right - rect.left}
                                                                height={rect.bottom - rect.top}
                                                            />
                                                        ))}
                                                    </g>
                                                );
                                            })}
                                        </g>
                                    )}
                                    <g className={styles.wallLayers}>
                                        <path
                                            data-draw-room-wall-strip="true"
                                            data-draw-room-wall-union="true"
                                            className={styles.wallStrip}
                                            d={closedWallMaterialPath}
                                            fillRule="evenodd"
                                            mask="url(#wall-opening-mask)"
                                        />
                                        {boundarySegments.map((segment) => (
                                            <g
                                                key={segment.id}
                                                data-draw-room-wall-segment={segment.id}
                                                data-draw-room-wall-orientation={
                                                    segment.orientation
                                                }
                                                aria-hidden="true"
                                            />
                                        ))}
                                        {closedRoomBranchSegments.map((segment, index) => (
                                            <g
                                                key={`branch-${segment.id}-${index}`}
                                                data-draw-room-wall-segment={segment.id}
                                                data-draw-room-wall-branch="true"
                                                data-draw-room-wall-orientation={
                                                    segment.start.y === segment.end.y
                                                        ? "horizontal"
                                                        : "vertical"
                                                }
                                                data-draw-room-wall-start-x={segment.start.x}
                                                data-draw-room-wall-start-y={segment.start.y}
                                                data-draw-room-wall-end-x={segment.end.x}
                                                data-draw-room-wall-end-y={segment.end.y}
                                                aria-hidden="true"
                                            />
                                        ))}
                                    </g>
                                </g>
                            )}
                            {previews.map((owner) =>
                                (owner.room.radiators ?? []).map((radiator) => {
                                    const body = getRadiatorBody(radiator, owner.room);
                                    const service = getRadiatorServiceObstacle(
                                        radiator,
                                        owner.room,
                                    );
                                    const at = (rect: typeof body) => ({
                                        x: rect.x + owner.origin.x,
                                        y: rect.y + owner.origin.y,
                                        width: rect.width,
                                        height: rect.depth,
                                    });
                                    const selected = radiator.id === selectedRadiatorId;
                                    const ribs = Math.max(
                                        2,
                                        Math.round(Math.max(body.width, body.depth) / 120),
                                    );
                                    const alongX = body.width >= body.depth;
                                    return (
                                        <g
                                            key={radiator.id}
                                            className={styles.radiator}
                                            data-draw-room-radiator={radiator.id}
                                            data-selected={selected}
                                            style={{
                                                pointerEvents:
                                                    tool === "select" && !furnitureStep
                                                        ? "auto"
                                                        : "none",
                                            }}
                                            onPointerDown={(event) => {
                                                if (tool !== "select" || event.button !== 0) return;
                                                event.stopPropagation();
                                                setSelectedOpening(null);
                                                setSelectedContourWallEdge(null);
                                                setSelectedSegmentWallId(null);
                                                setSelectedRadiatorId(radiator.id);
                                            }}
                                        >
                                            <rect
                                                className={styles.radiatorClearance}
                                                {...at(service)}
                                            />
                                            <rect className={styles.radiatorBody} {...at(body)} />
                                            {Array.from({ length: ribs - 1 }, (_, index) => {
                                                const rect = at(body);
                                                const t = (index + 1) / ribs;
                                                return alongX ? (
                                                    <line
                                                        key={index}
                                                        x1={rect.x + rect.width * t}
                                                        x2={rect.x + rect.width * t}
                                                        y1={rect.y}
                                                        y2={rect.y + rect.height}
                                                    />
                                                ) : (
                                                    <line
                                                        key={index}
                                                        x1={rect.x}
                                                        x2={rect.x + rect.width}
                                                        y1={rect.y + rect.height * t}
                                                        y2={rect.y + rect.height * t}
                                                    />
                                                );
                                            })}
                                        </g>
                                    );
                                }),
                            )}
                            {/* Furniture stands over the room fill and walls, under the dimensions. */}
                            <g data-draw-furniture-host="true" />
                            {tool === "select" && (preview || scene.segments.length > 0) && (
                                <g
                                    className={styles.contourWallEditor}
                                    data-draw-room-wall-editor="true"
                                    aria-label="Перемещение стен"
                                >
                                    {preview?.contour.map((start, edgeIndex) => {
                                        const end =
                                            preview.contour[
                                                (edgeIndex + 1) % preview.contour.length
                                            ];
                                        const selected = selectedContourWallEdge === edgeIndex;
                                        const active =
                                            activeContourWallGrab?.edgeIndex === edgeIndex;
                                        return (
                                            <g
                                                key={`edit-wall-${edgeIndex}`}
                                                data-draw-room-wall-edit-edge={edgeIndex}
                                                data-draw-room-wall-edit-active={
                                                    active ? "true" : undefined
                                                }
                                                data-draw-room-wall-edit-selected={
                                                    selected ? "true" : undefined
                                                }
                                            >
                                                {selected && (
                                                    <>
                                                        <line
                                                            className={
                                                                styles.contourWallSelectedStrip
                                                            }
                                                            x1={start.x}
                                                            y1={start.y}
                                                            x2={end.x}
                                                            y2={end.y}
                                                            strokeWidth={renderedWallThickness}
                                                            mask="url(#wall-opening-mask)"
                                                            aria-hidden="true"
                                                        />
                                                        <line
                                                            className={
                                                                styles.contourWallSelectedAxis
                                                            }
                                                            x1={start.x}
                                                            y1={start.y}
                                                            x2={end.x}
                                                            y2={end.y}
                                                            aria-hidden="true"
                                                        />
                                                    </>
                                                )}
                                                <line
                                                    className={styles.contourWallSelectHitArea}
                                                    data-draw-room-wall-select-hit={edgeIndex}
                                                    x1={start.x}
                                                    y1={start.y}
                                                    x2={end.x}
                                                    y2={end.y}
                                                    onPointerDown={(event) =>
                                                        selectContourWall(event, edgeIndex)
                                                    }
                                                />
                                            </g>
                                        );
                                    })}
                                    {(preview ? closedRoomBranchSegments : scene.segments).map(
                                        (segment) => {
                                            const selected =
                                                selectedSegmentWall?.segmentIds.includes(
                                                    segment.id,
                                                ) ?? false;
                                            return (
                                                <g
                                                    key={`edit-segment-${segment.id}`}
                                                    data-draw-room-wall-edit-segment={segment.id}
                                                    data-draw-room-wall-edit-selected={
                                                        selected ? "true" : undefined
                                                    }
                                                >
                                                    {selected && (
                                                        <>
                                                            <line
                                                                className={
                                                                    styles.contourWallSelectedStrip
                                                                }
                                                                x1={segment.start.x}
                                                                y1={segment.start.y}
                                                                x2={segment.end.x}
                                                                y2={segment.end.y}
                                                                strokeWidth={renderedWallThickness}
                                                                mask={
                                                                    preview
                                                                        ? "url(#wall-opening-mask)"
                                                                        : undefined
                                                                }
                                                                aria-hidden="true"
                                                            />
                                                            <line
                                                                className={
                                                                    styles.contourWallSelectedAxis
                                                                }
                                                                x1={segment.start.x}
                                                                y1={segment.start.y}
                                                                x2={segment.end.x}
                                                                y2={segment.end.y}
                                                                aria-hidden="true"
                                                            />
                                                        </>
                                                    )}
                                                    <line
                                                        className={styles.contourWallSelectHitArea}
                                                        data-draw-room-wall-select-segment={
                                                            segment.id
                                                        }
                                                        x1={segment.start.x}
                                                        y1={segment.start.y}
                                                        x2={segment.end.x}
                                                        y2={segment.end.y}
                                                        onPointerDown={(event) =>
                                                            selectSegmentWall(event, segment.id)
                                                        }
                                                    />
                                                </g>
                                            );
                                        },
                                    )}
                                </g>
                            )}

                            {!preview && openWallComponents.length > 0 && (
                                <g className={styles.wallLayers} data-draw-room-open-contour="true">
                                    {openWallComponents.map((component) => (
                                        <g
                                            key={component.id}
                                            data-draw-room-open-component="true"
                                            data-draw-room-open-component-id={component.id}
                                        >
                                            <path
                                                className={styles.wallStrip}
                                                data-draw-room-wall-strip="true"
                                                data-draw-room-wall-open-union="true"
                                                d={component.path}
                                                fillRule="evenodd"
                                            />
                                            {component.segments.map((segment) => (
                                                <g
                                                    key={segment.id}
                                                    data-draw-room-wall-segment={segment.id}
                                                    data-draw-room-wall-orientation={
                                                        segment.start.y === segment.end.y
                                                            ? "horizontal"
                                                            : "vertical"
                                                    }
                                                    data-draw-room-wall-start-x={segment.start.x}
                                                    data-draw-room-wall-start-y={segment.start.y}
                                                    aria-hidden="true"
                                                />
                                            ))}
                                        </g>
                                    ))}
                                </g>
                            )}
                            {showCommittedDimensions &&
                                visiblePersistentWallDimensions.length > 0 && (
                                    <g
                                        className={styles.persistentWallDimensions}
                                        data-draw-room-persistent-dimensions="true"
                                        data-draw-room-detached-persistent-dimensions={
                                            preview ? "true" : undefined
                                        }
                                        aria-hidden="true"
                                    >
                                        {visiblePersistentWallDimensions
                                            .map(inView)
                                            .map((dimension) => (
                                                <g
                                                    key={`dimension-${dimension.segmentId}-${dimension.id}`}
                                                    data-draw-room-persistent-wall={
                                                        dimension.segmentId
                                                    }
                                                    data-draw-room-persistent-dimension={
                                                        dimension.id
                                                    }
                                                    data-draw-room-dimension-chain="persistent"
                                                    data-draw-room-persistent-dimension-kind={
                                                        dimension.dimensionKind
                                                    }
                                                >
                                                    <line
                                                        className={
                                                            styles.persistentDimensionExtension
                                                        }
                                                        data-draw-room-persistent-dimension-extension="start"
                                                        x1={dimension.extensionStart.x}
                                                        y1={dimension.extensionStart.y}
                                                        x2={dimension.dimensionStart.x}
                                                        y2={dimension.dimensionStart.y}
                                                    />
                                                    <line
                                                        className={
                                                            styles.persistentDimensionExtension
                                                        }
                                                        data-draw-room-persistent-dimension-extension="end"
                                                        x1={dimension.extensionEnd.x}
                                                        y1={dimension.extensionEnd.y}
                                                        x2={dimension.dimensionEnd.x}
                                                        y2={dimension.dimensionEnd.y}
                                                    />
                                                    <line
                                                        className={styles.persistentDimensionLine}
                                                        data-draw-room-persistent-dimension-line="true"
                                                        x1={dimension.dimensionStart.x}
                                                        y1={dimension.dimensionStart.y}
                                                        x2={dimension.dimensionEnd.x}
                                                        y2={dimension.dimensionEnd.y}
                                                    />
                                                    <line
                                                        className={styles.persistentDimensionTick}
                                                        data-draw-room-persistent-dimension-tick="start"
                                                        x1={dimension.tickStart.x}
                                                        y1={dimension.tickStart.y}
                                                        x2={
                                                            dimension.tickStart.x +
                                                            (dimension.vertical
                                                                ? dimension.labelHeight * 0.3
                                                                : 0)
                                                        }
                                                        y2={
                                                            dimension.tickStart.y +
                                                            (dimension.vertical
                                                                ? 0
                                                                : dimension.labelHeight * 0.3)
                                                        }
                                                    />
                                                    <line
                                                        className={styles.persistentDimensionTick}
                                                        data-draw-room-persistent-dimension-tick="end"
                                                        x1={dimension.tickEnd.x}
                                                        y1={dimension.tickEnd.y}
                                                        x2={
                                                            dimension.tickEnd.x -
                                                            (dimension.vertical
                                                                ? dimension.labelHeight * 0.3
                                                                : 0)
                                                        }
                                                        y2={
                                                            dimension.tickEnd.y -
                                                            (dimension.vertical
                                                                ? 0
                                                                : dimension.labelHeight * 0.3)
                                                        }
                                                    />
                                                    <g
                                                        transform={
                                                            dimension.vertical
                                                                ? `rotate(-90 ${dimension.label.x} ${dimension.label.y})`
                                                                : undefined
                                                        }
                                                    >
                                                        <rect
                                                            className={
                                                                styles.persistentDimensionKnockout
                                                            }
                                                            x={
                                                                dimension.label.x -
                                                                dimension.labelWidth / 2
                                                            }
                                                            y={
                                                                dimension.label.y -
                                                                dimension.labelHeight / 2
                                                            }
                                                            width={dimension.labelWidth}
                                                            height={dimension.labelHeight}
                                                            rx={dimension.labelHeight * 0.18}
                                                        />
                                                        <text
                                                            className={
                                                                styles.persistentWallDimensionLabel
                                                            }
                                                            data-draw-room-wall-dimension="persistent"
                                                            data-draw-room-persistent-dimension-label={
                                                                dimension.id
                                                            }
                                                            x={dimension.label.x}
                                                            y={dimension.label.y}
                                                            style={{
                                                                fontSize: dimensionFontSize * 1.08,
                                                            }}
                                                            textAnchor="middle"
                                                            dominantBaseline="middle"
                                                        >
                                                            {dimension.labelValue}
                                                        </text>
                                                    </g>
                                                </g>
                                            ))}
                                    </g>
                                )}
                            {preview &&
                                showCommittedDimensions &&
                                displayedClosedRoomDimensions.length > 0 &&
                                !ghost && (
                                    <g
                                        className={styles.architecturalDimensions}
                                        data-draw-room-architectural-dimensions="true"
                                        aria-hidden="true"
                                    >
                                        {openingChainDimensions.map(inView).map((dimension) => (
                                            <g
                                                key={dimension.id}
                                                data-draw-room-dimension-chain={dimension.kind}
                                                data-draw-room-dimension-id={dimension.id}
                                            >
                                                <line
                                                    className={styles.architecturalExtension}
                                                    x1={dimension.extensionStart.x}
                                                    y1={dimension.extensionStart.y}
                                                    x2={dimension.dimensionStart.x}
                                                    y2={dimension.dimensionStart.y}
                                                />
                                                <line
                                                    className={styles.architecturalExtension}
                                                    x1={dimension.extensionEnd.x}
                                                    y1={dimension.extensionEnd.y}
                                                    x2={dimension.dimensionEnd.x}
                                                    y2={dimension.dimensionEnd.y}
                                                />
                                                <line
                                                    className={styles.architecturalLine}
                                                    data-draw-room-dimension-line="architectural"
                                                    x1={dimension.dimensionStart.x}
                                                    y1={dimension.dimensionStart.y}
                                                    x2={dimension.dimensionEnd.x}
                                                    y2={dimension.dimensionEnd.y}
                                                />
                                                <line
                                                    className={styles.architecturalTick}
                                                    x1={dimension.tickStart.x}
                                                    y1={dimension.tickStart.y}
                                                    x2={
                                                        dimension.tickStart.x +
                                                        (dimension.vertical
                                                            ? dimension.labelHeight * 0.32
                                                            : 0)
                                                    }
                                                    y2={
                                                        dimension.tickStart.y +
                                                        (dimension.vertical
                                                            ? 0
                                                            : dimension.labelHeight * 0.32)
                                                    }
                                                />
                                                <line
                                                    className={styles.architecturalTick}
                                                    x1={dimension.tickEnd.x}
                                                    y1={dimension.tickEnd.y}
                                                    x2={
                                                        dimension.tickEnd.x -
                                                        (dimension.vertical
                                                            ? dimension.labelHeight * 0.32
                                                            : 0)
                                                    }
                                                    y2={
                                                        dimension.tickEnd.y -
                                                        (dimension.vertical
                                                            ? 0
                                                            : dimension.labelHeight * 0.32)
                                                    }
                                                />
                                                {dimension.labelValue && (
                                                    <g
                                                        transform={
                                                            dimension.vertical
                                                                ? `rotate(-90 ${dimension.label.x} ${dimension.label.y})`
                                                                : undefined
                                                        }
                                                    >
                                                        <rect
                                                            className={styles.dimensionKnockout}
                                                            x={
                                                                dimension.label.x -
                                                                dimension.labelWidth / 2
                                                            }
                                                            y={
                                                                dimension.label.y -
                                                                dimension.labelHeight / 2
                                                            }
                                                            width={dimension.labelWidth}
                                                            height={dimension.labelHeight}
                                                        />
                                                        <text
                                                            className={
                                                                styles.architecturalDimensionLabel
                                                            }
                                                            data-draw-room-wall-dimension={
                                                                dimension.kind
                                                            }
                                                            x={dimension.label.x}
                                                            y={dimension.label.y}
                                                            style={{ fontSize: dimensionFontSize }}
                                                            textAnchor="middle"
                                                            dominantBaseline="middle"
                                                        >
                                                            {dimension.labelValue}
                                                        </text>
                                                    </g>
                                                )}
                                            </g>
                                        ))}
                                    </g>
                                )}
                            {preview &&
                                showCommittedDimensions &&
                                closedBranchDimensions.length > 0 &&
                                !ghost && (
                                    <g
                                        className={styles.closedBranchDimensions}
                                        data-draw-room-branch-dimensions="true"
                                        aria-hidden="true"
                                    >
                                        {closedBranchDimensions.map(inView).map((dimension) => (
                                            <g
                                                key={`branch-dimension-${dimension.segmentId}-${dimension.dimensionId}`}
                                                data-draw-room-branch-dimension={
                                                    dimension.segmentId
                                                }
                                                data-draw-room-branch-dimension-role={
                                                    dimension.dimensionId
                                                }
                                            >
                                                <line
                                                    className={styles.architecturalExtension}
                                                    x1={dimension.extensionStart.x}
                                                    y1={dimension.extensionStart.y}
                                                    x2={dimension.dimensionStart.x}
                                                    y2={dimension.dimensionStart.y}
                                                />
                                                <line
                                                    className={styles.architecturalExtension}
                                                    x1={dimension.extensionEnd.x}
                                                    y1={dimension.extensionEnd.y}
                                                    x2={dimension.dimensionEnd.x}
                                                    y2={dimension.dimensionEnd.y}
                                                />
                                                <line
                                                    className={styles.architecturalLine}
                                                    data-draw-room-branch-dimension-line="true"
                                                    x1={dimension.dimensionStart.x}
                                                    y1={dimension.dimensionStart.y}
                                                    x2={dimension.dimensionEnd.x}
                                                    y2={dimension.dimensionEnd.y}
                                                />
                                                <line
                                                    className={styles.architecturalTick}
                                                    x1={dimension.tickStart.x}
                                                    y1={dimension.tickStart.y}
                                                    x2={
                                                        dimension.tickStart.x +
                                                        (dimension.vertical
                                                            ? dimension.labelHeight * 0.32
                                                            : 0)
                                                    }
                                                    y2={
                                                        dimension.tickStart.y +
                                                        (dimension.vertical
                                                            ? 0
                                                            : dimension.labelHeight * 0.32)
                                                    }
                                                />
                                                <line
                                                    className={styles.architecturalTick}
                                                    x1={dimension.tickEnd.x}
                                                    y1={dimension.tickEnd.y}
                                                    x2={
                                                        dimension.tickEnd.x -
                                                        (dimension.vertical
                                                            ? dimension.labelHeight * 0.32
                                                            : 0)
                                                    }
                                                    y2={
                                                        dimension.tickEnd.y -
                                                        (dimension.vertical
                                                            ? 0
                                                            : dimension.labelHeight * 0.32)
                                                    }
                                                />
                                                <g
                                                    transform={
                                                        dimension.vertical
                                                            ? `rotate(-90 ${dimension.label.x} ${dimension.label.y})`
                                                            : undefined
                                                    }
                                                >
                                                    <rect
                                                        className={styles.dimensionKnockout}
                                                        x={
                                                            dimension.label.x -
                                                            dimension.labelWidth / 2
                                                        }
                                                        y={
                                                            dimension.label.y -
                                                            dimension.labelHeight / 2
                                                        }
                                                        width={dimension.labelWidth}
                                                        height={dimension.labelHeight}
                                                    />
                                                    <text
                                                        className={
                                                            styles.architecturalDimensionLabel
                                                        }
                                                        data-draw-room-branch-dimension-label="true"
                                                        x={dimension.label.x}
                                                        y={dimension.label.y}
                                                        style={{ fontSize: dimensionFontSize }}
                                                        textAnchor="middle"
                                                        dominantBaseline="middle"
                                                    >
                                                        {dimension.labelValue}
                                                    </text>
                                                </g>
                                            </g>
                                        ))}
                                    </g>
                                )}
                            {roomSummary && !ghost && showCommittedDimensions && !furnitureStep && (
                                <g
                                    className={styles.roomSummary}
                                    data-draw-room-summary="true"
                                    aria-hidden="true"
                                >
                                    <rect
                                        x={roomSummary.x - roomSummary.width / 2}
                                        y={roomSummary.y - roomSummary.height / 2}
                                        width={roomSummary.width}
                                        height={roomSummary.height}
                                        rx={millimetersPerPixel * 5}
                                    />
                                    <text
                                        className={styles.roomSummaryHeight}
                                        data-draw-room-summary-height="true"
                                        x={roomSummary.x}
                                        y={roomSummary.y - roomSummary.heightOffset}
                                        style={{ fontSize: roomSummary.heightFontSize }}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                    >
                                        {roomSummary.heightValue}
                                    </text>
                                    <text
                                        className={styles.roomSummaryArea}
                                        data-draw-room-summary-area="true"
                                        x={roomSummary.x}
                                        y={roomSummary.y + roomSummary.areaOffset}
                                        style={{ fontSize: roomSummary.areaFontSize }}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                    >
                                        {roomSummary.areaValue}
                                    </text>
                                </g>
                            )}
                            {constructionGuidePoint && (
                                <g
                                    className={styles.constructionGuides}
                                    data-draw-room-construction-guides="true"
                                    data-draw-room-anchor-kind={
                                        constructionGuideAttachment ?? "free"
                                    }
                                    aria-hidden="true"
                                >
                                    <line
                                        className={styles.constructionGuideAxis}
                                        x1={viewBox.x}
                                        y1={constructionGuidePoint.y}
                                        x2={viewBox.x + viewBox.width}
                                        y2={constructionGuidePoint.y}
                                    />
                                    <line
                                        className={styles.constructionGuideAxis}
                                        x1={constructionGuidePoint.x}
                                        y1={viewBox.y}
                                        x2={constructionGuidePoint.x}
                                        y2={viewBox.y + viewBox.height}
                                    />
                                    <circle
                                        className={styles.constructionMagnet}
                                        cx={constructionGuidePoint.x}
                                        cy={constructionGuidePoint.y}
                                        r={guideMagnetRadius}
                                    />
                                    <circle
                                        className={styles.constructionAnchor}
                                        cx={constructionGuidePoint.x}
                                        cy={constructionGuidePoint.y}
                                        r={guideMarkerRadius}
                                    />
                                    <path
                                        className={styles.constructionCross}
                                        d={`M ${constructionGuidePoint.x - guideMarkerRadius * 1.7} ${constructionGuidePoint.y} H ${constructionGuidePoint.x + guideMarkerRadius * 1.7} M ${constructionGuidePoint.x} ${constructionGuidePoint.y - guideMarkerRadius * 1.7} V ${constructionGuidePoint.y + guideMarkerRadius * 1.7}`}
                                    />
                                </g>
                            )}
                            {ghost && (
                                <>
                                    <polygon
                                        className={`${styles.wallStrip} ${styles.wallLive}`}
                                        data-draw-room-wall-live-preview="true"
                                        points={getWallStripPolygonFromPoints(
                                            ghost.start,
                                            ghost.end,
                                            renderedWallThickness,
                                        )}
                                    />
                                    {(() => {
                                        const horizontal = ghost.start.y === ghost.end.y;
                                        const direction = horizontal
                                            ? { x: ghost.end.x >= ghost.start.x ? 1 : -1, y: 0 }
                                            : { x: 0, y: ghost.end.y >= ghost.start.y ? 1 : -1 };
                                        const perpendicular = { x: -direction.y, y: direction.x };
                                        const size = Math.max(95, millimetersPerPixel * 17);
                                        const label = {
                                            x:
                                                ghost.start.x +
                                                direction.x * size * 1.6 +
                                                perpendicular.x * size * 1.25,
                                            y:
                                                ghost.start.y +
                                                direction.y * size * 1.6 +
                                                perpendicular.y * size * 1.25,
                                        };
                                        return (
                                            <g
                                                className={styles.rightAngleFeedback}
                                                data-draw-room-right-angle="true"
                                                aria-hidden="true"
                                            >
                                                <path
                                                    d={`M ${ghost.start.x + direction.x * size} ${ghost.start.y + direction.y * size} L ${ghost.start.x + direction.x * size + perpendicular.x * size} ${ghost.start.y + direction.y * size + perpendicular.y * size} L ${ghost.start.x + perpendicular.x * size} ${ghost.start.y + perpendicular.y * size}`}
                                                />
                                                <text
                                                    x={label.x}
                                                    y={label.y}
                                                    style={{
                                                        fontSize: Math.max(100, dimensionFontSize),
                                                    }}
                                                    textAnchor="middle"
                                                    dominantBaseline="middle"
                                                >
                                                    90°
                                                </text>
                                            </g>
                                        );
                                    })()}
                                    {liveWallDimensions.length > 0 && liveWallLength > 0 && (
                                        <g
                                            className={styles.liveWallDimensions}
                                            data-draw-room-live-dimensions="true"
                                            data-draw-room-live-layout={liveDimensionLayout}
                                            aria-hidden="true"
                                        >
                                            {liveWallDimensions.map(inView).map((dimension) => (
                                                <g
                                                    key={dimension.id}
                                                    data-draw-room-live-dimension={dimension.id}
                                                >
                                                    <line
                                                        className={styles.liveDimensionExtension}
                                                        data-draw-room-live-dimension-extension="start"
                                                        x1={dimension.extensionStart.x}
                                                        y1={dimension.extensionStart.y}
                                                        x2={dimension.dimensionStart.x}
                                                        y2={dimension.dimensionStart.y}
                                                    />
                                                    <line
                                                        className={styles.liveDimensionExtension}
                                                        data-draw-room-live-dimension-extension="end"
                                                        x1={dimension.extensionEnd.x}
                                                        y1={dimension.extensionEnd.y}
                                                        x2={dimension.dimensionEnd.x}
                                                        y2={dimension.dimensionEnd.y}
                                                    />
                                                    <line
                                                        className={styles.liveDimensionLine}
                                                        data-draw-room-live-dimension-line="true"
                                                        x1={dimension.dimensionStart.x}
                                                        y1={dimension.dimensionStart.y}
                                                        x2={dimension.dimensionEnd.x}
                                                        y2={dimension.dimensionEnd.y}
                                                    />
                                                    <line
                                                        className={styles.liveDimensionTick}
                                                        x1={dimension.tickStart.x}
                                                        y1={dimension.tickStart.y}
                                                        x2={
                                                            dimension.tickStart.x +
                                                            (dimension.vertical
                                                                ? dimension.labelHeight * 0.3
                                                                : 0)
                                                        }
                                                        y2={
                                                            dimension.tickStart.y +
                                                            (dimension.vertical
                                                                ? 0
                                                                : dimension.labelHeight * 0.3)
                                                        }
                                                    />
                                                    <line
                                                        className={styles.liveDimensionTick}
                                                        x1={dimension.tickEnd.x}
                                                        y1={dimension.tickEnd.y}
                                                        x2={
                                                            dimension.tickEnd.x -
                                                            (dimension.vertical
                                                                ? dimension.labelHeight * 0.3
                                                                : 0)
                                                        }
                                                        y2={
                                                            dimension.tickEnd.y -
                                                            (dimension.vertical
                                                                ? 0
                                                                : dimension.labelHeight * 0.3)
                                                        }
                                                    />
                                                    <g
                                                        transform={
                                                            dimension.vertical
                                                                ? `rotate(-90 ${dimension.label.x} ${dimension.label.y})`
                                                                : undefined
                                                        }
                                                    >
                                                        <rect
                                                            className={styles.liveDimensionKnockout}
                                                            x={
                                                                dimension.label.x -
                                                                dimension.labelWidth / 2
                                                            }
                                                            y={
                                                                dimension.label.y -
                                                                dimension.labelHeight / 2
                                                            }
                                                            width={dimension.labelWidth}
                                                            height={dimension.labelHeight}
                                                            rx={dimension.labelHeight * 0.18}
                                                        />
                                                        <text
                                                            className={styles.liveDimensionLabel}
                                                            data-draw-room-live-length={
                                                                dimension.id.startsWith("length")
                                                                    ? "true"
                                                                    : undefined
                                                            }
                                                            data-draw-room-live-thickness={
                                                                dimension.id.startsWith("thickness")
                                                                    ? "true"
                                                                    : undefined
                                                            }
                                                            x={dimension.label.x}
                                                            y={dimension.label.y}
                                                            style={{
                                                                fontSize: dimensionFontSize * 1.08,
                                                            }}
                                                            textAnchor="middle"
                                                            dominantBaseline="middle"
                                                        >
                                                            {dimension.labelValue}
                                                        </text>
                                                    </g>
                                                </g>
                                            ))}
                                        </g>
                                    )}
                                </>
                            )}
                            {hasMagneticDrawingAnchor && ghost && constructionGuidePoint && (
                                <g
                                    className={styles.constructionAnchorLayer}
                                    data-draw-room-active-anchor="true"
                                    data-draw-room-anchor-kind={
                                        constructionGuideAttachment ?? "free"
                                    }
                                    aria-hidden="true"
                                >
                                    <circle
                                        className={styles.constructionAnchor}
                                        cx={constructionGuidePoint.x}
                                        cy={constructionGuidePoint.y}
                                        r={guideMarkerRadius}
                                    />
                                    <path
                                        className={styles.constructionCross}
                                        d={`M ${constructionGuidePoint.x - guideMarkerRadius * 1.7} ${constructionGuidePoint.y} H ${constructionGuidePoint.x + guideMarkerRadius * 1.7} M ${constructionGuidePoint.x} ${constructionGuidePoint.y - guideMarkerRadius * 1.7} V ${constructionGuidePoint.y + guideMarkerRadius * 1.7}`}
                                    />
                                </g>
                            )}
                            {wallCursorCellOrigin && (
                                <g
                                    className={styles.wallCursor}
                                    data-draw-room-wall-cursor="true"
                                    data-grid-cell-mm={renderedWallThickness}
                                    data-wall-thickness-mm={renderedWallThickness}
                                    aria-hidden="true"
                                >
                                    <g
                                        clipPath="url(#wall-cursor-cell-clip)"
                                        data-draw-room-wall-cursor-paint="true"
                                    >
                                        <rect
                                            className={styles.wallCursorSquare}
                                            x={wallCursorCellOrigin.x}
                                            y={wallCursorCellOrigin.y}
                                            width={renderedWallThickness}
                                            height={renderedWallThickness}
                                        />
                                        <path
                                            className={styles.wallCursorHatch}
                                            d={`M ${wallCursorCellOrigin.x} ${wallCursorCellOrigin.y + renderedWallThickness} L ${wallCursorCellOrigin.x + renderedWallThickness} ${wallCursorCellOrigin.y} M ${wallCursorCellOrigin.x} ${wallCursorCellOrigin.y + renderedWallThickness / 2} L ${wallCursorCellOrigin.x + renderedWallThickness / 2} ${wallCursorCellOrigin.y} M ${wallCursorCellOrigin.x + renderedWallThickness / 2} ${wallCursorCellOrigin.y + renderedWallThickness} L ${wallCursorCellOrigin.x + renderedWallThickness} ${wallCursorCellOrigin.y + renderedWallThickness / 2}`}
                                        />
                                    </g>
                                </g>
                            )}
                            {preview &&
                                renderedOpenings.map((opening) => {
                                    const line = openingLine(
                                        opening.segment,
                                        opening.origin,
                                        opening.item.offset,
                                        opening.item.width,
                                    );
                                    const selected =
                                        selectedOpening?.kind === opening.kind &&
                                        selectedOpening.id === opening.item.id;
                                    if (opening.kind === "window") {
                                        return (
                                            <g
                                                key={opening.item.id}
                                                data-draw-room-opening="window"
                                                data-draw-room-opening-id={opening.item.id}
                                                data-draw-room-opening-kind="window"
                                                data-window-kind={
                                                    opening.item.windowKind ?? "standard"
                                                }
                                                className={`${styles.windowOpening} ${selected ? styles.openingSelected : ""} ${opening.preview ? styles.openingPreview : ""} ${opening.preview && opening.previewValid === false ? styles.openingInvalid : ""}`}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`${opening.item.windowKind === "floor-to-ceiling" ? "Панорамное окно" : "Окно"}, ширина ${opening.item.width} мм`}
                                                onKeyDown={(event) => {
                                                    if (
                                                        event.key === "Enter" ||
                                                        event.key === " "
                                                    ) {
                                                        event.preventDefault();
                                                        setSelectedOpening({
                                                            kind: "window",
                                                            id: opening.item.id,
                                                        });
                                                    }
                                                }}
                                            >
                                                <polygon
                                                    className={styles.openingHitArea}
                                                    points={getOpeningCutPolygon(
                                                        opening.segment,
                                                        opening.origin,
                                                        opening.item.offset,
                                                        opening.item.width,
                                                        Math.max(
                                                            renderedWallThickness * 4,
                                                            annotationMillimetersPerPixel * 20,
                                                        ),
                                                    )}
                                                />
                                                <line
                                                    x1={line.start.x}
                                                    y1={line.start.y}
                                                    x2={line.end.x}
                                                    y2={line.end.y}
                                                />
                                            </g>
                                        );
                                    }
                                    const door = opening.item;
                                    const doorKind = door.doorKind ?? "room";
                                    const hinged = isHingedDoor(door);
                                    // Old drafts can retain a separately saved clearance depth.
                                    // Rendering the larger of the two keeps their visible sweep
                                    // conservative; edited DrawRoom doors keep both values equal.
                                    const doorSweepDepth = Math.max(
                                        door.width,
                                        door.clearanceDepth,
                                    );
                                    const hitDepth = hinged
                                        ? doorSweepDepth
                                        : Math.max(renderedWallThickness, millimetersPerPixel * 14);
                                    const leafDepth =
                                        doorKind === "swing-double"
                                            ? doorSweepDepth / 2
                                            : doorSweepDepth;
                                    const swingNormal =
                                        door.swingDirection === "outward"
                                            ? {
                                                  x: -opening.segment.inwardNormal.x,
                                                  y: -opening.segment.inwardNormal.y,
                                              }
                                            : opening.segment.inwardNormal;
                                    const hingePoint = door.hinge === "end" ? line.end : line.start;
                                    const leafEnd =
                                        door.hinge === "end"
                                            ? {
                                                  x: line.end.x + swingNormal.x * leafDepth,
                                                  y: line.end.y + swingNormal.y * leafDepth,
                                              }
                                            : {
                                                  x: line.start.x + swingNormal.x * leafDepth,
                                                  y: line.start.y + swingNormal.y * leafDepth,
                                              };
                                    const freePoint = door.hinge === "end" ? line.start : line.end;
                                    const centrePoint = {
                                        x: (line.start.x + line.end.x) / 2,
                                        y: (line.start.y + line.end.y) / 2,
                                    };
                                    const secondLeafEnd = {
                                        x: freePoint.x + swingNormal.x * leafDepth,
                                        y: freePoint.y + swingNormal.y * leafDepth,
                                    };
                                    return (
                                        <g
                                            key={door.id}
                                            data-draw-room-opening="door"
                                            data-draw-room-opening-id={door.id}
                                            data-draw-room-opening-kind="door"
                                            data-door-kind={doorKind}
                                            data-door-width-mm={door.width}
                                            data-door-sweep-mm={doorSweepDepth}
                                            className={`${styles.doorOpening} ${selected ? styles.openingSelected : ""} ${opening.preview ? styles.openingPreview : ""} ${opening.preview && opening.previewValid === false ? styles.openingInvalid : ""}`}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`${getDoorKindLabel(doorKind)} дверь, ширина ${door.width} мм`}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    setSelectedOpening({
                                                        kind: "door",
                                                        id: door.id,
                                                    });
                                                }
                                            }}
                                        >
                                            <polygon
                                                className={styles.openingHitArea}
                                                points={[
                                                    line.start,
                                                    line.end,
                                                    {
                                                        x: line.end.x + swingNormal.x * hitDepth,
                                                        y: line.end.y + swingNormal.y * hitDepth,
                                                    },
                                                    {
                                                        x: line.start.x + swingNormal.x * hitDepth,
                                                        y: line.start.y + swingNormal.y * hitDepth,
                                                    },
                                                ]
                                                    .map((point) => `${point.x},${point.y}`)
                                                    .join(" ")}
                                            />
                                            <line
                                                x1={line.start.x}
                                                y1={line.start.y}
                                                x2={line.end.x}
                                                y2={line.end.y}
                                            />
                                            {hinged ? (
                                                doorKind === "swing-double" ? (
                                                    <>
                                                        <line
                                                            className={styles.doorLeaf}
                                                            x1={line.start.x}
                                                            y1={line.start.y}
                                                            x2={leafEnd.x}
                                                            y2={leafEnd.y}
                                                        />
                                                        <path
                                                            d={`M ${leafEnd.x} ${leafEnd.y} Q ${centrePoint.x + swingNormal.x * leafDepth} ${centrePoint.y + swingNormal.y * leafDepth} ${centrePoint.x} ${centrePoint.y}`}
                                                        />
                                                        <line
                                                            className={styles.doorLeaf}
                                                            x1={line.end.x}
                                                            y1={line.end.y}
                                                            x2={secondLeafEnd.x}
                                                            y2={secondLeafEnd.y}
                                                        />
                                                        <path
                                                            d={`M ${secondLeafEnd.x} ${secondLeafEnd.y} Q ${centrePoint.x + swingNormal.x * leafDepth} ${centrePoint.y + swingNormal.y * leafDepth} ${centrePoint.x} ${centrePoint.y}`}
                                                        />
                                                    </>
                                                ) : (
                                                    <>
                                                        <line
                                                            className={styles.doorLeaf}
                                                            x1={hingePoint.x}
                                                            y1={hingePoint.y}
                                                            x2={leafEnd.x}
                                                            y2={leafEnd.y}
                                                        />
                                                        <path
                                                            d={`M ${leafEnd.x} ${leafEnd.y} Q ${freePoint.x + swingNormal.x * leafDepth} ${freePoint.y + swingNormal.y * leafDepth} ${freePoint.x} ${freePoint.y}`}
                                                        />
                                                    </>
                                                )
                                            ) : (
                                                <SlidingDoorSymbol
                                                    start={line.start}
                                                    end={line.end}
                                                    normal={opening.segment.inwardNormal}
                                                    mount={door.slidingMount}
                                                    direction={door.slidingDirection}
                                                    double={doorKind === "sliding-double"}
                                                    partition={Boolean(door.partitionId)}
                                                    thickness={renderedWallThickness}
                                                />
                                            )}
                                        </g>
                                    );
                                })}
                            {preview && showCommittedDimensions && !ghost && (
                                <g
                                    className={styles.openingHeightTags}
                                    data-draw-room-opening-heights="true"
                                    aria-hidden="true"
                                >
                                    {renderedOpenings.map((opening) => {
                                        const tag = getOpeningHeightTag(
                                            opening,
                                            renderedWallThickness,
                                            annotationMillimetersPerPixel,
                                        );
                                        const fontSize = dimensionFontSize * 0.86;
                                        const characters =
                                            tag.height.length +
                                            (tag.sill ? tag.sill.length + 2 : 0);
                                        const width = fontSize * (characters * 0.6 + 1.3);
                                        const height = fontSize * 1.7;
                                        return (
                                            <g
                                                key={`${tag.kind}-${tag.id}`}
                                                data-draw-room-opening-height={tag.id}
                                                transform={
                                                    tag.vertical
                                                        ? `rotate(-90 ${tag.point.x} ${tag.point.y})`
                                                        : undefined
                                                }
                                            >
                                                <rect
                                                    x={tag.point.x - width / 2}
                                                    y={tag.point.y - height / 2}
                                                    width={width}
                                                    height={height}
                                                    rx={height * 0.22}
                                                />
                                                <text
                                                    x={tag.point.x}
                                                    y={tag.point.y}
                                                    textAnchor="middle"
                                                    dominantBaseline="middle"
                                                    style={{ fontSize }}
                                                >
                                                    <tspan>{tag.height}</tspan>
                                                    {tag.sill && (
                                                        <tspan
                                                            className={styles.openingSillValue}
                                                            dx={fontSize * 0.7}
                                                        >
                                                            {tag.sill}
                                                        </tspan>
                                                    )}
                                                </text>
                                            </g>
                                        );
                                    })}
                                </g>
                            )}
                            {preview && openingPreview && (
                                <g
                                    className={`${styles.openingGhost} ${openingPreview.valid ? styles.openingValid : styles.openingInvalid}`}
                                    data-draw-room-opening-preview={openingPreview.kind}
                                    aria-hidden="true"
                                >
                                    {(() => {
                                        const line = openingLine(
                                            openingPreview.segment,
                                            openingPreview.origin,
                                            openingPreview.offset,
                                            openingPreview.width,
                                        );
                                        const label = {
                                            x: (line.start.x + line.end.x) / 2,
                                            y: (line.start.y + line.end.y) / 2,
                                        };
                                        if (openingPreview.kind === "window") {
                                            return (
                                                <>
                                                    <line
                                                        className={styles.windowPreviewLine}
                                                        x1={line.start.x}
                                                        y1={line.start.y}
                                                        x2={line.end.x}
                                                        y2={line.end.y}
                                                    />
                                                    <path
                                                        className={styles.windowPreviewMullion}
                                                        d={`M ${label.x} ${label.y - annotationMillimetersPerPixel * 11} V ${label.y + annotationMillimetersPerPixel * 11}`}
                                                    />
                                                </>
                                            );
                                        }
                                        const doorKind = openingPreview.doorKind ?? "room";
                                        const hinged = isHingedDoor({ doorKind });
                                        const depth = openingPreview.width;
                                        const leafEnd = {
                                            x:
                                                line.start.x +
                                                openingPreview.segment.inwardNormal.x * depth,
                                            y:
                                                line.start.y +
                                                openingPreview.segment.inwardNormal.y * depth,
                                        };
                                        return (
                                            <>
                                                <line
                                                    className={styles.doorPreviewLine}
                                                    x1={line.start.x}
                                                    y1={line.start.y}
                                                    x2={line.end.x}
                                                    y2={line.end.y}
                                                />
                                                {hinged ? (
                                                    <>
                                                        <circle
                                                            className={styles.doorPreviewHinge}
                                                            cx={line.start.x}
                                                            cy={line.start.y}
                                                            r={millimetersPerPixel * 4}
                                                        />
                                                        <line
                                                            className={styles.doorPreviewLeaf}
                                                            x1={line.start.x}
                                                            y1={line.start.y}
                                                            x2={leafEnd.x}
                                                            y2={leafEnd.y}
                                                        />
                                                        <path
                                                            className={styles.doorPreviewArc}
                                                            d={`M ${leafEnd.x} ${leafEnd.y} Q ${line.end.x + openingPreview.segment.inwardNormal.x * depth} ${line.end.y + openingPreview.segment.inwardNormal.y * depth} ${line.end.x} ${line.end.y}`}
                                                        />
                                                        {doorKind === "swing-double" && (
                                                            <>
                                                                <circle
                                                                    className={
                                                                        styles.doorPreviewHinge
                                                                    }
                                                                    cx={line.end.x}
                                                                    cy={line.end.y}
                                                                    r={millimetersPerPixel * 4}
                                                                />
                                                                <line
                                                                    className={
                                                                        styles.doorPreviewLeaf
                                                                    }
                                                                    x1={line.end.x}
                                                                    y1={line.end.y}
                                                                    x2={
                                                                        line.end.x +
                                                                        openingPreview.segment
                                                                            .inwardNormal.x *
                                                                            depth
                                                                    }
                                                                    y2={
                                                                        line.end.y +
                                                                        openingPreview.segment
                                                                            .inwardNormal.y *
                                                                            depth
                                                                    }
                                                                />
                                                            </>
                                                        )}
                                                    </>
                                                ) : (
                                                    <SlidingDoorSymbol
                                                        start={line.start}
                                                        end={line.end}
                                                        normal={openingPreview.segment.inwardNormal}
                                                        mount={openingPreview.slidingMount}
                                                        direction={openingPreview.slidingDirection}
                                                        double={doorKind === "sliding-double"}
                                                        partition={previews.some((owner) =>
                                                            owner.room.partitions?.some(
                                                                (partition) =>
                                                                    partition.id ===
                                                                    openingPreview.segment.id,
                                                            ),
                                                        )}
                                                        thickness={renderedWallThickness}
                                                    />
                                                )}
                                            </>
                                        );
                                    })()}
                                </g>
                            )}
                            {renderedRoomRegions.length > 1 &&
                                !ghost &&
                                showCommittedDimensions &&
                                !furnitureStep &&
                                roomRegionLabelPlacements.map(({ region, label }) => {
                                    return (
                                        <g
                                            key={region.signature}
                                            className={styles.roomRegionLabel}
                                            data-draw-room-region={region.signature}
                                            data-draw-room-region-clear-left={
                                                label.clearBounds.left
                                            }
                                            data-draw-room-region-clear-right={
                                                label.clearBounds.right
                                            }
                                            data-draw-room-region-clear-top={label.clearBounds.top}
                                            data-draw-room-region-clear-bottom={
                                                label.clearBounds.bottom
                                            }
                                        >
                                            <rect
                                                className={styles.roomRegionBacking}
                                                data-draw-room-region-backing="true"
                                                x={label.x - label.width / 2}
                                                y={label.y - label.height / 2}
                                                width={label.width}
                                                height={label.height}
                                                rx={Math.min(
                                                    millimetersPerPixel * 4,
                                                    label.height * 0.15,
                                                )}
                                            />
                                            {label.title && (
                                                <text
                                                    className={styles.roomRegionTitle}
                                                    data-draw-room-region-title="true"
                                                    x={label.x}
                                                    y={label.y - label.fontSize * 1.18}
                                                    style={{ fontSize: label.fontSize }}
                                                    textAnchor="middle"
                                                    dominantBaseline="middle"
                                                >
                                                    {label.title}
                                                </text>
                                            )}
                                            <text
                                                className={styles.roomRegionHeight}
                                                data-draw-room-region-height="true"
                                                x={label.x}
                                                y={
                                                    label.title
                                                        ? label.y
                                                        : label.y - label.fontSize * 0.59
                                                }
                                                style={{ fontSize: label.fontSize }}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                            >
                                                {label.heightValue}
                                            </text>
                                            <text
                                                className={styles.roomRegionArea}
                                                data-draw-room-region-area="true"
                                                x={label.x}
                                                y={
                                                    label.y +
                                                    label.fontSize * (label.title ? 1.18 : 0.59)
                                                }
                                                style={{ fontSize: label.fontSize }}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                            >
                                                {label.areaValue}
                                            </text>
                                        </g>
                                    );
                                })}
                            {tool === "select" && selectedContourWall && (
                                <g
                                    className={styles.contourWallEditor}
                                    data-draw-room-wall-grips="true"
                                    data-draw-room-wall-edit-active={
                                        activeContourWallGrab?.edgeIndex ===
                                        selectedContourWall.edgeIndex
                                            ? "true"
                                            : undefined
                                    }
                                    aria-label="Точки перемещения выбранной стены"
                                >
                                    <circle
                                        className={styles.contourWallEditEndpointHitArea}
                                        data-draw-room-wall-edit-grab="start"
                                        cx={selectedContourWall.start.x}
                                        cy={selectedContourWall.start.y}
                                        r={contourWallEditHitRadius}
                                        onPointerDown={(event) =>
                                            startContourWallDrag(
                                                event,
                                                selectedContourWall.edgeIndex,
                                                "start",
                                            )
                                        }
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHitArea}
                                        data-draw-room-wall-edit-grab="middle"
                                        cx={selectedContourWall.middle.x}
                                        cy={selectedContourWall.middle.y}
                                        r={contourWallEditHitRadius}
                                        onPointerDown={(event) =>
                                            startContourWallDrag(
                                                event,
                                                selectedContourWall.edgeIndex,
                                                "middle",
                                            )
                                        }
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHitArea}
                                        data-draw-room-wall-edit-grab="end"
                                        cx={selectedContourWall.end.x}
                                        cy={selectedContourWall.end.y}
                                        r={contourWallEditHitRadius}
                                        onPointerDown={(event) =>
                                            startContourWallDrag(
                                                event,
                                                selectedContourWall.edgeIndex,
                                                "end",
                                            )
                                        }
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHandle}
                                        cx={selectedContourWall.start.x}
                                        cy={selectedContourWall.start.y}
                                        r={contourWallEditVisualRadius}
                                        aria-hidden="true"
                                    />
                                    <circle
                                        className={styles.contourWallEditMiddleHandle}
                                        cx={selectedContourWall.middle.x}
                                        cy={selectedContourWall.middle.y}
                                        r={contourWallEditVisualRadius}
                                        aria-hidden="true"
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHandle}
                                        cx={selectedContourWall.end.x}
                                        cy={selectedContourWall.end.y}
                                        r={contourWallEditVisualRadius}
                                        aria-hidden="true"
                                    />
                                </g>
                            )}
                            {tool === "select" && selectedSegmentWall && (
                                <g
                                    className={styles.contourWallEditor}
                                    data-draw-room-wall-grips="true"
                                    data-draw-room-wall-segment-grips={
                                        selectedSegmentWall.segmentId
                                    }
                                    aria-label="Точки перемещения выбранной стены"
                                >
                                    <line
                                        className={styles.contourWallSelectedStrip}
                                        data-draw-room-wall-run-highlight="true"
                                        x1={selectedSegmentWall.start.x}
                                        y1={selectedSegmentWall.start.y}
                                        x2={selectedSegmentWall.end.x}
                                        y2={selectedSegmentWall.end.y}
                                        strokeWidth={renderedWallThickness}
                                        mask="url(#wall-opening-mask)"
                                        pointerEvents="none"
                                        aria-hidden="true"
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHitArea}
                                        data-draw-room-wall-edit-grab="start"
                                        cx={selectedSegmentWall.start.x}
                                        cy={selectedSegmentWall.start.y}
                                        r={contourWallEditHitRadius}
                                        onPointerDown={(event) =>
                                            startSegmentWallDrag(
                                                event,
                                                selectedSegmentWall.segmentId,
                                                "start",
                                            )
                                        }
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHitArea}
                                        data-draw-room-wall-edit-grab="middle"
                                        cx={selectedSegmentWall.middle.x}
                                        cy={selectedSegmentWall.middle.y}
                                        r={contourWallEditHitRadius}
                                        onPointerDown={(event) =>
                                            startSegmentWallDrag(
                                                event,
                                                selectedSegmentWall.segmentId,
                                                "middle",
                                            )
                                        }
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHitArea}
                                        data-draw-room-wall-edit-grab="end"
                                        cx={selectedSegmentWall.end.x}
                                        cy={selectedSegmentWall.end.y}
                                        r={contourWallEditHitRadius}
                                        onPointerDown={(event) =>
                                            startSegmentWallDrag(
                                                event,
                                                selectedSegmentWall.segmentId,
                                                "end",
                                            )
                                        }
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHandle}
                                        cx={selectedSegmentWall.start.x}
                                        cy={selectedSegmentWall.start.y}
                                        r={contourWallEditVisualRadius}
                                        aria-hidden="true"
                                    />
                                    <circle
                                        className={styles.contourWallEditMiddleHandle}
                                        cx={selectedSegmentWall.middle.x}
                                        cy={selectedSegmentWall.middle.y}
                                        r={contourWallEditVisualRadius}
                                        aria-hidden="true"
                                    />
                                    <circle
                                        className={styles.contourWallEditEndpointHandle}
                                        cx={selectedSegmentWall.end.x}
                                        cy={selectedSegmentWall.end.y}
                                        r={contourWallEditVisualRadius}
                                        aria-hidden="true"
                                    />
                                </g>
                            )}
                            {/* Doorway thresholds stay selectable above wall drag handles. */}
                            {preview &&
                                renderedOpenings
                                    .filter((opening) => !opening.preview)
                                    .map((opening) => {
                                        const line = openingLine(
                                            opening.segment,
                                            opening.origin,
                                            opening.item.offset,
                                            opening.item.width,
                                        );
                                        return (
                                            <line
                                                key={`opening-select-${opening.item.id}`}
                                                data-draw-room-opening-id={opening.item.id}
                                                data-draw-room-opening-kind={opening.kind}
                                                data-draw-room-opening-threshold-hit="true"
                                                x1={line.start.x}
                                                y1={line.start.y}
                                                x2={line.end.x}
                                                y2={line.end.y}
                                                stroke="transparent"
                                                strokeWidth={Math.max(
                                                    renderedWallThickness * 2,
                                                    millimetersPerPixel * 16,
                                                )}
                                                pointerEvents="stroke"
                                                aria-hidden="true"
                                                style={{ cursor: "grab" }}
                                            />
                                        );
                                    })}
                        </svg>
                        <MeasureTool
                            boardRef={boardRef}
                            active={measuring}
                            onClose={() => setMeasuring(false)}
                            scale={millimetersPerPixel}
                        />
                        {tool === "select" && selectedSegmentWall && !measuring && (
                            <form
                                className={styles.wallLengthPanel}
                                aria-label="Размер стены"
                                key={`${selectedSegmentWall.segmentId}-${selectedSegmentWall.start.x}-${selectedSegmentWall.start.y}-${selectedSegmentWall.end.x}-${selectedSegmentWall.end.y}`}
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    const raw = new FormData(event.currentTarget).get("length");
                                    const length = Number(raw) - renderedWallThickness;
                                    if (!Number.isFinite(length) || length < 500) {
                                        setNotice("Стена должна быть не короче 500 мм по оси.");
                                        return;
                                    }
                                    const horizontal =
                                        selectedSegmentWall.start.y === selectedSegmentWall.end.y;
                                    const point = horizontal
                                        ? {
                                              x: selectedSegmentWall.start.x + length,
                                              y: selectedSegmentWall.start.y,
                                          }
                                        : {
                                              x: selectedSegmentWall.start.x,
                                              y: selectedSegmentWall.start.y + length,
                                          };
                                    const moved = resizeDrawWallRun(
                                        scene.segments,
                                        selectedSegmentWall.segmentId,
                                        "end",
                                        point,
                                        sceneSnapMm,
                                    );
                                    if (moved.status === "invalid") {
                                        setNotice(moved.message);
                                        return;
                                    }
                                    const anchored = reanchorOpeningsAfterWallMove(
                                        scene,
                                        moved.segments,
                                    );
                                    if ("error" in anchored) {
                                        setNotice(anchored.error);
                                        return;
                                    }
                                    if (preview && !getRoomPreview(anchored.scene)) {
                                        setNotice("Изменение разорвало бы замкнутый контур.");
                                        return;
                                    }
                                    commitScene(anchored.scene);
                                    setSelectedSegmentWallId(
                                        moved.segments.find((item) =>
                                            selectedSegmentWall.segmentIds.includes(item.id),
                                        )?.id ?? null,
                                    );
                                    setNotice(
                                        "Длина стены изменена. Противоположный конец остался на месте.",
                                    );
                                }}
                            >
                                <label>
                                    Длина стены, мм
                                    <input
                                        name="length"
                                        type="number"
                                        min={500 + renderedWallThickness}
                                        step={sceneSnapMm}
                                        defaultValue={
                                            Math.abs(
                                                selectedSegmentWall.end.x -
                                                    selectedSegmentWall.start.x,
                                            ) +
                                            Math.abs(
                                                selectedSegmentWall.end.y -
                                                    selectedSegmentWall.start.y,
                                            ) +
                                            renderedWallThickness
                                        }
                                        required
                                    />
                                </label>
                                <small>По внешним краям. Меняется правый или нижний конец.</small>
                                <button type="submit">Применить длину</button>
                            </form>
                        )}
                        <FurnitureEditor
                            boardRef={boardRef}
                            active={activeToolGroup === "furniture"}
                            onActivate={() => {
                                setTool("select");
                                setActiveToolGroup("furniture");
                                setSelectedOpening(null);
                                setSelectedContourWallEdge(null);
                                setSelectedSegmentWallId(null);
                            }}
                            items={scene.furniture ?? []}
                            walls={scene.segments}
                            thickness={renderedWallThickness}
                            doorObstacles={furnitureDoorObstacles}
                            radiatorObstacles={furnitureRadiatorObstacles}
                            presented={activeToolGroup === "result"}
                            autoLayout={
                                furnitureRegion ? (
                                    <AutoLayoutPanel
                                        key={furnitureRegion.signature}
                                        set={autoLayoutSet}
                                        resized={autoLayoutResized}
                                        onSolve={() => void solveAutoLayout()}
                                        solving={autoLayoutSolving}
                                        status={
                                            // A result for other pieces than now is stale.
                                            autoLayoutSolving ||
                                            autoLayoutVariants?.setKey === autoLayoutSetKey
                                                ? autoLayoutStatus
                                                : ""
                                        }
                                        variants={currentAutoLayoutVariants.map(
                                            (variant) => variant.summary,
                                        )}
                                        appliedIndex={autoLayoutApplied}
                                        onApply={(index) => {
                                            setAutoLayoutReviewStatus("");
                                            applyAutoLayout(index);
                                        }}
                                        reviewable={
                                            // Without accounts there is no review queue.
                                            isAuthEnabled &&
                                            autoLayoutApplied !== null &&
                                            Boolean(
                                                currentAutoLayoutVariants[autoLayoutApplied]
                                                    ?.observation,
                                            )
                                        }
                                        reviewHint={
                                            isAuthEnabled && !isAuthenticated
                                                ? "Войдите, чтобы отправить вариант на разбор."
                                                : null
                                        }
                                        reviewStatus={autoLayoutReviewStatus}
                                        onReview={(review) => void submitAutoLayoutReview(review)}
                                        blockedReason={
                                            autoLayoutTarget && autoLayoutTarget.status !== "ready"
                                                ? autoLayoutTarget.message
                                                : null
                                        }
                                    />
                                ) : null
                            }
                            room={furnitureRoom}
                            onChange={(furniture) =>
                                commitScene({ ...sceneForInteractionRef.current, furniture })
                            }
                        />
                        {preview &&
                            !selectedOpeningData &&
                            !selectedWallInspector &&
                            !keyboardEntryOpen &&
                            roomInspectorOpen && (
                                <aside
                                    className={styles.roomInspector}
                                    aria-label="Помещения на плане"
                                    data-draw-room-room-inspector="true"
                                >
                                    <div className={styles.roomInspectorHeading}>
                                        <b>Помещения</b>
                                        <small>
                                            {`Построек: ${roomRegionGroups.length} · помещений: ${renderedRoomRegions.length}`}
                                        </small>
                                        <button
                                            type="button"
                                            className={styles.roomInspectorReturnTools}
                                            onClick={() => toggleToolGroup("walls")}
                                        >
                                            К инструментам
                                        </button>
                                    </div>
                                    {roomRegionGroups.map((group) => (
                                        <section
                                            key={group.id}
                                            className={styles.roomInspectorBuilding}
                                            aria-label={group.name}
                                            data-draw-room-building-group={group.id}
                                        >
                                            <h3>{group.name}</h3>
                                            {group.regions.map((region) => (
                                                <label
                                                    key={region.signature}
                                                    className={styles.roomInspectorItem}
                                                    data-draw-room-region-item={region.signature}
                                                    data-selected={
                                                        region.signature === selectedRegionSignature
                                                    }
                                                >
                                                    <span>
                                                        {(
                                                            region.areaSquareMillimeters / 1_000_000
                                                        ).toLocaleString("ru-RU", {
                                                            maximumFractionDigits: 2,
                                                        })}{" "}
                                                        м²
                                                    </span>
                                                    <input
                                                        aria-label={`Название помещения ${region.name} — ${group.name}`}
                                                        value={region.name}
                                                        maxLength={80}
                                                        onFocus={() =>
                                                            setSelectedRegionSignature(
                                                                region.signature,
                                                            )
                                                        }
                                                        onChange={(event) =>
                                                            updateRegion(region.signature, {
                                                                name: event.target.value,
                                                            })
                                                        }
                                                    />
                                                    <select
                                                        aria-label={`Тип помещения ${region.name}`}
                                                        value={region.kind ?? ""}
                                                        onFocus={() =>
                                                            setSelectedRegionSignature(
                                                                region.signature,
                                                            )
                                                        }
                                                        onChange={(event) =>
                                                            updateRegion(region.signature, {
                                                                kind: event.target
                                                                    .value as RoomKind,
                                                            })
                                                        }
                                                    >
                                                        <option value="" disabled>
                                                            Тип комнаты
                                                        </option>
                                                        {ROOM_KINDS.map((item) => (
                                                            <option
                                                                key={item.kind}
                                                                value={item.kind}
                                                            >
                                                                {item.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                            ))}
                                        </section>
                                    ))}
                                </aside>
                            )}
                        {resultStep && resultSummary && (
                            <ResultPanel
                                rooms={resultSummary.rooms}
                                unassigned={resultSummary.unassigned}
                                conflictCount={resultSummary.conflictCount}
                                status={resultStatus}
                                busy={resultBusy}
                                onDownload={() => void downloadResult()}
                                onPrint={() => void printResult()}
                            />
                        )}
                        {printImageUrl &&
                            // On the body, so the editor's clipped panes never cut the sheet.
                            createPortal(
                                <div
                                    className={styles.printSheet}
                                    data-draw-room-print-sheet="true"
                                >
                                    {/* A generated object URL; next/image cannot optimise it. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={printImageUrl}
                                        alt="План квартиры для печати"
                                        onLoad={() => window.print()}
                                    />
                                </div>,
                                document.body,
                            )}
                        {selectedRadiatorData &&
                            !selectedOpeningData &&
                            !selectedWallInspector &&
                            !keyboardEntryOpen && (
                                <aside
                                    className={styles.openingInspector}
                                    aria-label="Параметры: радиатор"
                                    data-draw-room-radiator-inspector="true"
                                >
                                    <div className={styles.openingInspectorHeading}>
                                        <span
                                            className={styles.openingInspectorMark}
                                            aria-hidden="true"
                                        >
                                            <ToolIcon name="radiator" />
                                        </span>
                                        <div>
                                            <b>Радиатор</b>
                                            <small>Перед ним 30 см остаются свободными</small>
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.openingInspectorClose}
                                            aria-label="Снять выделение радиатора"
                                            onClick={() => setSelectedRadiatorId(null)}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    <label className={styles.openingControl}>
                                        <span>Ширина, мм</span>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            aria-label="Ширина радиатора, мм"
                                            min={300}
                                            max={selectedRadiatorData.segment.length}
                                            step={sceneSnapMm}
                                            value={selectedRadiatorData.radiator.width}
                                            onChange={(event) =>
                                                updateSelectedRadiator({
                                                    width: Number(event.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                    <label className={styles.openingControl}>
                                        <span>От начала стены, мм</span>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            aria-label="Отступ радиатора от начала стены, мм"
                                            min={0}
                                            max={Math.max(
                                                0,
                                                selectedRadiatorData.segment.length -
                                                    selectedRadiatorData.radiator.width,
                                            )}
                                            step={sceneSnapMm}
                                            value={selectedRadiatorData.radiator.offset}
                                            onChange={(event) =>
                                                updateSelectedRadiator({
                                                    offset: Number(event.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        className={styles.deleteOpeningButton}
                                        onClick={deleteSelectedRadiator}
                                    >
                                        Удалить радиатор
                                    </button>
                                </aside>
                            )}
                        {selectedWallInspector && !keyboardEntryOpen && (
                            <aside
                                className={styles.openingInspector}
                                aria-label="Параметры: стена"
                                data-draw-room-wall-inspector="true"
                            >
                                <div className={styles.openingInspectorHeading}>
                                    <span
                                        className={styles.openingInspectorMark}
                                        aria-hidden="true"
                                    >
                                        <ToolIcon name="wall" />
                                    </span>
                                    <div>
                                        <b>Стена</b>
                                        <small>Выбрана для правки</small>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.openingInspectorClose}
                                        aria-label="Снять выделение стены"
                                        onClick={() => {
                                            setSelectedContourWallEdge(null);
                                            setSelectedSegmentWallId(null);
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                                <p className={styles.openingInspectorNote}>
                                    Тяните точки на стене, чтобы сдвинуть её или изменить длину.
                                    Delete или Backspace удаляет стену вместе с её дверями и окнами.
                                </p>
                                <button
                                    type="button"
                                    className={styles.deleteWallButton}
                                    onClick={deleteSelectedWall}
                                >
                                    Удалить стену
                                </button>
                            </aside>
                        )}
                        {selectedOpeningData && !keyboardEntryOpen && (
                            <aside
                                className={styles.openingInspector}
                                aria-label={`Параметры: ${selectedOpeningData.kind === "door" ? "дверь" : "окно"}`}
                                data-draw-room-opening-inspector={selectedOpeningData.kind}
                            >
                                <div className={styles.openingInspectorHeading}>
                                    <span
                                        className={styles.openingInspectorMark}
                                        aria-hidden="true"
                                    >
                                        <ToolIcon name={selectedOpeningData.kind} />
                                    </span>
                                    <div>
                                        <b>
                                            {selectedOpeningData.kind === "door"
                                                ? getDoorKindLabel(
                                                      (selectedOpeningData.item as DoorOpening)
                                                          .doorKind,
                                                  )
                                                : "Окно"}
                                        </b>
                                        <small>
                                            {(selectedOpeningData.item as DoorOpening).partitionId
                                                ? "Привязано к перегородке · шаг 50 мм"
                                                : "Привязано к стене · шаг 50 мм"}
                                        </small>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.openingInspectorClose}
                                        aria-label="Закрыть параметры проёма"
                                        onClick={() => setSelectedOpening(null)}
                                    >
                                        ×
                                    </button>
                                </div>
                                {renderedRoomRegions.length > 0 && (
                                    <div className={styles.openingRoomList} aria-label="Помещения">
                                        <b>Помещения</b>
                                        {renderedRoomRegions.map((region) => (
                                            <span key={region.signature}>
                                                <i>{region.name}</i>
                                                <small>
                                                    {(
                                                        region.areaSquareMillimeters / 1_000_000
                                                    ).toLocaleString("ru-RU", {
                                                        maximumFractionDigits: 2,
                                                    })}{" "}
                                                    м²
                                                </small>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <label className={styles.openingControl}>
                                    <span>Ширина, мм</span>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        aria-label="Ширина, мм"
                                        min={
                                            openingBounds(
                                                selectedOpeningData.kind,
                                                (selectedOpeningData.item as DoorOpening)
                                                    .doorKind ?? "room",
                                            ).minimum
                                        }
                                        max={
                                            openingBounds(
                                                selectedOpeningData.kind,
                                                (selectedOpeningData.item as DoorOpening)
                                                    .doorKind ?? "room",
                                            ).maximum
                                        }
                                        step={sceneSnapMm}
                                        value={selectedOpeningData.item.width}
                                        onChange={(event) =>
                                            updateSelectedOpening({
                                                width: Number(event.target.value),
                                            })
                                        }
                                    />
                                    {selectedOpeningData.kind === "door" && (
                                        <small className={styles.openingWidthHint}>
                                            {formatWallLengthWithUnit(
                                                selectedOpeningData.item.width,
                                            )}{" "}
                                            · шаг {sceneSnapMm} мм
                                        </small>
                                    )}
                                </label>
                                <label className={styles.openingControl}>
                                    <span>
                                        {(selectedOpeningData.item as DoorOpening).partitionId
                                            ? "От начала перегородки, мм"
                                            : "От начала стены, мм"}
                                    </span>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min={OPENING_END_CLEARANCE_MM}
                                        max={Math.max(
                                            OPENING_END_CLEARANCE_MM,
                                            selectedOpeningData.segment.length -
                                                selectedOpeningData.item.width -
                                                OPENING_END_CLEARANCE_MM,
                                        )}
                                        step={sceneSnapMm}
                                        value={selectedOpeningData.item.offset}
                                        onChange={(event) =>
                                            updateSelectedOpening({
                                                offset: Number(event.target.value),
                                            })
                                        }
                                    />
                                    <small className={styles.openingDirectionHint}>
                                        Начало:{" "}
                                        {selectedOpeningData.segment.orientation === "horizontal"
                                            ? selectedOpeningData.segment.start.x <
                                              selectedOpeningData.segment.end.x
                                                ? "слева"
                                                : "справа"
                                            : selectedOpeningData.segment.start.y <
                                                selectedOpeningData.segment.end.y
                                              ? "сверху"
                                              : "снизу"}
                                    </small>
                                </label>
                                <OpeningHeightFields
                                    key={`${selectedOpeningData.kind}-${selectedOpeningData.item.id}`}
                                    kind={selectedOpeningData.kind}
                                    item={selectedOpeningData.item}
                                    step={sceneSnapMm}
                                    onChange={updateSelectedOpening}
                                    onReject={setNotice}
                                />
                                {selectedOpeningError && (
                                    <p role="alert" className={styles.openingInspectorNote}>
                                        {selectedOpeningError}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    className={styles.mobileDeleteOpeningButton}
                                    onClick={deleteSelectedOpening}
                                >
                                    Удалить {selectedOpeningData.kind === "door" ? "дверь" : "окно"}
                                </button>
                                {selectedOpeningData.kind === "door" && (
                                    <>
                                        <fieldset className={styles.hingeControl}>
                                            <legend>Тип двери</legend>
                                            <div className={styles.doorKindControl}>
                                                {DOOR_CATALOG.map((catalogItem) => (
                                                    <button
                                                        key={catalogItem.kind}
                                                        type="button"
                                                        aria-pressed={
                                                            ((
                                                                selectedOpeningData.item as DoorOpening
                                                            ).doorKind ?? "room") ===
                                                            catalogItem.kind
                                                        }
                                                        onClick={() =>
                                                            updateSelectedOpening({
                                                                doorKind: catalogItem.kind,
                                                            })
                                                        }
                                                    >
                                                        {catalogItem.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </fieldset>
                                        {!isHingedDoor(selectedOpeningData.item as DoorOpening) && (
                                            <SlidingDoorSettings
                                                mount={
                                                    (selectedOpeningData.item as DoorOpening)
                                                        .slidingMount
                                                }
                                                direction={
                                                    (selectedOpeningData.item as DoorOpening)
                                                        .slidingDirection
                                                }
                                                double={
                                                    (selectedOpeningData.item as DoorOpening)
                                                        .doorKind === "sliding-double"
                                                }
                                                onChange={updateSelectedOpening}
                                            />
                                        )}
                                        {isHingedDoor(selectedOpeningData.item as DoorOpening) && (
                                            <>
                                                <fieldset className={styles.hingeControl}>
                                                    <legend>Петли</legend>
                                                    <div>
                                                        {(
                                                            [
                                                                ["start", "Слева"],
                                                                ["end", "Справа"],
                                                            ] as const
                                                        ).map(([hinge, label]) => (
                                                            <button
                                                                key={hinge}
                                                                type="button"
                                                                aria-pressed={
                                                                    (
                                                                        selectedOpeningData.item as DoorOpening
                                                                    ).hinge === hinge
                                                                }
                                                                onClick={() =>
                                                                    updateSelectedOpening({ hinge })
                                                                }
                                                            >
                                                                {label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </fieldset>
                                                <fieldset className={styles.hingeControl}>
                                                    <legend>Открывание</legend>
                                                    <div>
                                                        {(
                                                            [
                                                                [
                                                                    "inward",
                                                                    (
                                                                        selectedOpeningData.item as DoorOpening
                                                                    ).partitionId
                                                                        ? "Слева от линии"
                                                                        : "В комнату",
                                                                ],
                                                                [
                                                                    "outward",
                                                                    (
                                                                        selectedOpeningData.item as DoorOpening
                                                                    ).partitionId
                                                                        ? "Справа от линии"
                                                                        : "Наружу",
                                                                ],
                                                            ] as const
                                                        ).map(([swingDirection, label]) => (
                                                            <button
                                                                key={swingDirection}
                                                                type="button"
                                                                aria-pressed={
                                                                    ((
                                                                        selectedOpeningData.item as DoorOpening
                                                                    ).swingDirection ??
                                                                        "inward") === swingDirection
                                                                }
                                                                onClick={() =>
                                                                    updateSelectedOpening({
                                                                        swingDirection,
                                                                    })
                                                                }
                                                            >
                                                                {label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </fieldset>
                                            </>
                                        )}
                                        {(selectedOpeningData.item as DoorOpening).doorKind ===
                                            "balcony" && (
                                            <button
                                                type="button"
                                                className={styles.convertOpeningButton}
                                                onClick={convertSelectedBalconyDoorToWindow}
                                            >
                                                Сделать обычным окном
                                            </button>
                                        )}
                                    </>
                                )}
                                {selectedOpeningData.kind === "window" && (
                                    <>
                                        <fieldset className={styles.hingeControl}>
                                            <legend>Тип окна</legend>
                                            <div>
                                                {(
                                                    [
                                                        ["standard", "Обычное"],
                                                        ["floor-to-ceiling", "Панорамное"],
                                                    ] as const
                                                ).map(([windowKind, label]) => (
                                                    <button
                                                        key={windowKind}
                                                        type="button"
                                                        aria-pressed={
                                                            ((
                                                                selectedOpeningData.item as WindowOpening
                                                            ).windowKind ?? "standard") ===
                                                            windowKind
                                                        }
                                                        onClick={() =>
                                                            // Heights fall back to the new
                                                            // kind's own standard values.
                                                            updateSelectedOpening({
                                                                windowKind,
                                                                height: undefined,
                                                                sillHeight: undefined,
                                                            })
                                                        }
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </fieldset>
                                        <button
                                            type="button"
                                            className={styles.convertOpeningButton}
                                            onClick={convertSelectedWindowToBalconyDoor}
                                        >
                                            Сделать балконной дверью
                                        </button>
                                    </>
                                )}
                                <p className={styles.openingInspectorNote}>
                                    {selectedOpeningData.kind === "door"
                                        ? (selectedOpeningData.item as DoorOpening).partitionId
                                            ? isHingedDoor(selectedOpeningData.item as DoorOpening)
                                                ? "Дуга показывает сторону открывания относительно линии перегородки. Сам проём вырезан из препятствия и участвует в проверке прохода."
                                                : "Полотно идёт по направляющей без петель. Сам проём вырезан из перегородки и участвует в проверке прохода."
                                            : ((selectedOpeningData.item as DoorOpening)
                                                    .swingDirection ?? "inward") === "inward" &&
                                                isHingedDoor(
                                                    selectedOpeningData.item as DoorOpening,
                                                )
                                              ? "Дуга показывает открывание внутрь комнаты. Планировщик резервирует этот сектор для двери."
                                              : isHingedDoor(
                                                      selectedOpeningData.item as DoorOpening,
                                                  )
                                                ? "Дуга показывает открывание наружу. В планировщике свободным остаётся сектор комнаты, но сам проём у стены сохраняется."
                                                : "Проверяется полный ход полотна. Для пенала нужны свободный участок внутри стены и достаточная толщина."
                                        : (selectedOpeningData.item as WindowOpening).windowKind ===
                                            "floor-to-ceiling"
                                          ? "Панорамное окно сохраняет свободным участок стены и зону штор для любой мебели."
                                          : "Окно сохраняется в проекте и учитывается при расстановке мебели."}
                                </p>
                                <button
                                    type="button"
                                    className={styles.deleteOpeningButton}
                                    onClick={deleteSelectedOpening}
                                >
                                    Удалить {selectedOpeningData.kind === "door" ? "дверь" : "окно"}
                                </button>
                            </aside>
                        )}
                        <span
                            className={styles.drawingLiveStatus}
                            data-draw-room-live-status="true"
                            aria-live="polite"
                        >
                            {ghost && liveWallLength > 0
                                ? `${wallDrawingAnchorAttachment === "endpoint" ? "Привязка к концу стены." : wallDrawingAnchorAttachment === "side" ? "Привязка к стороне стены." : "Свободная точка."} Угол 90 градусов, направление по оси. Длина: ${formatWallLengthWithUnit(liveWallLength)}. Толщина: ${formatWallThickness(renderedWallThickness)}.${liveDimensionLayout === "compact" ? " Компактная подача: дублирующий размер у занятого торца скрыт, исходная толщина сохранена." : ""}`
                                : ""}
                        </span>
                        <span
                            className={styles.drawingLiveStatus}
                            data-draw-room-dimension-fallback={
                                compactDimensionFallback ? "true" : undefined
                            }
                            aria-live="polite"
                        >
                            {compactDimensionFallback
                                ? "Повторные размеры скрыты, чтобы чертёж оставался читаемым."
                                : !showCommittedDimensions
                                  ? "Размеры скрыты на дальнем масштабе. Приблизьте чертёж или нажмите «Вместить»."
                                  : ""}
                        </span>
                    </div>
                </section>

                <footer className={styles.statusBar}>
                    <span data-draw-room-status="grid">
                        <i className={styles.statusDot} /> Сетка: {formatWallThickness(sceneSnapMm)}
                        {gridPresentation.label !== "50 мм" && ` · вид ${gridPresentation.label}`}
                    </span>
                    <span data-draw-room-status="thickness">
                        Толщина стены: {formatWallThickness(renderedWallThickness)}
                    </span>
                    <span
                        ref={zoomStatusRef}
                        data-draw-room-status="zoom"
                    >{`Масштаб: ${Math.max(zoomPercent, 1)}%`}</span>
                    <span data-draw-room-status="contour">
                        {preview
                            ? `Контур готов: ${formatMeters(preview.room.width)} × ${formatMeters(preview.room.depth)} · ${closedRoomArea}`
                            : "Контур ещё не замкнут"}
                    </span>
                    <span data-draw-room-status="coordinates">
                        {cursorPoint
                            ? `X ${Math.round(cursorPoint.x)} · Y ${Math.round(cursorPoint.y)} мм`
                            : "Наведите курсор на поле"}
                    </span>
                </footer>
            </main>
        </>
    );
};

export default DrawRoom;
