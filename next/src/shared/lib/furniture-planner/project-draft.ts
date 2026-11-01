import { MAX_DRAWN_CONTOUR_MM, WALL_THICKNESS_RANGE_MM } from "./draw-room-grid";
import { getProjectStorage } from "@/shared/lib/project-scope/storage";
import { drawingBlockingIssues } from "./draw-furniture-handoff";
import { getFurniturePhotos } from "./furniture-photos";
import { normalizeVisualTestSession, type VisualTestSession } from "@/shared/lib/visual-preference";
import { FURNITURE_BY_ID, FURNITURE_CATALOG, getMaximumFurnitureCount } from "./catalog";
import { validateLayout, validateRoomGeometry } from "./geometry";
import type { FurniturePriority } from "./handoff";
import type { PlacementHistory } from "./placement-history";
import { buildFurnitureInstancesExcludingRemoved, validateRemovalRecords } from "./removal";
import { getRoomSegment, validateOrthogonalRoomGeometry } from "./room-geometry";
import { normalizeRoomRegionsState } from "./room-regions";
import type {
    FurnitureInstance,
    DoorKind,
    LayoutPreferences,
    LayoutVariant,
    LayoutVariantProfile,
    Placement,
    RadiatorObstacle,
    RemovalRecord,
    Room,
    RoomGeometry,
    Rotation,
    Wall,
} from "./types";

export const STYLEFINDER_PROJECT_DRAFT_VERSION = 4 as const;
export const STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY = "stylefinder:project-draft:v4";
export const STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY = "stylefinder:project-draft:v3";
export const STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY = "stylefinder:project-draft:v2";
export const STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY = "stylefinder:project-draft:v1";

const LEGACY_PROJECT_DRAFT_STORAGE_KEYS = [
    STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY,
    STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY,
    STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY,
] as const;

const MIN_ROOM_MM = 2400;
const MAX_ROOM_MM = MAX_DRAWN_CONTOUR_MM;
const MAX_LAYOUT_VARIANTS = 3;
const MAX_HISTORY_SNAPSHOTS = 50;
const MAX_LAYOUT_NOTES = 32;
const MAX_NOTE_LENGTH = 500;
const MAX_DESIGN_LAB_FEEDBACK_ENTRIES = 8;
const MAX_DESIGN_LAB_NOTE_LENGTH = 1200;
const MAX_SCORE_MAGNITUDE = 1_000_000_000;
const VALID_WALLS = new Set<Wall>(["top", "right", "bottom", "left"]);
const VALID_DOOR_KINDS = new Set([
    "room",
    "balcony",
    "swing-double",
    "sliding-single",
    "sliding-double",
]);
const VALID_PRIORITIES = new Set<FurniturePriority>(["required", "preferred", "optional"]);
const VALID_ROTATIONS = new Set<Rotation>([0, 90, 180, 270]);
const VALID_DESIGN_LAB_VERDICTS = new Set<DesignLabVerdict>(["good", "questionable", "needs-fix"]);
const VALID_PROFILE_IDS = new Set<LayoutVariantProfile["id"]>([
    "fit-all",
    "balanced",
    "daylight",
    "open-center",
    "perimeter",
    "long-wall",
    "zoned",
]);
const CATALOG_ORDER = new Map(FURNITURE_CATALOG.map((definition, index) => [definition.id, index]));

export interface ProjectDraftFurnitureItem {
    definitionId: string;
    count: number;
    priority: FurniturePriority;
}

export interface ProjectDraftLayoutState {
    origin?: "drawing";
    variants: LayoutVariant[];
    activeVariantId: string | null;
    editedVariantIds: string[];
    placements: Placement[];
    history: PlacementHistory;
    exploredNodes: number;
    score: number;
    notes: string[];
    generatedAt: string;
}

export type DesignLabVerdict = "good" | "questionable" | "needs-fix";

export interface DesignLabFeedbackEntry {
    id: string;
    verdict: DesignLabVerdict;
    note: string;
    createdAt: string;
}

/** A manual scene may be incomplete while a designer is still working on it. */
export interface ProjectDraftDesignLabState {
    manualScene: boolean;
    feedback: DesignLabFeedbackEntry[];
}

export interface StyleFinderProjectDraft {
    version: 4;
    updatedAt: number;
    visualTest?: VisualTestSession;
    questionnaire: {
        items: ProjectDraftFurnitureItem[];
        preferences?: LayoutPreferences;
        meta?: {
            styleKey?: string;
            styleLabel?: string;
        };
    };
    planner?: {
        room: Room;
        selection: Record<string, number>;
        priorities: Record<string, FurniturePriority>;
        preferences?: LayoutPreferences;
        layout?: ProjectDraftLayoutState;
        designLab?: ProjectDraftDesignLabState;
        removedItems?: RemovalRecord[];
        removalArchive?: RemovalRecord[];
    };
}

interface StyleFinderProjectDraftV1 {
    version: 1;
    updatedAt: number;
    questionnaire: StyleFinderProjectDraft["questionnaire"];
    planner?: Omit<
        NonNullable<StyleFinderProjectDraft["planner"]>,
        "layout" | "designLab" | "removedItems" | "removalArchive"
    >;
}

interface StyleFinderProjectDraftV2 {
    version: 2;
    updatedAt: number;
    questionnaire: StyleFinderProjectDraft["questionnaire"];
    planner?: Omit<
        NonNullable<StyleFinderProjectDraft["planner"]>,
        "designLab" | "removedItems" | "removalArchive"
    >;
}

export interface ProjectDraftStorage {
    getItem(key: string): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
}

