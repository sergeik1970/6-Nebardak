import { getFurniture } from "./catalog";
import {
    ClearanceZone,
    DoorOpening,
    FurnitureDefinition,
    LayoutPreferences,
    Placement,
    RadiatorObstacle,
    Rect,
    Room,
    RotatedGeometry,
    Rotation,
    ValidationIssue,
    ValidationResult,
    Wall,
} from "./types";

export const GRID_SIZE = 50;
export const DEFAULT_BODY_GAP = 50;
export const TV_VIEWING_GAP = 1400;
/** One placement grid step on either side of the 1400 mm living-room target. */
export const TV_VIEWING_GAP_TOLERANCE = GRID_SIZE;

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
): RotatedGeometry => {
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
        };
    });
    const bodyBounds = getBounds(bodyRects);

    return {
        bodyRects,
        clearanceRects,
        width: bodyBounds.width,
        depth: bodyBounds.depth,
    };
};

const toWorldRect = (rect: Rect, placement: Placement): Rect => ({
    ...rect,
    x: rect.x + placement.x,
    y: rect.y + placement.y,
});

export const getWorldBodyRects = (placement: Placement): Rect[] => {
    const geometry = getRotatedGeometry(getFurniture(placement.definitionId), placement.rotation);

    return geometry.bodyRects.map((rect) => toWorldRect(rect, placement));
};

export const getWorldClearanceRects = (placement: Placement): ClearanceZone[] => {
    const geometry = getRotatedGeometry(getFurniture(placement.definitionId), placement.rotation);

    return geometry.clearanceRects.map((rect) => ({
        ...toWorldRect(rect, placement),
        label: rect.label,
    }));
};

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
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= room.width &&
    rect.y + rect.depth <= room.depth;

export const getDoorObstacle = (door: DoorOpening, room: Room): Rect => {
    const clearanceDepth = Math.max(door.width, door.clearanceDepth);

    switch (door.wall) {
        case "top":
            return {
                x: door.offset,
                y: 0,
                width: door.width,
                depth: clearanceDepth,
            };
        case "right":
            return {
                x: room.width - clearanceDepth,
                y: door.offset,
                width: clearanceDepth,
                depth: door.width,
            };
        case "bottom":
            return {
                x: door.offset,
                y: room.depth - clearanceDepth,
                width: door.width,
                depth: clearanceDepth,
            };
        case "left":
            return {
                x: 0,
                y: door.offset,
                width: clearanceDepth,
                depth: door.width,
            };
    }
};

export const getRadiatorBody = (radiator: RadiatorObstacle, room: Room): Rect => {
    switch (radiator.wall) {
        case "top":
            return { x: radiator.offset, y: 0, width: radiator.width, depth: radiator.depth };
        case "right":
            return {
                x: room.width - radiator.depth,
                y: radiator.offset,
                width: radiator.depth,
                depth: radiator.width,
            };
        case "bottom":
            return {
                x: radiator.offset,
                y: room.depth - radiator.depth,
                width: radiator.width,
                depth: radiator.depth,
            };
        case "left":
            return { x: 0, y: radiator.offset, width: radiator.depth, depth: radiator.width };
    }
};

export const getRadiatorServiceObstacle = (radiator: RadiatorObstacle, room: Room): Rect => {
    switch (radiator.wall) {
        case "top":
            return {
                x: radiator.offset,
                y: radiator.depth,
                width: radiator.width,
                depth: radiator.clearanceDepth,
            };
        case "right":
            return {
                x: room.width - radiator.depth - radiator.clearanceDepth,
                y: radiator.offset,
                width: radiator.clearanceDepth,
                depth: radiator.width,
            };
        case "bottom":
            return {
                x: radiator.offset,
                y: room.depth - radiator.depth - radiator.clearanceDepth,
                width: radiator.width,
                depth: radiator.clearanceDepth,
            };
        case "left":
            return {
                x: radiator.depth,
                y: radiator.offset,
                width: radiator.clearanceDepth,
                depth: radiator.width,
            };
    }
};

const wallLength = (room: Room, wall: Wall): number =>
    wall === "top" || wall === "bottom" ? room.width : room.depth;

const perpendicularRoomLength = (room: Room, wall: Wall): number =>
    wall === "top" || wall === "bottom" ? room.depth : room.width;

interface WallSegment {
    wall: Wall;
    offset: number;
    width: number;
}

