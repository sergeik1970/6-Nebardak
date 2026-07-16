export type Rotation = 0 | 90 | 180 | 270;

export type Wall = "top" | "right" | "bottom" | "left";

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

export interface ClearanceZone extends Rect {
    label: string;
}

export type RelationKind = "front-gap" | "adjacent" | "aligned-side" | "faces";

export interface RelationTemplate {
    kind: RelationKind;
    targetCategory: FurnitureCategory;
    required: boolean;
    minGap?: number;
    maxGap?: number;
}

export interface FurnitureDefinition {
    id: string;
    label: string;
    shortLabel: string;
    category: FurnitureCategory;
    body: FurnitureShape;
    clearanceZones: ClearanceZone[];
    rotations: Rotation[];
    placement: {
        centerAllowed: boolean;
        requiredWallContact: boolean;
        wallSide: "back";
        windowPolicy: "allowed" | "forbidden" | "preferred";
    };
    relations: RelationTemplate[];
    removalPriority: number;
    assetKey: FurnitureAssetKey;
    visualKind: "wood" | "fabric" | "screen" | "surface" | "nursery";
}

export interface FurnitureInstance {
    instanceId: string;
    definitionId: string;
    required: boolean;
}

export interface FurnitureSelectionItem {
    count: number;
    required: boolean;
}

export type FurnitureSelection = Record<string, FurnitureSelectionItem | undefined>;

export interface Placement {
    instanceId: string;
    definitionId: string;
    x: number;
    y: number;
    rotation: Rotation;
}

export interface DoorOpening {
    id: string;
    wall: Wall;
    offset: number;
    width: number;
    clearanceDepth: number;
    hinge?: "start" | "end";
}

export interface WindowOpening {
    id: string;
    wall: Wall;
    offset: number;
    width: number;
}

export interface RadiatorObstacle {
    id: string;
    wall: Wall;
    offset: number;
    width: number;
    depth: number;
    clearanceDepth: number;
}

export interface Room {
    width: number;
    depth: number;
    doors: DoorOpening[];
    windows: WindowOpening[];
    /** Omitted by legacy callers and normalized to an empty list. */
    radiators?: RadiatorObstacle[];
}

export interface LayoutPreferences {
    tvTargetCategory?: "sleep" | "living";
}

export type ValidationCode =
    | "outside-room"
    | "clearance-outside-room"
    | "door-blocked"
    | "radiator-blocked"
    | "body-overlap"
    | "clearance-blocked"
    | "wall-contact"
    | "window-blocked"
    | "relation-broken";

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

export type LayoutVariantProfileId = "balanced" | "daylight" | "open-center" | "perimeter";

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
    reason: "invalid-room" | "no-layout" | "search-limit";
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

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}

export interface RotatedGeometry {
    bodyRects: Rect[];
    clearanceRects: ClearanceZone[];
    width: number;
    depth: number;
}
