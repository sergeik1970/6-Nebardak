import { getFurniture } from "./catalog";
import {
    ClearanceZone,
    FurnitureDefinition,
    Placement,
    Rect,
    RelationKind,
    RelationTemplate,
    Room,
    RotatedGeometry,
    Rotation,
} from "./types";
import { rectInsideRoomGeometry } from "./room-geometry";

export const DEFAULT_BODY_GAP = 50;

type GapRelationKind = Exclude<RelationKind, "faces">;

const DEFAULT_RELATION_GAP_RANGES: Record<
    GapRelationKind,
    { minimumGap: number; maximumGap: number }
> = {
    "front-gap": { minimumGap: 350, maximumGap: 450 },
    adjacent: { minimumGap: DEFAULT_BODY_GAP, maximumGap: 100 },
    "aligned-side": { minimumGap: DEFAULT_BODY_GAP, maximumGap: 100 },
};

/** One source of truth for optional relation bounds used by both core paths. */
export const resolveRelationGapRange = (
    relation: Pick<RelationTemplate, "kind" | "minGap" | "maxGap"> & {
        kind: GapRelationKind;
    },
): { minimumGap: number; maximumGap: number } => {
    const defaults = DEFAULT_RELATION_GAP_RANGES[relation.kind];

    return {
        minimumGap: relation.minGap ?? defaults.minimumGap,
        maximumGap: relation.maxGap ?? defaults.maximumGap,
    };
};

const rotatePoint = (x: number, y: number, rotation: Rotation) => {
    switch (rotation) {
        case 90:
            return { x: -y, y: x };
        case 180:
            return { x: -x, y: -y };
        case 270:
            return { x: y, y: -x };
        default:
            return { x, y };
    }
};

const rotateRectRaw = (rect: Rect, rotation: Rotation): Rect => {
    const points = [
        rotatePoint(rect.x, rect.y, rotation),
        rotatePoint(rect.x + rect.width, rect.y, rotation),
        rotatePoint(rect.x + rect.width, rect.y + rect.depth, rotation),
        rotatePoint(rect.x, rect.y + rect.depth, rotation),
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        depth: maxY - minY,
    };
};

export const getBounds = (rects: Rect[]): Rect => {
    if (rects.length === 0) {
        return { x: 0, y: 0, width: 0, depth: 0 };
    }

    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.depth));

    return { x: minX, y: minY, width: maxX - minX, depth: maxY - minY };
};

export const getRotatedGeometry = (
    definition: FurnitureDefinition,
    rotation: Rotation,
    size?: Pick<Placement, "width" | "depth">,
): RotatedGeometry => {
    if (size?.width !== undefined && size.depth !== undefined) {
        const bounds = getBounds(definition.body.rects);
        const resize = (value: number, before: number, after: number) =>
            value < 0 ? value : value > before ? after + value - before : (value * after) / before;
        const resizeRect = <T extends Rect>(rect: T): T => ({
            ...rect,
            x: resize(rect.x, bounds.width, size.width!),
            y: resize(rect.y, bounds.depth, size.depth!),
            width:
                resize(rect.x + rect.width, bounds.width, size.width!) -
                resize(rect.x, bounds.width, size.width!),
            depth:
                resize(rect.y + rect.depth, bounds.depth, size.depth!) -
                resize(rect.y, bounds.depth, size.depth!),
        });
        definition = {
            ...definition,
            body: { ...definition.body, rects: definition.body.rects.map(resizeRect) },
            clearanceZones: definition.clearanceZones.map(resizeRect),
        };
    }
    const rawBodyRects = definition.body.rects.map((rect) => rotateRectRaw(rect, rotation));
    const rawBodyBounds = getBounds(rawBodyRects);
    const shiftX = -rawBodyBounds.x;
    const shiftY = -rawBodyBounds.y;
    const bodyRects = rawBodyRects.map((rect) => ({
        ...rect,
        x: rect.x + shiftX,
        y: rect.y + shiftY,
    }));
    const clearanceRects = definition.clearanceZones.map((zone): ClearanceZone => {
        const rotated = rotateRectRaw(zone, rotation);

        return {
            ...rotated,
            x: rotated.x + shiftX,
            y: rotated.y + shiftY,
            label: zone.label,
            requirement: zone.requirement,
        };
    });
    const bodyBounds = getBounds(bodyRects);

    return {
        bodyRects,
        clearanceRects,
        hardClearanceRects: clearanceRects.filter((zone) => zone.requirement === "hard"),
        alternativeClearanceRects: clearanceRects.filter((zone) => zone.requirement === "one-of"),
        preferredClearanceRects: clearanceRects.filter((zone) => zone.requirement === "preferred"),
        width: bodyBounds.width,
        depth: bodyBounds.depth,
    };
};

export const toWorldRect = (rect: Rect, placement: Placement): Rect => ({
    ...rect,
    x: rect.x + placement.x,
    y: rect.y + placement.y,
});

export const getWorldBodyRects = (placement: Placement): Rect[] => {
    const geometry = getRotatedGeometry(
        getFurniture(placement.definitionId),
        placement.rotation,
        placement,
    );

    return geometry.bodyRects.map((rect) => toWorldRect(rect, placement));
};

const getWorldClearanceRectsByRequirement = (
    placement: Placement,
    requirement?: ClearanceZone["requirement"],
): ClearanceZone[] => {
    const geometry = getRotatedGeometry(
        getFurniture(placement.definitionId),
        placement.rotation,
        placement,
    );

    return geometry.clearanceRects
        .filter((rect) => requirement === undefined || rect.requirement === requirement)
        .map((rect) => ({
            ...toWorldRect(rect, placement),
            label: rect.label,
            requirement: rect.requirement,
        }));
};

/** All zones are returned for the optional plan overlay. */
export const getWorldClearanceRects = (placement: Placement): ClearanceZone[] =>
    getWorldClearanceRectsByRequirement(placement);

/** Only hard zones may make a placement invalid. */
export const getWorldHardClearanceRects = (placement: Placement): ClearanceZone[] =>
    getWorldClearanceRectsByRequirement(placement, "hard");

/** At least one alternative access zone must remain free. */
export const getWorldAlternativeClearanceRects = (placement: Placement): ClearanceZone[] =>
    getWorldClearanceRectsByRequirement(placement, "one-of");

/** Preferred zones affect ranking and explanatory notes, never validity. */
export const getWorldPreferredClearanceRects = (placement: Placement): ClearanceZone[] =>
    getWorldClearanceRectsByRequirement(placement, "preferred");

export const rectsIntersect = (first: Rect, second: Rect): boolean =>
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.depth &&
    first.y + first.depth > second.y;

export const expandRect = (rect: Rect, amount: number): Rect => ({
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    depth: rect.depth + amount * 2,
});

export const rectInsideRoom = (rect: Rect, room: Room): boolean =>
    rectInsideRoomGeometry(rect, room);