const wallSegmentsOverlap = (first: WallSegment, second: WallSegment): boolean =>
    first.wall === second.wall &&
    first.offset < second.offset + second.width &&
    first.offset + first.width > second.offset;

const listHasWallOverlap = (segments: WallSegment[]): boolean =>
    segments.some((segment, index) =>
        segments.slice(index + 1).some((candidate) => wallSegmentsOverlap(segment, candidate)),
    );

const listsHaveWallOverlap = (first: WallSegment[], second: WallSegment[]): boolean =>
    first.some((segment) => second.some((candidate) => wallSegmentsOverlap(segment, candidate)));

export const validateRoomGeometry = (room: Room): string | null => {
    if (
        !Number.isFinite(room.width) ||
        !Number.isFinite(room.depth) ||
        room.width < 2400 ||
        room.depth < 2400 ||
        room.width > 10_000 ||
        room.depth > 10_000
    ) {
        return "Проверьте размеры комнаты: допустимый диапазон — от 2400 до 10 000 мм.";
    }

    const invalidDoor = room.doors.some(
        (door) =>
            !Number.isFinite(door.offset) ||
            !Number.isFinite(door.width) ||
            !Number.isFinite(door.clearanceDepth) ||
            door.offset < 0 ||
            door.width <= 0 ||
            door.offset + door.width > wallLength(room, door.wall) ||
            door.clearanceDepth <= 0 ||
            door.clearanceDepth > perpendicularRoomLength(room, door.wall) ||
            door.width > perpendicularRoomLength(room, door.wall) ||
            (door.hinge !== undefined && door.hinge !== "start" && door.hinge !== "end"),
    );

    if (invalidDoor) {
        return "Проверьте дверь: размеры, смещение и зона открывания должны находиться внутри комнаты.";
    }

    const invalidWindow = room.windows.some(
        (window) =>
            !Number.isFinite(window.offset) ||
            !Number.isFinite(window.width) ||
            window.offset < 0 ||
            window.width <= 0 ||
            window.offset + window.width > wallLength(room, window.wall),
    );

    if (invalidWindow) {
        return "Проверьте окно: ширина и смещение должны находиться в пределах выбранной стены.";
    }

    const invalidRadiator = (room.radiators ?? []).some(
        (radiator) =>
            !Number.isFinite(radiator.offset) ||
            !Number.isFinite(radiator.width) ||
            !Number.isFinite(radiator.depth) ||
            !Number.isFinite(radiator.clearanceDepth) ||
            radiator.offset < 0 ||
            radiator.width <= 0 ||
            radiator.offset + radiator.width > wallLength(room, radiator.wall) ||
            radiator.depth <= 0 ||
            radiator.clearanceDepth < 0 ||
            radiator.depth + radiator.clearanceDepth > perpendicularRoomLength(room, radiator.wall),
    );

    if (invalidRadiator) {
        return "Проверьте радиатор: корпус и сервисная зона должны находиться внутри комнаты.";
    }

    const radiators = room.radiators ?? [];

    if (listHasWallOverlap(room.doors)) {
        return "Двери на одной стене не должны пересекаться.";
    }

    if (listHasWallOverlap(room.windows)) {
        return "Окна на одной стене не должны пересекаться.";
    }

    if (listHasWallOverlap(radiators)) {
        return "Радиаторы на одной стене не должны пересекаться.";
    }

    if (listsHaveWallOverlap(room.doors, room.windows)) {
        return "Дверь и окно не могут занимать один участок стены.";
    }

    if (listsHaveWallOverlap(room.doors, radiators)) {
        return "Дверь и радиатор не могут занимать один участок стены.";
    }

    return null;
};

export const wallForBack = (rotation: Rotation): Wall => {
    switch (rotation) {
        case 90:
            return "right";
        case 180:
            return "bottom";
        case 270:
            return "left";
        default:
            return "top";
    }
};

const placementTouchesBackWall = (
    placement: Placement,
    geometry: RotatedGeometry,
    room: Room,
): boolean => {
    const wall = wallForBack(placement.rotation);

    switch (wall) {
        case "top":
            return placement.y === 0;
        case "right":
            return placement.x + geometry.width === room.width;
        case "bottom":
            return placement.y + geometry.depth === room.depth;
        case "left":
            return placement.x === 0;
    }
};

const intervalsOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    aStart < bEnd && aEnd > bStart;