export interface ProjectDraftStorageOptions {
    /** Tests may inject a Storage-compatible implementation. `null` means unavailable. */
    storage?: ProjectDraftStorage | null;
    now?: number;
}

export type ProjectDraftInvalidReason =
    | "invalid-payload"
    | "invalid-version"
    | "invalid-updated-at"
    | "invalid-questionnaire"
    | "invalid-items"
    | "invalid-item"
    | "duplicate-definition-id"
    | "invalid-preferences"
    | "invalid-meta"
    | "invalid-visual-test"
    | "invalid-planner"
    | "invalid-room"
    | "invalid-selection"
    | "invalid-priorities"
    | "invalid-removed-items"
    | "inconsistent-project"
    | "malformed-json";

export type ProjectDraftNormalizationResult =
    | {
          status: "success";
          value: StyleFinderProjectDraft;
          migratedFromVersion?: 1 | 2 | 3;
          discardedLayout?: true;
          discardedVisualTest?: true;
      }
    | { status: "invalid"; reason: ProjectDraftInvalidReason }
    | { status: "unsupported-version"; version: number };

export type ProjectDraftReadResult =
    | ProjectDraftNormalizationResult
    | { status: "missing" }
    | { status: "unavailable" };

export type ProjectDraftSaveResult = ProjectDraftNormalizationResult | { status: "unavailable" };

export type ProjectDraftResetResult = { status: "success" } | { status: "unavailable" };

