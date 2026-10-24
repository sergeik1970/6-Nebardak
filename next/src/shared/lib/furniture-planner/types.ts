export type Rotation = 0 | 90 | 180 | 270;

export type Wall = "top" | "right" | "bottom" | "left";

export interface RoomVertex {
    /** Stable within one room contour; used to derive segment anchors. */
    id: string;
    x: number;
    y: number;
}

export type RoomGeometry =
    | { version: 1; kind: "rect" }
    | { version: 1; kind: "orthogonal"; vertices: RoomVertex[] };

export interface RoomBoundarySegment {
    id: string;
    start: Pick<RoomVertex, "x" | "y">;
    end: Pick<RoomVertex, "x" | "y">;
    length: number;
    orientation: "horizontal" | "vertical";
    /** Legacy-facing name for the side from which the room interior starts. */
    wall: Wall;
    inwardNormal: { x: -1 | 0 | 1; y: -1 | 0 | 1 };
}

/** A physical wall inside the room, kept separate from the outer contour. */
export interface RoomPartition {
    id: string;
    start: Pick<RoomVertex, "x" | "y">;
    end: Pick<RoomVertex, "x" | "y">;
    thickness: number;
}

/**
 * Named in the furniture's unrotated local coordinate system. `back` is the
 * top edge at rotation 0; the remaining edges follow clockwise.
 */
export type FurnitureBodyEdge = "back" | "right" | "front" | "left";

export type FurniturePriority = "required" | "preferred" | "optional";

export interface CurtainBufferPolicy {
    distance: number;
    model: "conservative-envelope";
    appliesAlongWall: true;
    appliesIntoRoom: true;
    verification: "provisional" | "approved";
    note: string;
}

export type FurnitureCategory = "sleep" | "storage" | "work" | "living" | "media" | "children";

export type FurnitureAssetKey =
    | "single-bed"
    | "double-bed"
    | "cradle"
    | "bookcase"
    | "wardrobe-small"
    | "wardrobe-medium"
    | "wardrobe-large"
    | "desk"
    | "bedside-table"
    | "dresser"
    | "coffee-table"
    | "tv"
    | "sofa-two"
    | "sofa-three"
    | "sofa-four-left";

export interface Rect {
    x: number;
    y: number;
    width: number;
    depth: number;
}

export interface FurnitureShape {
    kind: "rects" | "circle";
    rects: Rect[];
}

export type ClearanceRequirement = "hard" | "preferred" | "one-of";

export interface ClearanceZone extends Rect {
    label: string;
    /**
     * Hard zones always participate in validity. "one-of" zones are valid
     * when at least one zone of the same item remains free; preferred zones
     * affect ranking and notes only.
     */
    requirement: ClearanceRequirement;
}

export type RelationKind = "front-gap" | "adjacent" | "aligned-side" | "faces";

export interface RelationTemplate {
    kind: RelationKind;
    targetCategory: FurnitureCategory;
    /**
     * Narrows a category relation to explicitly approved catalog definitions.
     * When omitted, any definition in `targetCategory` remains a valid target.
     */
    targetDefinitionIds?: string[];
    required: boolean;
    /**
     * Optional catalog overrides. When omitted, the shared geometry resolver
     * supplies the same deterministic interval to generation and validation.
     */
    minGap?: number;
    maxGap?: number;
    /**
     * A narrowly-scoped exception for a dependent item's body entering the
     * target item's clearance. It never permits body/body overlap and must be
     * declared by the dependent definition itself.
     */
    clearanceOverlapException?: "target-clearance";
}

export interface FurnitureCatalogSource {
    /** Content-addressed designer drawing used for body/clearance geometry. */
    drawing: {
        file: "Мебель набор-Лист1.pdf";
        sha256: "a51f5e4b64b615c0ba2df4ee3532241022ac7a4fa3c27a8850904f16c5f3627d";
    };
    /** Content-addressed designer rules used for placement and relations. */
    rules: {
        file: "Нюансы мебелт.docx";
        sha256: "e5c4545cbc94266fa095978edc80dd61599367fab05db31b000399b6b57dc45a";
    };
    /** A source revision changes whenever either content hash changes. */
    versionPolicy: "sha256-content-addressed";
}

/**
 * A transparent starter model for common furniture where no designer drawing
 * or approved image has been supplied yet. It is deliberately kept separate
 * from designer-sourced geometry so exports and the UI cannot present a
 * default size as an approved product model.
 */