const placementBlocksWindow = (
    placement: Placement,
    geometry: RotatedGeometry,
    room: Room,
): boolean => {
    const definition = getFurniture(placement.definitionId);

    if (definition.placement.windowPolicy !== "forbidden") {
        return false;
    }

    const wall = wallForBack(placement.rotation);

    if (!placementTouchesBackWall(placement, geometry, room)) {
        return false;
    }

    return room.windows.some((window) => {
        if (window.wall !== wall) return false;

        if (wall === "top" || wall === "bottom") {
            return intervalsOverlap(
                placement.x,
                placement.x + geometry.width,
                window.offset,
                window.offset + window.width,
            );
        }

        return intervalsOverlap(
            placement.y,
            placement.y + geometry.depth,
            window.offset,
            window.offset + window.width,
        );
    });
};

const roomIssues = (placement: Placement, room: Room): ValidationIssue[] => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation);
    const bodyRects = geometry.bodyRects.map((rect) => toWorldRect(rect, placement));
    const clearanceRects = geometry.clearanceRects.map((rect) => toWorldRect(rect, placement));
    const issues: ValidationIssue[] = [];

    if (bodyRects.some((rect) => !rectInsideRoom(rect, room))) {
        issues.push({
            code: "outside-room",
            message: `${definition.shortLabel}: корпус выходит за границы комнаты.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (clearanceRects.some((rect) => !rectInsideRoom(rect, room))) {
        issues.push({
            code: "clearance-outside-room",
            message: `${definition.shortLabel}: не хватает места для прохода или использования.`,
            instanceIds: [placement.instanceId],
        });
    }

    const doorObstacles = room.doors.map((door) => getDoorObstacle(door, room));

    if (
        [...bodyRects, ...clearanceRects].some((rect) =>
            doorObstacles.some((obstacle) => rectsIntersect(rect, obstacle)),
        )
    ) {
        issues.push({
            code: "door-blocked",
            message: `${definition.shortLabel}: предмет или его зона перекрывает дверь.`,
            instanceIds: [placement.instanceId],
        });
    }

    const radiatorBodies = (room.radiators ?? []).map((radiator) =>
        getRadiatorBody(radiator, room),
    );
    const radiatorServiceObstacles = (room.radiators ?? []).map((radiator) =>
        getRadiatorServiceObstacle(radiator, room),
    );
    const bodyBlocksRadiator = bodyRects.some((rect) =>
        [...radiatorBodies, ...radiatorServiceObstacles].some((obstacle) =>
            rectsIntersect(rect, obstacle),
        ),
    );
    const clearanceBlocksRadiatorBody = clearanceRects.some((rect) =>
        radiatorBodies.some((body) => rectsIntersect(rect, body)),
    );

    if (bodyBlocksRadiator || clearanceBlocksRadiatorBody) {
        issues.push({
            code: "radiator-blocked",
            message: `${definition.shortLabel}: корпус или рабочая зона перекрывает радиатор.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (
        definition.placement.requiredWallContact &&
        !placementTouchesBackWall(placement, geometry, room)
    ) {
        issues.push({
            code: "wall-contact",
            message: `${definition.shortLabel}: задняя сторона должна прилегать к стене.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (placementBlocksWindow(placement, geometry, room)) {
        issues.push({
            code: "window-blocked",
            message: `${definition.shortLabel}: эта мебель не должна перекрывать окно.`,
            instanceIds: [placement.instanceId],
        });
    }

    return issues;
};

const pairIssues = (first: Placement, second: Placement): ValidationIssue[] => {
    const firstDefinition = getFurniture(first.definitionId);
    const secondDefinition = getFurniture(second.definitionId);
    const firstBodies = getWorldBodyRects(first);
    const secondBodies = getWorldBodyRects(second);
    const issues: ValidationIssue[] = [];

    if (
        firstBodies.some((firstRect) =>
            secondBodies.some((secondRect) =>
                rectsIntersect(expandRect(firstRect, DEFAULT_BODY_GAP), secondRect),
            ),
        )
    ) {
        issues.push({
            code: "body-overlap",
            message: `${firstDefinition.shortLabel} и ${secondDefinition.shortLabel}: нужен зазор не менее 50 мм.`,
            instanceIds: [first.instanceId, second.instanceId],
        });
        return issues;
    }

    const firstClearances = getWorldClearanceRects(first);
    const secondClearances = getWorldClearanceRects(second);
    const accessBlocked =
        firstBodies.some((body) =>
            secondClearances.some((clearance) => rectsIntersect(body, clearance)),
        ) ||
        secondBodies.some((body) =>
            firstClearances.some((clearance) => rectsIntersect(body, clearance)),
        );

    if (accessBlocked) {
        issues.push({
            code: "clearance-blocked",
            message: `${firstDefinition.shortLabel} и ${secondDefinition.shortLabel}: один предмет перекрывает рабочую зону другого.`,
            instanceIds: [first.instanceId, second.instanceId],
        });
    }

    return issues;
};

const intervalOverlapLength = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) => Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart);

const gapBetweenIntervals = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) => Math.max(secondStart - firstEnd, firstStart - secondEnd, 0);

const relationSatisfied = (
    placement: Placement,
    target: Placement,
    kind: "front-gap" | "adjacent" | "aligned-side",
    minGap = 0,
    maxGap = 100,
): boolean => {
    const placementBounds = getBounds(getWorldBodyRects(placement));
    const targetBounds = getBounds(getWorldBodyRects(target));
    const horizontalGap = gapBetweenIntervals(
        placementBounds.x,
        placementBounds.x + placementBounds.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalGap = gapBetweenIntervals(
        placementBounds.y,
        placementBounds.y + placementBounds.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );
    const horizontalOverlap = intervalOverlapLength(
        placementBounds.x,
        placementBounds.x + placementBounds.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalOverlap = intervalOverlapLength(
        placementBounds.y,
        placementBounds.y + placementBounds.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );

    if (kind === "adjacent" || kind === "aligned-side") {
        const horizontalSide =
            verticalOverlap > 0 && horizontalGap >= minGap && horizontalGap <= maxGap;
        const verticalSide =
            horizontalOverlap > 0 && verticalGap >= minGap && verticalGap <= maxGap;

        if (kind === "adjacent") return horizontalSide || verticalSide;

        const horizontallyAligned =
            horizontalSide &&
            (Math.abs(placementBounds.y - targetBounds.y) <= GRID_SIZE ||
                Math.abs(
                    placementBounds.y +
                        placementBounds.depth -
                        (targetBounds.y + targetBounds.depth),
                ) <= GRID_SIZE);
        const verticallyAligned =
            verticalSide &&
            (Math.abs(placementBounds.x - targetBounds.x) <= GRID_SIZE ||
                Math.abs(
                    placementBounds.x +
                        placementBounds.width -
                        (targetBounds.x + targetBounds.width),
                ) <= GRID_SIZE);

        return horizontallyAligned || verticallyAligned;
    }

    switch (target.rotation) {
        case 90:
            return (
                verticalOverlap > 0 &&
                targetBounds.x - (placementBounds.x + placementBounds.width) >= minGap &&
                targetBounds.x - (placementBounds.x + placementBounds.width) <= maxGap
            );
        case 180:
            return (
                horizontalOverlap > 0 &&
                targetBounds.y - (placementBounds.y + placementBounds.depth) >= minGap &&
                targetBounds.y - (placementBounds.y + placementBounds.depth) <= maxGap
            );
        case 270:
            return (
                verticalOverlap > 0 &&
                placementBounds.x - (targetBounds.x + targetBounds.width) >= minGap &&
                placementBounds.x - (targetBounds.x + targetBounds.width) <= maxGap
            );
        default:
            return (
                horizontalOverlap > 0 &&
                placementBounds.y - (targetBounds.y + targetBounds.depth) >= minGap &&
                placementBounds.y - (targetBounds.y + targetBounds.depth) <= maxGap
            );
    }
};

const relationIssues = (placements: Placement[]): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];

    placements.forEach((placement) => {
        const definition = getFurniture(placement.definitionId);

        definition.relations.forEach((relation) => {
            if (!relation.required || relation.kind === "faces") return;

            const targets = placements.filter(
                (candidate) =>
                    candidate.instanceId !== placement.instanceId &&
                    getFurniture(candidate.definitionId).category === relation.targetCategory,
            );
            const supportedKind = relation.kind as "front-gap" | "adjacent" | "aligned-side";
            const matched = targets.some((target) =>
                relationSatisfied(
                    placement,
                    target,
                    supportedKind,
                    relation.minGap ?? 0,
                    relation.maxGap ?? (relation.kind === "front-gap" ? 450 : 100),
                ),
            );

            if (!matched) {
                issues.push({
                    code: "relation-broken",
                    message: `${definition.shortLabel}: положение не соответствует связанному предмету.`,
                    instanceIds: [placement.instanceId],
                });
            }
        });
    });

    return issues;
};

const oppositeRotation = (rotation: Rotation): Rotation => ((rotation + 180) % 360) as Rotation;

const tvTargetCategory = (
    placements: Placement[],
    preferences: LayoutPreferences,
): "sleep" | "living" | null => {
    if (preferences.tvTargetCategory) return preferences.tvTargetCategory;

    if (
        placements.some((placement) => {
            const definition = getFurniture(placement.definitionId);
            return definition.category === "living" && definition.id !== "coffee-table";
        })
    ) {
        return "living";
    }

    return placements.some((placement) => getFurniture(placement.definitionId).category === "sleep")
        ? "sleep"
        : null;
};

export const tvFacesTarget = (
    tv: Placement,
    target: Placement,
    targetCategory: "sleep" | "living",
): boolean => {
    if (tv.rotation !== oppositeRotation(target.rotation)) return false;

    const tvBounds = getBounds(getWorldBodyRects(tv));
    const targetBounds = getBounds(getWorldBodyRects(target));
    const horizontalOverlap = intervalOverlapLength(
        tvBounds.x,
        tvBounds.x + tvBounds.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalOverlap = intervalOverlapLength(
        tvBounds.y,
        tvBounds.y + tvBounds.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );
    let aligned = false;
    let gap = 0;

    switch (tv.rotation) {
        case 90:
            aligned = verticalOverlap > 0;
            gap = tvBounds.x - (targetBounds.x + targetBounds.width);
            break;
        case 180:
            aligned = horizontalOverlap > 0;
            gap = tvBounds.y - (targetBounds.y + targetBounds.depth);
            break;
        case 270:
            aligned = verticalOverlap > 0;
            gap = targetBounds.x - (tvBounds.x + tvBounds.width);
            break;
        default:
            aligned = horizontalOverlap > 0;
            gap = targetBounds.y - (tvBounds.y + tvBounds.depth);
    }

    if (!aligned || gap < 0) return false;
    if (targetCategory === "sleep") return true;

    return Math.abs(gap - TV_VIEWING_GAP) <= TV_VIEWING_GAP_TOLERANCE;
};

const tvRelationIssues = (
    placements: Placement[],
    preferences: LayoutPreferences,
): ValidationIssue[] => {
    const televisions = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === "media",
    );
    if (televisions.length === 0) return [];

    const category = tvTargetCategory(placements, preferences);

    return televisions.flatMap((television): ValidationIssue[] => {
        const targets = category
            ? placements.filter((placement) => {
                  const definition = getFurniture(placement.definitionId);
                  return (
                      placement.instanceId !== television.instanceId &&
                      definition.category === category &&
                      (category !== "living" || definition.id !== "coffee-table")
                  );
              })
            : [];

        if (!category || targets.length === 0) {
            return [
                {
                    code: "relation-broken",
                    message:
                        "ТВ: не найден выбранный диван или кровать, напротив которого его нужно поставить.",
                    instanceIds: [television.instanceId],
                },
            ];
        }

        if (targets.some((target) => tvFacesTarget(television, target, category))) return [];

        return [
            {
                code: "relation-broken",
                message:
                    category === "living"
                        ? `ТВ должен стоять напротив дивана с расстоянием ${TV_VIEWING_GAP} ± ${TV_VIEWING_GAP_TOLERANCE} мм.`
                        : "ТВ должен стоять напротив кровати и быть выровнен по направлению взгляда.",
                instanceIds: [television.instanceId, ...targets.map((target) => target.instanceId)],
            },
        ];
    });
};

export const validatePlacement = (
    placement: Placement,
    room: Room,
    existingPlacements: Placement[],
): ValidationResult => {
    const issues = [
        ...roomIssues(placement, room),
        ...existingPlacements.flatMap((existing) => pairIssues(placement, existing)),
    ];

    return { valid: issues.length === 0, issues };
};

export const validateLayout = (
    room: Room,
    placements: Placement[],
    preferences: LayoutPreferences = {},
): ValidationResult => {
    const issues: ValidationIssue[] = placements.flatMap((placement) =>
        roomIssues(placement, room),
    );

    for (let firstIndex = 0; firstIndex < placements.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex += 1) {
            issues.push(...pairIssues(placements[firstIndex], placements[secondIndex]));
        }
    }

    issues.push(...relationIssues(placements));
    issues.push(...tvRelationIssues(placements, preferences));

    return { valid: issues.length === 0, issues };
};

export const snapToGrid = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE;