export type ProjectDraftLayoutValidationResult =
    | { status: "missing" }
    | { status: "valid" }
    | { status: "invalid"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeNumber = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum;

const isFiniteNumber = (value: unknown, minimum: number, maximum: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

const isWall = (value: unknown): value is Wall =>
    typeof value === "string" && VALID_WALLS.has(value as Wall);

const isPriority = (value: unknown): value is FurniturePriority =>
    typeof value === "string" && VALID_PRIORITIES.has(value as FurniturePriority);

const invalid = (reason: ProjectDraftInvalidReason): ProjectDraftNormalizationResult => ({
    status: "invalid",
    reason,
});

const normalizePreferences = (
    input: unknown,
): { status: "success"; value?: LayoutPreferences } | { status: "invalid" } => {
    if (input === undefined) return { status: "success" };
    if (!isRecord(input)) return { status: "invalid" };

    const target = input.tvTargetCategory;
    if (target !== undefined && target !== "sleep" && target !== "living") {
        return { status: "invalid" };
    }

    return target
        ? { status: "success", value: { tvTargetCategory: target } }
        : { status: "success" };
};

const normalizeMeta = (
    input: unknown,
):
    | { status: "success"; value?: StyleFinderProjectDraft["questionnaire"]["meta"] }
    | { status: "invalid" } => {
    if (input === undefined) return { status: "success" };
    if (!isRecord(input)) return { status: "invalid" };

    const normalize = (value: unknown, maximum: number) => {
        if (value === undefined) return undefined;
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed.length <= maximum ? trimmed || undefined : null;
    };
    const styleKey = normalize(input.styleKey, 80);
    const styleLabel = normalize(input.styleLabel, 160);

    if (styleKey === null || styleLabel === null) return { status: "invalid" };
    return styleKey || styleLabel
        ? {
              status: "success",
              value: { ...(styleKey ? { styleKey } : {}), ...(styleLabel ? { styleLabel } : {}) },
          }
        : { status: "success" };
};

const normalizeItems = (
    input: unknown,
):
    | { status: "success"; value: ProjectDraftFurnitureItem[] }
    | { status: "invalid"; reason: ProjectDraftInvalidReason } => {
    if (!Array.isArray(input)) return { status: "invalid", reason: "invalid-items" };

    const seen = new Set<string>();
    const items: ProjectDraftFurnitureItem[] = [];
    for (const candidate of input) {
        if (!isRecord(candidate) || typeof candidate.definitionId !== "string") {
            return { status: "invalid", reason: "invalid-item" };
        }
        const definitionId = candidate.definitionId;
        if (!FURNITURE_BY_ID.has(definitionId) || seen.has(definitionId)) {
            return {
                status: "invalid",
                reason: seen.has(definitionId) ? "duplicate-definition-id" : "invalid-item",
            };
        }
        if (
            !isSafeNumber(candidate.count, 1, getMaximumFurnitureCount(definitionId)) ||
            !isPriority(candidate.priority)
        ) {
            return { status: "invalid", reason: "invalid-item" };
        }
        seen.add(definitionId);
        items.push({
            definitionId,
            count: candidate.count as number,
            priority: candidate.priority,
        });
    }

    items.sort(
        (left, right) =>
            (CATALOG_ORDER.get(left.definitionId) ?? Number.MAX_SAFE_INTEGER) -
            (CATALOG_ORDER.get(right.definitionId) ?? Number.MAX_SAFE_INTEGER),
    );
    return { status: "success", value: items };
};

const normalizeRoomGeometry = (
    input: unknown,
    width: number,
    depth: number,
): RoomGeometry | null => {
    if (input === undefined) return { version: 1, kind: "rect" };
    if (!isRecord(input) || input.version !== 1) return null;
    if (input.kind === "rect") return { version: 1, kind: "rect" };
    if (input.kind !== "orthogonal" || !Array.isArray(input.vertices)) return null;

    const ids = new Set<string>();
    const vertices: Extract<RoomGeometry, { kind: "orthogonal" }>["vertices"] = [];
    for (const vertex of input.vertices) {
        if (
            !isRecord(vertex) ||
            typeof vertex.id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(vertex.id) ||
            ids.has(vertex.id) ||
            !isSafeNumber(vertex.x, 0, width) ||
            !isSafeNumber(vertex.y, 0, depth)
        ) {
            return null;
        }
        ids.add(vertex.id);
        vertices.push({ id: vertex.id, x: vertex.x as number, y: vertex.y as number });
    }

    return { version: 1, kind: "orthogonal", vertices };
};

const normalizeRoom = (input: unknown, allowDrawingWithoutDoor = false): Room | null => {
    if (
        !isRecord(input) ||
        !isSafeNumber(input.width, MIN_ROOM_MM, MAX_ROOM_MM) ||
        !isSafeNumber(input.depth, MIN_ROOM_MM, MAX_ROOM_MM) ||
        (input.wallThickness !== undefined &&
            !isSafeNumber(
                input.wallThickness,
                WALL_THICKNESS_RANGE_MM.minimum,
                WALL_THICKNESS_RANGE_MM.maximum,
            )) ||
        !Array.isArray(input.doors) ||
        !Array.isArray(input.windows) ||
        (input.partitions !== undefined && !Array.isArray(input.partitions)) ||
        (input.radiators !== undefined && !Array.isArray(input.radiators)) ||
        (!allowDrawingWithoutDoor && input.doors.length < 1) ||
        input.windows.length > 2 ||
        ((input.radiators as unknown[] | undefined)?.length ?? 0) > 2
    ) {
        return null;
    }

    const width = input.width as number;
    const depth = input.depth as number;
    const wallThickness = typeof input.wallThickness === "number" ? input.wallThickness : undefined;
    const geometry = normalizeRoomGeometry(input.geometry, width, depth);
    if (!geometry) return null;

    const openingIds = new Set<string>();
    const claimOpeningId = (value: unknown): value is string => {
        if (
            typeof value !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ||
            openingIds.has(value)
        ) {
            return false;
        }
        openingIds.add(value);
        return true;
    };
    const isOptionalSegmentId = (value: unknown): value is string | undefined =>
        value === undefined ||
        (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value));
    const partitions: NonNullable<Room["partitions"]> = [];
    const partitionIds = new Set<string>();
    for (const partition of (input.partitions as unknown[] | undefined) ?? []) {
        if (
            !isRecord(partition) ||
            typeof partition.id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(partition.id) ||
            partitionIds.has(partition.id) ||
            !isRecord(partition.start) ||
            !isRecord(partition.end) ||
            !isSafeNumber(partition.start.x, 0, width) ||
            !isSafeNumber(partition.start.y, 0, depth) ||
            !isSafeNumber(partition.end.x, 0, width) ||
            !isSafeNumber(partition.end.y, 0, depth) ||
            !isSafeNumber(partition.thickness, 1, MAX_ROOM_MM)
        ) {
            return null;
        }
        partitionIds.add(partition.id);
        partitions.push({
            id: partition.id,
            start: { x: partition.start.x as number, y: partition.start.y as number },
            end: { x: partition.end.x as number, y: partition.end.y as number },
            thickness: partition.thickness as number,
        });
    }

    const doors: Room["doors"] = [];
    for (const door of input.doors) {
        if (
            !isRecord(door) ||
            !claimOpeningId(door.id) ||
            !isWall(door.wall) ||
            !isOptionalSegmentId(door.segmentId) ||
            (door.partitionId !== undefined &&
                (typeof door.partitionId !== "string" || !partitionIds.has(door.partitionId))) ||
            !isSafeNumber(door.offset, 0, MAX_ROOM_MM) ||
            !isSafeNumber(door.width, 1, MAX_ROOM_MM) ||
            !isSafeNumber(door.clearanceDepth, 1, MAX_ROOM_MM) ||
            (door.hinge !== undefined && door.hinge !== "start" && door.hinge !== "end") ||
            (door.swingDirection !== undefined &&
                door.swingDirection !== "inward" &&
                door.swingDirection !== "outward") ||
            (door.slidingMount !== undefined &&
                door.slidingMount !== "inward" &&
                door.slidingMount !== "outward" &&
                door.slidingMount !== "pocket") ||
            (door.slidingDirection !== undefined &&
                door.slidingDirection !== "start" &&
                door.slidingDirection !== "end") ||
            (door.doorKind !== undefined &&
                (typeof door.doorKind !== "string" || !VALID_DOOR_KINDS.has(door.doorKind))) ||
            ((door.doorKind === "sliding-single" || door.doorKind === "sliding-double") &&
                (door.hinge !== undefined || door.swingDirection !== undefined)) ||
            (door.height !== undefined && !isSafeNumber(door.height, 1, MAX_ROOM_MM))
        ) {
            return null;
        }
        doors.push({
            id: door.id,
            wall: door.wall,
            segmentId:
                typeof door.segmentId === "string"
                    ? door.segmentId
                    : typeof door.partitionId === "string"
                      ? undefined
                      : geometry.kind === "rect"
                        ? `rect-${door.wall}`
                        : undefined,
            ...(typeof door.partitionId === "string" ? { partitionId: door.partitionId } : {}),
            offset: door.offset as number,
            width: door.width as number,
            clearanceDepth: door.clearanceDepth as number,
            ...(door.hinge ? { hinge: door.hinge } : {}),
            ...(door.swingDirection ? { swingDirection: door.swingDirection } : {}),
            ...(door.doorKind ? { doorKind: door.doorKind as DoorKind } : {}),
            ...(door.slidingMount ? { slidingMount: door.slidingMount } : {}),
            ...(door.slidingDirection ? { slidingDirection: door.slidingDirection } : {}),
            ...(door.height !== undefined ? { height: door.height as number } : {}),
        });
    }
    const exteriorDoorCount = doors.filter((door) => !door.partitionId).length;
    if (exteriorDoorCount !== 1 && !(allowDrawingWithoutDoor && exteriorDoorCount === 0))
        return null;

    const windows: Room["windows"] = [];
    for (const opening of input.windows) {
        if (
            !isRecord(opening) ||
            !claimOpeningId(opening.id) ||
            !isWall(opening.wall) ||
            !isOptionalSegmentId(opening.segmentId) ||
            !isSafeNumber(opening.offset, 0, MAX_ROOM_MM) ||
            !isSafeNumber(opening.width, 1, MAX_ROOM_MM) ||
            (opening.windowKind !== undefined &&
                opening.windowKind !== "standard" &&
                opening.windowKind !== "floor-to-ceiling") ||
            (opening.height !== undefined && !isSafeNumber(opening.height, 1, MAX_ROOM_MM)) ||
            (opening.sillHeight !== undefined &&
                !isSafeNumber(opening.sillHeight, 0, MAX_ROOM_MM)) ||
            (opening.revealDepth !== undefined &&
                !isSafeNumber(opening.revealDepth, 0, MAX_ROOM_MM))
        ) {
            return null;
        }
        windows.push({
            id: opening.id,
            wall: opening.wall,
            segmentId:
                typeof opening.segmentId === "string"
                    ? opening.segmentId
                    : geometry.kind === "rect"
                      ? `rect-${opening.wall}`
                      : undefined,
            offset: opening.offset as number,
            width: opening.width as number,
            ...(opening.windowKind ? { windowKind: opening.windowKind } : {}),
            ...(opening.height !== undefined ? { height: opening.height as number } : {}),
            ...(opening.sillHeight !== undefined
                ? { sillHeight: opening.sillHeight as number }
                : {}),
            ...(opening.revealDepth !== undefined
                ? { revealDepth: opening.revealDepth as number }
                : {}),
        });
    }

    const radiators: RadiatorObstacle[] = [];
    for (const radiator of (input.radiators as unknown[] | undefined) ?? []) {
        if (
            !isRecord(radiator) ||
            !claimOpeningId(radiator.id) ||
            !isWall(radiator.wall) ||
            !isOptionalSegmentId(radiator.segmentId) ||
            !isSafeNumber(radiator.offset, 0, MAX_ROOM_MM) ||
            !isSafeNumber(radiator.width, 1, MAX_ROOM_MM) ||
            !isSafeNumber(radiator.depth, 1, MAX_ROOM_MM) ||
            !isSafeNumber(radiator.clearanceDepth, 0, MAX_ROOM_MM)
        ) {
            return null;
        }
        radiators.push({
            id: radiator.id,
            wall: radiator.wall,
            segmentId:
                typeof radiator.segmentId === "string"
                    ? radiator.segmentId
                    : geometry.kind === "rect"
                      ? `rect-${radiator.wall}`
                      : undefined,
            offset: radiator.offset as number,
            width: radiator.width as number,
            depth: radiator.depth as number,
            clearanceDepth: radiator.clearanceDepth as number,
        });
    }

    // Region labels are secondary metadata. A damaged item is removed by the
    // normalizer rather than making a user's walls and openings disappear.
    const regions = normalizeRoomRegionsState(input.regions);
    const room: Room = {
        width,
        depth,
        ...(wallThickness ? { wallThickness } : {}),
        geometry,
        partitions,
        doors,
        windows,
        radiators,
        ...(regions ? { regions } : {}),
    };
    if (geometry.kind === "orthogonal") {
        const anchored = [...doors, ...windows, ...radiators].every((opening) => {
            const segment = getRoomSegment(room, opening);
            return (
                ("partitionId" in opening && opening.partitionId
                    ? true
                    : typeof opening.segmentId === "string") &&
                segment !== null &&
                segment.wall === opening.wall
            );
        });
        if (!anchored) return null;
    }
    return validateOrthogonalRoomGeometry(room) === null ? room : null;
};

const normalizeSelection = (input: unknown): Record<string, number> | null => {
    if (!isRecord(input)) return null;
    const selection: Record<string, number> = {};
    for (const [definitionId, count] of Object.entries(input)) {
        if (
            !FURNITURE_BY_ID.has(definitionId) ||
            !isSafeNumber(count, 0, getMaximumFurnitureCount(definitionId))
        ) {
            return null;
        }
        selection[definitionId] = count as number;
    }
    return selection;
};

const normalizePriorities = (input: unknown): Record<string, FurniturePriority> | null => {
    if (!isRecord(input)) return null;
    const priorities: Record<string, FurniturePriority> = {};
    for (const [definitionId, priority] of Object.entries(input)) {
        if (!FURNITURE_BY_ID.has(definitionId) || !isPriority(priority)) return null;
        priorities[definitionId] = priority;
    }
    return priorities;
};

const normalizeNotes = (input: unknown): string[] | null => {
    if (!Array.isArray(input) || input.length > MAX_LAYOUT_NOTES) return null;
    const notes: string[] = [];
    for (const note of input) {
        if (typeof note !== "string" || note.length > MAX_NOTE_LENGTH) return null;
        notes.push(note);
    }
    return notes;
};

const normalizeDesignLab = (input: unknown): ProjectDraftDesignLabState | undefined => {
    if (input === undefined || !isRecord(input) || typeof input.manualScene !== "boolean") {
        return undefined;
    }
    if (!Array.isArray(input.feedback) || input.feedback.length > MAX_DESIGN_LAB_FEEDBACK_ENTRIES) {
        return undefined;
    }

    const seenIds = new Set<string>();
    const feedback: DesignLabFeedbackEntry[] = [];
    for (const candidate of input.feedback) {
        if (
            !isRecord(candidate) ||
            typeof candidate.id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(candidate.id) ||
            seenIds.has(candidate.id) ||
            typeof candidate.verdict !== "string" ||
            !VALID_DESIGN_LAB_VERDICTS.has(candidate.verdict as DesignLabVerdict) ||
            typeof candidate.note !== "string" ||
            !candidate.note.trim() ||
            candidate.note.length > MAX_DESIGN_LAB_NOTE_LENGTH ||
            typeof candidate.createdAt !== "string" ||
            !Number.isFinite(Date.parse(candidate.createdAt))
        ) {
            return undefined;
        }
        seenIds.add(candidate.id);
        feedback.push({
            id: candidate.id,
            verdict: candidate.verdict as DesignLabVerdict,
            note: candidate.note.trim(),
            createdAt: candidate.createdAt,
        });
    }

    return { manualScene: input.manualScene, feedback };
};

const expectedPlacementDefinitions = (
    instances: Array<Pick<FurnitureInstance, "instanceId" | "definitionId">>,
) => new Map(instances.map(({ instanceId, definitionId }) => [instanceId, definitionId]));

const normalizePlacements = (
    input: unknown,
    allowedDefinitions: ReadonlyMap<string, string>,
    requiredDefinitions: ReadonlyMap<string, string> = allowedDefinitions,
): Placement[] | null => {
    if (
        !Array.isArray(input) ||
        input.length < requiredDefinitions.size ||
        input.length > allowedDefinitions.size
    ) {
        return null;
    }
    const placements: Placement[] = [];
    const seen = new Set<string>();

    for (const candidate of input) {
        if (
            !isRecord(candidate) ||
            typeof candidate.instanceId !== "string" ||
            typeof candidate.definitionId !== "string" ||
            seen.has(candidate.instanceId) ||
            allowedDefinitions.get(candidate.instanceId) !== candidate.definitionId ||
            !isSafeNumber(candidate.x, 0, MAX_ROOM_MM) ||
            !isSafeNumber(candidate.y, 0, MAX_ROOM_MM) ||
            !VALID_ROTATIONS.has(candidate.rotation as Rotation)
        ) {
            return null;
        }

        const definition = FURNITURE_BY_ID.get(candidate.definitionId);
        const rotation = candidate.rotation as Rotation;
        if (!definition?.rotations.includes(rotation)) return null;

        if (
            (candidate.width !== undefined || candidate.depth !== undefined) &&
            (!isSafeNumber(candidate.width, 10, 10000) || !isSafeNumber(candidate.depth, 10, 10000))
        )
            return null;
        if (
            candidate.photoId !== undefined &&
            !getFurniturePhotos(candidate.definitionId).some(
                (photo) => photo.id === candidate.photoId,
            )
        )
            return null;
        seen.add(candidate.instanceId);
        placements.push({
            instanceId: candidate.instanceId,
            definitionId: candidate.definitionId,
            x: candidate.x as number,
            y: candidate.y as number,
            rotation,
            ...(candidate.width !== undefined
                ? { width: candidate.width as number, depth: candidate.depth as number }
                : {}),
            ...(typeof candidate.photoId === "string" ? { photoId: candidate.photoId } : {}),
        });
    }

    if (Array.from(requiredDefinitions.keys()).some((instanceId) => !seen.has(instanceId))) {
        return null;
    }

    return placements;
};

const normalizeProfile = (input: unknown, maximumItems: number): LayoutVariantProfile | null => {
    if (
        !isRecord(input) ||
        typeof input.id !== "string" ||
        !VALID_PROFILE_IDS.has(input.id as LayoutVariantProfile["id"]) ||
        typeof input.label !== "string" ||
        !input.label.trim() ||
        input.label.length > 120 ||
        !isSafeNumber(input.windowPreferredItems, 0, maximumItems) ||
        !isSafeNumber(input.perimeterItems, 0, maximumItems) ||
        !isFiniteNumber(input.centerClearance, 0, MAX_ROOM_MM)
    ) {
        return null;
    }

    return {
        id: input.id as LayoutVariantProfile["id"],
        label: input.label,
        windowPreferredItems: input.windowPreferredItems as number,
        perimeterItems: input.perimeterItems as number,
        centerClearance: input.centerClearance as number,
    };
};

const normalizeVariant = (
    input: unknown,
    expectedDefinitions: ReadonlyMap<string, string>,
): LayoutVariant | null => {
    if (
        !isRecord(input) ||
        input.status !== "success" ||
        typeof input.variantId !== "string" ||
        !input.variantId ||
        input.variantId.length > 120 ||
        !isSafeNumber(input.exploredNodes) ||
        !isFiniteNumber(input.score, -MAX_SCORE_MAGNITUDE, MAX_SCORE_MAGNITUDE)
    ) {
        return null;
    }
    const placements = normalizePlacements(input.placements, expectedDefinitions);
    const profile = normalizeProfile(input.profile, expectedDefinitions.size);
    const notes = normalizeNotes(input.notes);
    if (!placements || !profile || !notes) return null;

    return {
        status: "success",
        variantId: input.variantId,
        profile,
        placements,
        exploredNodes: input.exploredNodes as number,
        score: input.score as number,
        notes,
    };
};

const normalizeLayout = (
    input: unknown,
    activeDefinitions: ReadonlyMap<string, string>,
    historyDefinitions: ReadonlyMap<string, string> = activeDefinitions,
    requiredHistoryDefinitions: ReadonlyMap<string, string> = activeDefinitions,
): ProjectDraftLayoutState | null => {
    if (
        !isRecord(input) ||
        !Array.isArray(input.variants) ||
        input.variants.length > MAX_LAYOUT_VARIANTS ||
        (input.activeVariantId !== null && typeof input.activeVariantId !== "string") ||
        !Array.isArray(input.editedVariantIds) ||
        !isSafeNumber(input.exploredNodes) ||
        !isFiniteNumber(input.score, -MAX_SCORE_MAGNITUDE, MAX_SCORE_MAGNITUDE) ||
        typeof input.generatedAt !== "string" ||
        !input.generatedAt ||
        !Number.isFinite(Date.parse(input.generatedAt))
    ) {
        return null;
    }

    const placements = normalizePlacements(input.placements, activeDefinitions);
    const notes = normalizeNotes(input.notes);
    if (!placements || !notes) return null;

    let history: PlacementHistory = { past: [], present: placements, future: [] };
    if (input.history !== undefined) {
        if (
            !isRecord(input.history) ||
            !Array.isArray(input.history.past) ||
            !Array.isArray(input.history.future) ||
            input.history.past.length > MAX_HISTORY_SNAPSHOTS ||
            input.history.future.length > MAX_HISTORY_SNAPSHOTS
        ) {
            return null;
        }
        const present = normalizePlacements(input.history.present, activeDefinitions);
        const past = input.history.past.map((snapshot) =>
            normalizePlacements(snapshot, historyDefinitions, requiredHistoryDefinitions),
        );
        const future = input.history.future.map((snapshot) =>
            normalizePlacements(snapshot, historyDefinitions, requiredHistoryDefinitions),
        );
        if (
            !present ||
            past.some((snapshot) => !snapshot) ||
            future.some((snapshot) => !snapshot) ||
            JSON.stringify(present) !== JSON.stringify(placements)
        ) {
            return null;
        }
        history = {
            past: past as Placement[][],
            present,
            future: future as Placement[][],
        };
    }

    const variants: LayoutVariant[] = [];
    const variantIds = new Set<string>();
    for (const candidate of input.variants) {
        const variant = normalizeVariant(candidate, activeDefinitions);
        if (!variant || variantIds.has(variant.variantId)) return null;
        variantIds.add(variant.variantId);
        variants.push(variant);
    }

    const activeVariantId = input.activeVariantId as string | null;
    if (
        (variants.length === 0 && activeVariantId !== null) ||
        (variants.length > 0 && (!activeVariantId || !variantIds.has(activeVariantId)))
    ) {
        return null;
    }

    const editedVariantIds: string[] = [];
    const seenEditedIds = new Set<string>();
    for (const candidate of input.editedVariantIds) {
        if (
            typeof candidate !== "string" ||
            !variantIds.has(candidate) ||
            seenEditedIds.has(candidate)
        ) {
            return null;
        }
        seenEditedIds.add(candidate);
        editedVariantIds.push(candidate);
    }

    const activeVariant = variants.find((variant) => variant.variantId === activeVariantId);
    if (activeVariant && JSON.stringify(activeVariant.placements) !== JSON.stringify(placements)) {
        return null;
    }

    return {
        variants,
        activeVariantId,
        editedVariantIds,
        placements,
        history,
        exploredNodes: input.exploredNodes as number,
        score: input.score as number,
        notes,
        generatedAt: input.generatedAt,
        ...(input.origin === "drawing" && variants.length === 0
            ? { origin: "drawing" as const }
            : {}),
    };
};

const selectionSignature = (selection: Record<string, number>) =>
    JSON.stringify(
        FURNITURE_CATALOG.map((definition) => [definition.id, selection[definition.id] ?? 0]),
    );

export const normalizeProjectDraft = (input: unknown): ProjectDraftNormalizationResult => {
    if (!isRecord(input)) return invalid("invalid-payload");
    if (!Number.isInteger(input.version) || (input.version as number) < 1) {
        return invalid("invalid-version");
    }
    if (
        input.version !== 1 &&
        input.version !== 2 &&
        input.version !== 3 &&
        input.version !== STYLEFINDER_PROJECT_DRAFT_VERSION
    ) {
        return { status: "unsupported-version", version: input.version as number };
    }
    if (!isSafeNumber(input.updatedAt, 1)) return invalid("invalid-updated-at");
    if (!isRecord(input.questionnaire)) return invalid("invalid-questionnaire");

    const items = normalizeItems(input.questionnaire.items);
    if (items.status === "invalid") return invalid(items.reason);
    const questionnairePreferences = normalizePreferences(input.questionnaire.preferences);
    if (questionnairePreferences.status === "invalid") return invalid("invalid-preferences");
    const meta = normalizeMeta(input.questionnaire.meta);
    if (meta.status === "invalid") return invalid("invalid-meta");

    let visualTest: VisualTestSession | undefined;
    let discardedVisualTest = false;
    if (input.version >= 3 && input.visualTest !== undefined) {
        visualTest = normalizeVisualTestSession(input.visualTest) ?? undefined;
        discardedVisualTest = !visualTest;
    }

    let planner: StyleFinderProjectDraft["planner"];
    let discardedLayout = false;
    if (input.planner !== undefined) {
        if (!isRecord(input.planner)) return invalid("invalid-planner");
        const room = normalizeRoom(
            input.planner.room,
            isRecord(input.planner.layout) && input.planner.layout.origin === "drawing",
        );
        if (!room) return invalid("invalid-room");
        const selection = normalizeSelection(input.planner.selection);
        if (!selection) return invalid("invalid-selection");
        const priorities = normalizePriorities(input.planner.priorities);
        if (!priorities) return invalid("invalid-priorities");
        const preferences = normalizePreferences(input.planner.preferences);
        if (preferences.status === "invalid") return invalid("invalid-preferences");
        const designLab =
            input.version >= 3 ? normalizeDesignLab(input.planner.designLab) : undefined;

        const questionnaireSelection = Object.fromEntries(
            items.value.map((item) => [item.definitionId, item.count]),
        );
        if (selectionSignature(selection) !== selectionSignature(questionnaireSelection)) {
            return invalid("inconsistent-project");
        }
        if (items.value.some((item) => priorities[item.definitionId] !== item.priority)) {
            return invalid("inconsistent-project");
        }

        let removedItems: RemovalRecord[] = [];
        let removalArchive: RemovalRecord[] = [];
        if (input.version >= 3) {
            if (input.planner.removedItems !== undefined) {
                const removalValidation = validateRemovalRecords(input.planner.removedItems);
                if (removalValidation.status === "invalid") {
                    return invalid("invalid-removed-items");
                }
                removedItems = removalValidation.value;
            }
            if (input.planner.removalArchive !== undefined) {
                const archiveValidation = validateRemovalRecords(input.planner.removalArchive);
                if (archiveValidation.status === "invalid") {
                    return invalid("invalid-removed-items");
                }
                removalArchive = archiveValidation.value;
            } else {
                removalArchive = removedItems;
            }

            const archiveById = new Map(
                removalArchive.map((record) => [record.instanceId, record]),
            );
            const activeRecordsMatchArchive = removedItems.every((record) => {
                const archived = archiveById.get(record.instanceId);
                if (!archived) return false;
                return (
                    archived.definitionId === record.definitionId &&
                    archived.priority === record.priority &&
                    archived.method === record.method &&
                    archived.reason === record.reason &&
                    archived.removedAt === record.removedAt
                );
            });
            if (!activeRecordsMatchArchive) return invalid("invalid-removed-items");
        }

        let activeDefinitions: Map<string, string>;
        try {
            activeDefinitions = expectedPlacementDefinitions(
                buildFurnitureInstancesExcludingRemoved(selection, priorities, removedItems),
            );
        } catch {
            return invalid("invalid-removed-items");
        }
        const historyDefinitions = new Map(activeDefinitions);
        removalArchive.forEach((record) =>
            historyDefinitions.set(record.instanceId, record.definitionId),
        );
        const archivedInstanceIds = new Set(removalArchive.map((record) => record.instanceId));
        const requiredHistoryDefinitions = new Map(
            Array.from(historyDefinitions).filter(
                ([instanceId]) => !archivedInstanceIds.has(instanceId),
            ),
        );

        let layout: ProjectDraftLayoutState | undefined;
        if (input.version !== 1 && input.planner.layout !== undefined) {
            layout =
                normalizeLayout(
                    input.planner.layout,
                    activeDefinitions,
                    historyDefinitions,
                    requiredHistoryDefinitions,
                ) ?? undefined;
            discardedLayout = !layout;
        }

        planner = {
            room,
            selection,
            priorities,
            ...(preferences.value ? { preferences: preferences.value } : {}),
            ...(layout ? { layout } : {}),
            ...(designLab ? { designLab } : {}),
            ...(removedItems.length > 0 ? { removedItems } : {}),
            ...(removalArchive.length > 0 ? { removalArchive } : {}),
        };
    }

    return {
        status: "success",
        value: {
            version: STYLEFINDER_PROJECT_DRAFT_VERSION,
            updatedAt: input.updatedAt as number,
            ...(visualTest ? { visualTest } : {}),
            questionnaire: {
                items: items.value,
                ...(questionnairePreferences.value
                    ? { preferences: questionnairePreferences.value }
                    : {}),
                ...(meta.value ? { meta: meta.value } : {}),
            },
            ...(planner ? { planner } : {}),
        },
        ...(input.version === 1 || input.version === 2 || input.version === 3
            ? { migratedFromVersion: input.version }
            : {}),
        ...(discardedLayout ? { discardedLayout: true as const } : {}),
        ...(discardedVisualTest ? { discardedVisualTest: true as const } : {}),
    };
};

/** Rechecks restored coordinates against current catalog and geometry rules. */
export const validateProjectDraftLayout = (
    planner: StyleFinderProjectDraft["planner"],
): ProjectDraftLayoutValidationResult => {
    if (!planner?.layout) return { status: "missing" };

    let expectedInstanceIds: Set<string>;
    try {
        expectedInstanceIds = new Set(
            buildFurnitureInstancesExcludingRemoved(
                planner.selection,
                planner.priorities,
                planner.removedItems ?? [],
            ).map((instance) => instance.instanceId),
        );
    } catch {
        return { status: "invalid", message: "История удалений не согласована с комплектом." };
    }
    const placedInstanceIds = new Set(
        planner.layout.placements.map((placement) => placement.instanceId),
    );
    if (
        expectedInstanceIds.size !== placedInstanceIds.size ||
        Array.from(expectedInstanceIds).some((instanceId) => !placedInstanceIds.has(instanceId))
    ) {
        return {
            status: "invalid",
            message: "Состав сохранённой расстановки не согласован с комплектом.",
        };
    }

    const roomError = validateRoomGeometry(planner.room);
    if (roomError) return { status: "invalid", message: roomError };

    const layouts = [
        { label: "выбранная расстановка", placements: planner.layout.placements },
        ...planner.layout.variants.map((variant, index) => ({
            label: `вариант ${index + 1}`,
            placements: variant.placements,
        })),
    ];
    for (const layout of layouts) {
        const validation = validateLayout(
            planner.room,
            layout.placements,
            planner.preferences ?? {},
        );
        if (
            planner.layout.origin === "drawing" && planner.layout.variants.length === 0
                ? drawingBlockingIssues(validation.issues).length > 0
                : !validation.valid
        ) {
            return {
                status: "invalid",
                message: `${layout.label}: ${validation.issues[0]?.message ?? "план больше не проходит проверку"}`,
            };
        }
    }

    return { status: "valid" };
};

const resolveStorage = (options: ProjectDraftStorageOptions): ProjectDraftStorage | null => {
    if (Object.prototype.hasOwnProperty.call(options, "storage")) return options.storage ?? null;
    // The guest store, or the open project's scoped copy of the same keys.
    return getProjectStorage();
};

const removeLegacyProjectDrafts = (storage: ProjectDraftStorage) => {
    for (const key of LEGACY_PROJECT_DRAFT_STORAGE_KEYS) storage.removeItem(key);
};

const hasOwn = (value: object, key: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(value, key);

const resolveUpdatedAt = (now: number | undefined) => (isSafeNumber(now, 1) ? now : Date.now());

export const saveProjectDraft = (
    input: unknown,
    options: ProjectDraftStorageOptions = {},
): ProjectDraftSaveResult => {
    const normalized = normalizeProjectDraft(input);
    if (normalized.status !== "success") return normalized;
    const storage = resolveStorage(options);
    if (!storage) return { status: "unavailable" };

    let value = normalized.value;
    const preserveStoredVisualTest = isRecord(input) && !hasOwn(input, "visualTest");
    if (preserveStoredVisualTest) {
        const stored = readProjectDraft({ storage });
        if (stored.status === "success" && stored.value.visualTest) {
            value = { ...value, visualTest: stored.value.visualTest };
        }
    }

    try {
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY, JSON.stringify(value));
        removeLegacyProjectDrafts(storage);
        return { ...normalized, value };
    } catch {
        return { status: "unavailable" };
    }
};

export const readProjectDraft = (
    options: ProjectDraftStorageOptions = {},
): ProjectDraftReadResult => {
    const storage = resolveStorage(options);
    if (!storage) return { status: "unavailable" };
    let serialized: string | null;
    let sourceKey = STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY;
    try {
        serialized = null;
        for (const key of [
            STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
            ...LEGACY_PROJECT_DRAFT_STORAGE_KEYS,
        ]) {
            const candidate = storage.getItem(key);
            if (candidate !== null) {
                sourceKey = key;
                serialized = candidate;
                break;
            }
        }
    } catch {
        return { status: "unavailable" };
    }
    if (serialized === null) return { status: "missing" };

    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch {
        return invalid("malformed-json");
    }

    const normalized = normalizeProjectDraft(parsed);
    if (
        normalized.status === "success" &&
        (sourceKey !== STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY ||
            normalized.migratedFromVersion !== undefined ||
            normalized.discardedLayout ||
            normalized.discardedVisualTest)
    ) {
        try {
            storage.setItem(
                STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
                JSON.stringify(normalized.value),
            );
            removeLegacyProjectDrafts(storage);
        } catch {
            // A readable draft is still useful when a privacy mode blocks the migration write.
        }
    }
    return normalized;
};

export type ProjectDraftVisualTestMutationResult =
    | ProjectDraftSaveResult
    | Extract<ProjectDraftReadResult, { status: "missing" }>;

/** Updates only visual-test state, retaining every valid questionnaire and planner field. */
export const updateProjectDraftVisualTest = (
    input: unknown,
    options: ProjectDraftStorageOptions = {},
): ProjectDraftVisualTestMutationResult => {
    const visualTest = normalizeVisualTestSession(input);
    if (!visualTest) return invalid("invalid-visual-test");

    const storage = resolveStorage(options);
    if (!storage) return { status: "unavailable" };
    const current = readProjectDraft({ storage });
    if (current.status !== "success" && current.status !== "missing") return current;

    const base =
        current.status === "success"
            ? current.value
            : createProjectDraft({ items: [] }, undefined, resolveUpdatedAt(options.now));
    return saveProjectDraft(
        {
            ...base,
            updatedAt: resolveUpdatedAt(options.now),
            visualTest,
        },
        { storage },
    );
};

/** Clears only visual-test state, retaining questionnaire, room and selected layout. */
export const clearProjectDraftVisualTest = (
    options: ProjectDraftStorageOptions = {},
): ProjectDraftVisualTestMutationResult => {
    const storage = resolveStorage(options);
    if (!storage) return { status: "unavailable" };
    const current = readProjectDraft({ storage });
    if (current.status !== "success") return current;

    return saveProjectDraft(
        {
            ...current.value,
            updatedAt: resolveUpdatedAt(options.now),
            visualTest: undefined,
        },
        { storage },
    );
};

export const resetProjectDraft = (
    options: ProjectDraftStorageOptions = {},
): ProjectDraftResetResult => {
    const storage = resolveStorage(options);
    if (!storage) return { status: "unavailable" };
    try {
        storage.removeItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY);
        removeLegacyProjectDrafts(storage);
        return { status: "success" };
    } catch {
        return { status: "unavailable" };
    }
};

export const createProjectDraft = (
    questionnaire: StyleFinderProjectDraft["questionnaire"],
    planner?: StyleFinderProjectDraft["planner"],
    updatedAt = Date.now(),
): StyleFinderProjectDraft => {
    const normalizedPlanner = planner
        ? { ...planner, room: normalizeRoom(planner.room) ?? planner.room }
        : undefined;

    return {
        version: STYLEFINDER_PROJECT_DRAFT_VERSION,
        updatedAt,
        questionnaire,
        ...(normalizedPlanner ? { planner: normalizedPlanner } : {}),
    };
};

/** @deprecated Read-only types retained for integrations that construct migration fixtures. */
export type { StyleFinderProjectDraftV1, StyleFinderProjectDraftV2 };