export interface SchematicFurnitureCatalogSource {
    kind: "schematic-default";
    version: "2026-08-10-v1";
    note: "Типовой размер для подбора габаритов; перед покупкой требуется сверка с фактической моделью.";
}

export type FurnitureDefinitionSource = FurnitureCatalogSource | SchematicFurnitureCatalogSource;

export interface FurnitureDefinition {
    id: string;
    label: string;
    shortLabel: string;
    category: FurnitureCategory;
    body: FurnitureShape;
    clearanceZones: ClearanceZone[];
    rotations: Rotation[];
    /** Rotation groups that are visually and geometrically interchangeable. */
    equivalentRotationGroups: Rotation[][];
    placement: {
        centerAllowed: boolean;
        requiredWallContact: boolean;
        /** Every non-dotted body edge that may touch a wall. */
        allowedWallContactEdges: FurnitureBodyEdge[];
        windowPolicy: "allowed" | "forbidden" | "preferred";
        curtainBuffer: CurtainBufferPolicy;
        /**
         * Furniture-specific exclusion envelope around a window. This is kept
         * separate from the curtain allowance so approved product rules do not
         * leak into generic geometry constants.
         */
        windowExclusionDistance: number;
    };
    relations: RelationTemplate[];
    maxCount: number;
    removalPriority: number;
    /** Omitted for deliberately schematic items with no invented image. */
    assetKey?: FurnitureAssetKey;
    visualKind: "wood" | "fabric" | "screen" | "surface" | "nursery";
    source: FurnitureDefinitionSource;
}

export interface FurnitureInstance {
    instanceId: string;
    definitionId: string;
    priority: FurniturePriority;
    /** @deprecated Compatibility mirror. Use `priority` for solver policy. */
    required: boolean;
}

export type RemovalMethod = "automatic" | "manual";

/**
 * Auditable record of an item that was deliberately removed from a project.
 * The record is independent from the current layout so it can be persisted,
 * exported and reconciled when placement history is undone or redone.
 */
export interface RemovalRecord {
    instanceId: string;
    definitionId: string;
    /** Priority at the moment the removal was confirmed. */
    priority?: FurniturePriority;
    method: RemovalMethod;
    reason: string;
    removedAt: string;
}

export interface FurnitureSelectionItem {
    count: number;
    required: boolean;
    /** Legacy callers may omit this; the catalog builder derives a safe default. */
    priority?: FurniturePriority;
}

export type FurnitureSelection = Record<string, FurnitureSelectionItem | undefined>;

export interface Placement {
    instanceId: string;
    definitionId: string;
    x: number;
    y: number;
    rotation: Rotation;
    /** Optional dimensions in the unrotated furniture frame. */
    width?: number;
    depth?: number;
    photoId?: string;
}

export interface DoorOpening {
    id: string;
    /** DrawRoom ownership anchor: a stable wall ID in the connected building. */
    drawingHostId?: string;
    wall: Wall;
    /** Required for orthogonal rooms; optional for legacy rectangular drafts. */
    segmentId?: string;
    /** A door can also be cut into a stored internal partition. */
    partitionId?: string;
    offset: number;
    width: number;
    clearanceDepth: number;
    /** Present only for a hinged door. */
    hinge?: "start" | "end";
    /** Missing in an older draft means the hinged door opens into the room. */
    swingDirection?: "inward" | "outward";
    /**
     * "room" is the backwards-compatible single-leaf hinged door. Every
     * value is a physical aperture in the linked wall/partition; only the
     * hinged variants have a swing sector and hinges.
     */
    doorKind?: DoorKind;
    slidingMount?: "inward" | "outward" | "pocket";
    slidingDirection?: "start" | "end";
}

export type DoorKind = "room" | "balcony" | "swing-double" | "sliding-single" | "sliding-double";

export interface WindowOpening {
    id: string;
    /** DrawRoom ownership anchor: a stable wall ID in the connected building. */
    drawingHostId?: string;
    wall: Wall;
    /** Required for orthogonal rooms; optional for legacy rectangular drafts. */
    segmentId?: string;
    offset: number;
    width: number;
    /** Missing in an older draft means an ordinary window with a sill. */
    windowKind?: "standard" | "floor-to-ceiling";
}

export interface RadiatorObstacle {
    id: string;
    wall: Wall;
    /** Required for orthogonal rooms; optional for legacy rectangular drafts. */
    segmentId?: string;
    offset: number;
    width: number;
    depth: number;
    clearanceDepth: number;
}

/** A user name attached to a stable, derived region geometry signature. */
/** What a room is used for; it decides which furniture is offered first. */
export type RoomKind =
    | "bedroom"
    | "living"
    | "kitchen"
    | "children"
    | "office"
    | "hallway"
    | "bathroom"
    | "other";

export interface RoomRegionMetadata {
    signature: string;
    name: string;
    kind?: RoomKind;
}

/**
 * Draw Room owns this optional block. It is intentionally metadata rather
 * than planner geometry: older room drafts remain valid and a malformed name
 * can be discarded without throwing away walls, openings or furniture work.
 */
export interface RoomRegionsState {
    version: 1;
    items: RoomRegionMetadata[];
}

export interface Room {
    width: number;
    depth: number;
    /**
     * Physical exterior wall thickness used to derive this DrawRoom contour.
     * Missing data predates the constructive editor and remains a 50 mm wall.
     */
    wallThickness?: 50 | 100;
    /** Missing means the backwards-compatible rectangular geometry. */
    geometry?: RoomGeometry;
    /** Omitted by legacy callers and normalized to an empty list. */
    partitions?: RoomPartition[];
    doors: DoorOpening[];
    windows: WindowOpening[];
    /** Omitted by legacy callers and normalized to an empty list. */
    radiators?: RadiatorObstacle[];
    /** Optional named regions derived from the physical wall graph. */
    regions?: RoomRegionsState;
}

export interface LayoutPreferences {
    tvTargetCategory?: "sleep" | "living";
}

export type ValidationCode =
    | "outside-room"
    | "clearance-outside-room"
    | "door-blocked"
    | "partition-blocked"
    | "radiator-blocked"
    | "body-overlap"
    | "clearance-blocked"
    | "alternative-clearance-blocked"
    | "wall-contact"
    | "window-blocked"
    | "relation-broken"
    | "access-door-too-narrow"
    | "access-path-blocked";

export interface ValidationIssue {
    code: ValidationCode;
    message: string;
    instanceIds: string[];
}

export interface LayoutSuccess {
    status: "success";
    placements: Placement[];
    exploredNodes: number;
    score: number;
    notes: string[];
}

/**
 * The default planner mode: place every requested item without conflicts
 * before considering any visual composition.
 */
export type LayoutVariantProfileId =
    | "fit-all"
    | "balanced"
    | "daylight"
    | "open-center"
    | "perimeter"
    | "long-wall"
    | "zoned";

export interface LayoutVariantProfile {
    id: LayoutVariantProfileId;
    label: string;
    windowPreferredItems: number;
    perimeterItems: number;
    centerClearance: number;
}

export interface LayoutVariant extends LayoutSuccess {
    variantId: string;
    profile: LayoutVariantProfile;
}

export interface LayoutVariantsSuccess {
    status: "success";
    variants: LayoutVariant[];
    exploredNodes: number;
    notes: string[];
}

export interface LayoutFailure {
    status: "failure";
    placements: Placement[];
    exploredNodes: number;
    blockingInstanceIds: string[];
    reason:
        | "invalid-room"
        | "invalid-request"
        | "access-unverified"
        | "proven-impossible"
        | "search-exhausted";
    message: string;
}

export type LayoutResult = LayoutSuccess | LayoutFailure;

export interface LayoutVariantsFailure extends LayoutFailure {
    variants: [];
}

export type LayoutVariantsResult = LayoutVariantsSuccess | LayoutVariantsFailure;

export interface AutoRemovalResult {
    result: LayoutResult;
    removedInstances: FurnitureInstance[];
}

/**
 * A usable base layout for required furniture when the full requested set
 * cannot be placed in one quick calculation. Nothing is removed from the
 * project; unplaced items remain selected and are reported to the user.
 */
export interface PreferredPlacementFallbackResult {
    result: LayoutResult;
    unplacedInstances: FurnitureInstance[];
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}

export interface RotatedGeometry {
    bodyRects: Rect[];
    /** All zones, retained for plan rendering and catalog inspection. */
    clearanceRects: ClearanceZone[];
    hardClearanceRects: ClearanceZone[];
    /** Alternative access zones: at least one must remain free. */
    alternativeClearanceRects: ClearanceZone[];
    preferredClearanceRects: ClearanceZone[];
    width: number;
    depth: number;
}
