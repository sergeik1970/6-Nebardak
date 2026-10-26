import {
    DRESSER_WINDOW_EXCLUSION_MM,
    PROVISIONAL_CURTAIN_BUFFER_MM,
    getFurniture,
    getViewingDistanceRange,
    isSchematicFurnitureSource,
    relationTargetsDefinition,
} from "./catalog";
import {
    ACCESS_PATH_CELL_ENVELOPE,
    DEFAULT_BODY_GAP,
    GRID_SIZE,
    MIN_CONNECTED_PASSAGE_WIDTH,
    analyzeConnectedAccess,
    getBounds,
    getDoorObstacle,
    getFixedFurnitureBodies,
    getPartitionObstacleRects,
    getPreferredClearanceSummary,
    getRadiatorBody,
    getRadiatorServiceObstacle,
    getRotatedGeometry,
    getWorldBodyRects,
    getWorldHardClearanceRects,
    getWindowCurtainObstacle,
    getTrustedAccessDoorError,
    relationSatisfied,
    resolveRelationGapRange,
    snapToGrid,
    tvFacesTarget,
    validateLayout,
    validatePlacement,
    validateRoomGeometry,
    wallForBack,
    wallForBodyEdge,
} from "./geometry";
import {
    NOTICEABLE_VARIANT_TOLERANCE_MM,
    areLayoutsNoticeablyDifferent,
    areLayoutsStructurallyDifferent,
    getCanonicalRotation,
    getLayoutStructureSignature,
    getSemanticLayoutSignature,
} from "./layout-identity";
import {
    canonicalRoomGeometry,
    getRoomBoundarySegments,
    getRoomCentroid,
    getRoomSegment,
    getSegmentSpanRect,
    rectTouchesRoomBoundary,
} from "./room-geometry";
export {
    NOTICEABLE_VARIANT_TOLERANCE_MM,
    areLayoutsNoticeablyDifferent,
    areLayoutsStructurallyDifferent,
    getCanonicalRotation,
    getLayoutStructureSignature,
    getSemanticLayoutSignature,
} from "./layout-identity";
import {
    AutoRemovalResult,
    FurnitureDefinition,
    FurnitureInstance,
    LayoutFailure,
    LayoutPreferences,
    LayoutResult,
    LayoutSuccess,
    LayoutVariant,
    LayoutVariantProfile,
    LayoutVariantProfileId,
    LayoutVariantsResult,
    Placement,
    PreferredPlacementFallbackResult,
    Rect,
    RelationTemplate,
    Room,
    Rotation,
    Wall,
} from "./types";

const MAX_SEARCH_NODES = 45_000;
const MAX_VARIANT_SEARCH_NODES = 90_000;
const MAX_REMOVAL_COMBINATION_CHECKS = 256;
const MAX_PREFERRED_FALLBACK_NODES = 120_000;
const MAX_PREFERRED_FALLBACK_ATTEMPT_NODES = 20_000;
const MAX_PREFERRED_DIRECT_CANDIDATES = 6_000;
/** Maximum perpendicular distance from an item's back edge to its matching window wall. */
export const WINDOW_PROXIMITY_THRESHOLD = 600;
const SUPPORTED_RELATIONS = new Set(["front-gap", "adjacent", "aligned-side"]);

export interface SolverSearchOptions {
    /** Allows callers and tests to impose a stricter budget than the production default. */
    maxSearchNodes?: number;
    /** Bounds combinatorial removal proposals independently from layout nodes. */
    maxRemovalCombinationChecks?: number;
    /** Total layout nodes available across all candidate removal sets. */
    maxRemovalSearchNodes?: number;
    /**
     * Optional operational/diagnostic cap for each required-relation stream.
     * Hitting it always yields search-exhausted, never proven-impossible.
     */
    maxRelationCandidates?: number;
}

const canonicalRotations = (definition: FurnitureDefinition): Rotation[] => {
    const seen = new Set<Rotation>();

    return definition.rotations.filter((rotation) => {
        const canonical = getCanonicalRotation(definition.id, rotation);
        if (seen.has(canonical)) return false;
        seen.add(canonical);
        return true;
    });
};

const bodyArea = (definition: FurnitureDefinition): number =>
    definition.body.rects.reduce((sum, rect) => sum + rect.width * rect.depth, 0);

const LIVING_TV_TARGET_IDS = new Set(["sofa-two", "sofa-three", "sofa-four-left"]);

const isTvTargetDefinition = (
    definition: FurnitureDefinition,
    category: "sleep" | "living",
): boolean =>
    category === "living"
        ? LIVING_TV_TARGET_IDS.has(definition.id)
        : definition.category === "sleep";

const hasRequiredDependency = (definition: FurnitureDefinition): boolean =>
    definition.category === "media" ||
    definition.relations.some(
        (relation) => relation.required && SUPPORTED_RELATIONS.has(relation.kind),
    );

export type FunctionalBlockKind = "living" | "sleep" | "work";

export interface FunctionalBlockPlan {
    id: string;
    kind: FunctionalBlockKind;
    anchorInstanceId: string;
    memberInstanceIds: string[];
}

const orderInstances = (
    instances: FurnitureInstance[],
    preferences: LayoutPreferences,
    profileId: LayoutVariantProfileId,
): FurnitureInstance[] => {
    // Packing must not privilege a visual composition over a feasible layout.
    // Required geometric dependencies are still handled below and during
    // candidate generation, but soft living/sleep/work blocks must not decide
    // which items claim the room first.
    const functionalBlocks =
        profileId === "fit-all" ? [] : getFunctionalBlocks(instances, preferences);
    const blockOrder = new Map<string, number>();
    functionalBlocks.forEach((block) => {
        blockOrder.set(block.anchorInstanceId, 0);
        block.memberInstanceIds.forEach((instanceId) => {
            if (!blockOrder.has(instanceId)) blockOrder.set(instanceId, 1);
        });
    });

    return [...instances].sort((first, second) => {
        const blockDifference =
            (blockOrder.get(first.instanceId) ?? 2) - (blockOrder.get(second.instanceId) ?? 2);
        if (blockDifference !== 0) return blockDifference;

        const firstDefinition = getFurniture(first.definitionId);
        const secondDefinition = getFurniture(second.definitionId);
        const dependencyDifference =
            Number(hasRequiredDependency(firstDefinition)) -
            Number(hasRequiredDependency(secondDefinition));

        if (dependencyDifference !== 0) return dependencyDifference;

        const wallDifference =
            Number(secondDefinition.placement.requiredWallContact) -
            Number(firstDefinition.placement.requiredWallContact);

        if (wallDifference !== 0) return wallDifference;

        const areaDifference = bodyArea(secondDefinition) - bodyArea(firstDefinition);
        if (areaDifference !== 0) return areaDifference;

        return first.instanceId.localeCompare(second.instanceId);
    });
};

const gridValues = (maximum: number): number[] => {
    if (maximum < 0) return [];

    const values: number[] = [];
    for (let value = 0; value <= maximum; value += GRID_SIZE) values.push(value);
    values.push(maximum);

    return Array.from(new Set(values.filter((value) => value >= 0 && value <= maximum)));
};

const edgeFirstValues = (maximum: number): number[] =>
    gridValues(maximum).sort(
        (first, second) =>
            Math.min(first, maximum - first) - Math.min(second, maximum - second) || first - second,
    );

const centerFirstValues = (maximum: number): number[] => {
    const center = maximum / 2;
    return gridValues(maximum).sort(
        (first, second) => Math.abs(first - center) - Math.abs(second - center) || first - second,
    );
};

interface AxisInterval {
    start: number;
    end: number;
}

interface AxisCoordinates {
    critical: number[];
    grid: number[];
}

const axisIntervals = (rects: Rect[], axis: "x" | "y"): AxisInterval[] =>
    rects.map((rect) => ({
        start: axis === "x" ? rect.x : rect.y,
        end: axis === "x" ? rect.x + rect.width : rect.y + rect.depth,
    }));

/**
 * Critical coordinates are exact integer-millimetre alignments. The complete
 * 50 mm grid remains present after them, so this function never truncates the
 * admissible coordinate set.
 */
export const getCriticalAxisCoordinates = (
    roomLength: number,
    bodyLength: number,
    localIntervals: AxisInterval[],
    obstacleIntervals: AxisInterval[],
    order: "edge" | "center",
): AxisCoordinates => {
    const maximum = roomLength - bodyLength;
    if (maximum < 0) return { critical: [], grid: [] };

    const rawCritical = [0, maximum, Math.round(maximum / 2)];

    localIntervals.forEach((local) => {
        rawCritical.push(-local.start, roomLength - local.end);

        obstacleIntervals.forEach((obstacle) => {
            [0, DEFAULT_BODY_GAP].forEach((gap) => {
                rawCritical.push(
                    obstacle.start - local.end - gap,
                    obstacle.end + gap - local.start,
                    obstacle.start - local.start,
                    obstacle.end - local.end,
                );
            });
        });
    });

    const orderValues = (values: number[]) =>
        values.sort((first, second) => {
            if (order === "center") {
                return (
                    Math.abs(first - maximum / 2) - Math.abs(second - maximum / 2) || first - second
                );
            }

            return (
                Math.min(first, maximum - first) - Math.min(second, maximum - second) ||
                first - second
            );
        });

    const critical = orderValues(
        Array.from(
            new Set(
                rawCritical
                    .filter(Number.isFinite)
                    .map(Math.round)
                    .filter((value) => value >= 0 && value <= maximum),
            ),
        ),
    );
    const criticalSet = new Set(critical);
    const allGrid = order === "center" ? centerFirstValues(maximum) : edgeFirstValues(maximum);

    return {
        critical,
        grid: allGrid.filter((value) => !criticalSet.has(value)),
    };
};

const roomObstacleRects = (room: Room): Rect[] => [
    ...room.doors.map((door) => getDoorObstacle(door, room)),
    ...getPartitionObstacleRects(room),
    ...getFixedFurnitureBodies(room),
    ...(room.fixedFurniture?.passages ?? []),
    ...room.windows.map((window) => getWindowCurtainObstacle(window, room)),
    ...(room.radiators ?? []).flatMap((radiator) => [
        getRadiatorBody(radiator, room),
        getRadiatorServiceObstacle(radiator, room),
    ]),
];

const placedObstacleRects = (placements: Placement[]): Rect[] =>
    placements.flatMap((placement) => [
        ...getWorldBodyRects(placement),
        ...getWorldHardClearanceRects(placement),
    ]);

const coordinateSets = (
    room: Room,
    geometry: ReturnType<typeof getRotatedGeometry>,
    placements: Placement[],
    axis: "x" | "y",
    order: "edge" | "center",
): AxisCoordinates => {
    const localRects = [...geometry.bodyRects, ...geometry.hardClearanceRects];
    const obstacles = [...roomObstacleRects(room), ...placedObstacleRects(placements)];
    const roomLength = axis === "x" ? room.width : room.depth;
    const bodyLength = axis === "x" ? geometry.width : geometry.depth;

    return getCriticalAxisCoordinates(
        roomLength,
        bodyLength,
        axisIntervals(localRects, axis),
        axisIntervals(obstacles, axis),
        order,
    );
};

const candidateForWall = (
    instance: FurnitureInstance,
    room: Room,
    rotation: Rotation,
    wall: Wall,
    along: number,
): Placement => {
    const geometry = getRotatedGeometry(getFurniture(instance.definitionId), rotation);

    switch (wall) {
        case "top":
            return {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                x: along,
                y: 0,
                rotation,
            };
        case "right":
            return {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                x: room.width - geometry.width,
                y: along,
                rotation,
            };
        case "bottom":
            return {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                x: along,
                y: room.depth - geometry.depth,
                rotation,
            };
        case "left":
            return {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                x: 0,
                y: along,
                rotation,
            };
    }
};

const candidateForBoundarySegment = (
    instance: FurnitureInstance,
    rotation: Rotation,
    segment: ReturnType<typeof getRoomBoundarySegments>[number],
    along: number,
): Placement => {
    const geometry = getRotatedGeometry(getFurniture(instance.definitionId), rotation);
    const tangentX = (segment.end.x - segment.start.x) / segment.length;
    const tangentY = (segment.end.y - segment.start.y) / segment.length;
    const horizontal = segment.orientation === "horizontal";
    const bodyAlong = horizontal ? geometry.width : geometry.depth;
    const alongStart = {
        x: segment.start.x + tangentX * along,
        y: segment.start.y + tangentY * along,
    };

    return {
        instanceId: instance.instanceId,
        definitionId: instance.definitionId,
        x: horizontal
            ? tangentX > 0
                ? alongStart.x
                : alongStart.x - bodyAlong
            : segment.wall === "left"
              ? segment.start.x
              : segment.start.x - geometry.width,
        y: horizontal
            ? segment.wall === "top"
                ? segment.start.y
                : segment.start.y - geometry.depth
            : tangentY > 0
              ? alongStart.y
              : alongStart.y - bodyAlong,
        rotation,
    };
};

export const isPlacementNearPreferredWindow = (placement: Placement, room: Room): boolean => {
    const definition = getFurniture(placement.definitionId);
    if (definition.placement.windowPolicy !== "preferred") return false;

    const geometry = getRotatedGeometry(definition, placement.rotation, placement);
    const wall = wallForBack(placement.rotation);
    return room.windows.some((window) => {
        const segment = getRoomSegment(room, window);
        if (!segment || segment.wall !== wall) return false;
        const opening = getSegmentSpanRect(segment, window.offset, window.width, 0, 1);
        const perpendicularDistance = (() => {
            switch (wall) {
                case "top":
                    return placement.y - segment.start.y;
                case "right":
                    return segment.start.x - (placement.x + geometry.width);
                case "bottom":
                    return segment.start.y - (placement.y + geometry.depth);
                case "left":
                    return placement.x - segment.start.x;
            }
        })();
        if (perpendicularDistance < 0 || perpendicularDistance > WINDOW_PROXIMITY_THRESHOLD) {
            return false;
        }
        return segment.orientation === "horizontal"
            ? placement.x < opening.x + opening.width && placement.x + geometry.width > opening.x
            : placement.y < opening.y + opening.depth && placement.y + geometry.depth > opening.y;
    });
};

const windowPreferenceScore = (placement: Placement, room: Room): number =>
    isPlacementNearPreferredWindow(placement, room) ? -10_000 : 0;

function* wallCandidates(
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    profileId: LayoutVariantProfileId,
): Generator<Placement> {
    const definition = getFurniture(instance.definitionId);

    if (canonicalRoomGeometry(room).kind === "orthogonal") {
        for (const rotation of canonicalRotations(definition)) {
            const geometry = getRotatedGeometry(definition, rotation);
            for (const edge of definition.placement.allowedWallContactEdges) {
                const wall = wallForBodyEdge(rotation, edge);
                for (const segment of getRoomBoundarySegments(room).filter(
                    (candidate) => candidate.wall === wall,
                )) {
                    const bodyAlong =
                        segment.orientation === "horizontal" ? geometry.width : geometry.depth;
                    const maximum = segment.length - bodyAlong;
                    if (maximum < 0) continue;
                    const candidates = edgeFirstValues(maximum)
                        .map((along) =>
                            candidateForBoundarySegment(instance, rotation, segment, along),
                        )
                        .sort(
                            (first, second) =>
                                profileCandidateScore(first, room, profileId) -
                                    profileCandidateScore(second, room, profileId) ||
                                first.x - second.x ||
                                first.y - second.y,
                        );
                    yield* candidates;
                }
            }
        }
        return;
    }

    // Critical alignments always precede the supplemental grid. Coordinates
    // inside each small axis list may be sorted eagerly; no Cartesian product
    // is materialized.
    for (const tier of ["critical", "grid"] as const) {
        for (const rotation of canonicalRotations(definition)) {
            const geometry = getRotatedGeometry(definition, rotation);
            for (const edge of definition.placement.allowedWallContactEdges) {
                const wall = wallForBodyEdge(rotation, edge);
                const axis = wall === "top" || wall === "bottom" ? "x" : "y";
                const coordinates = coordinateSets(room, geometry, placements, axis, "edge");
                const candidates = coordinates[tier]
                    .map((along) => candidateForWall(instance, room, rotation, wall, along))
                    .sort(
                        (first, second) =>
                            profileCandidateScore(first, room, profileId) -
                                profileCandidateScore(second, room, profileId) ||
                            first.x - second.x ||
                            first.y - second.y,
                    );

                yield* candidates;
            }
        }
    }
}

function* centerCandidates(
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    profileId: LayoutVariantProfileId,
): Generator<Placement> {
    const definition = getFurniture(instance.definitionId);
    if (!definition.placement.centerAllowed) return;

    const order = profileId === "open-center" || profileId === "perimeter" ? "edge" : "center";
    const tiers = [
        ["critical", "critical"],
        ["critical", "grid"],
        ["grid", "critical"],
        ["grid", "grid"],
    ] as const;

    const rotationCoordinates = canonicalRotations(definition).map((rotation) => {
        const geometry = getRotatedGeometry(definition, rotation);
        const xValues = coordinateSets(room, geometry, placements, "x", order);
        const yValues = coordinateSets(room, geometry, placements, "y", order);

        return { rotation, xValues, yValues };
    });

    // Every canonical rotation receives critical alignments before any large
    // grid/grid tier is visited.
    for (const [xTier, yTier] of tiers) {
        for (const { rotation, xValues, yValues } of rotationCoordinates) {
            for (const x of xValues[xTier]) {
                for (const y of yValues[yTier]) {
                    yield {
                        instanceId: instance.instanceId,
                        definitionId: instance.definitionId,
                        x,
                        y,
                        rotation,
                    };
                }
            }
        }
    }
}

const oppositeRotation = (rotation: Rotation): Rotation => ((rotation + 180) % 360) as Rotation;

const resolveTvTargetCategory = (
    instances: FurnitureInstance[],
    preferences: LayoutPreferences,
): "sleep" | "living" | null => {
    if (preferences.tvTargetCategory) return preferences.tvTargetCategory;

    if (
        instances.some((instance) =>
            isTvTargetDefinition(getFurniture(instance.definitionId), "living"),
        )
    ) {
        return "living";
    }

    return instances.some((instance) =>
        isTvTargetDefinition(getFurniture(instance.definitionId), "sleep"),
    )
        ? "sleep"
        : null;
};

const primaryBlockAnchor = (instances: FurnitureInstance[]): FurnitureInstance | null =>
    [...instances].sort(
        (first, second) =>
            bodyArea(getFurniture(second.definitionId)) -
                bodyArea(getFurniture(first.definitionId)) ||
            first.instanceId.localeCompare(second.instanceId),
    )[0] ?? null;

/**
 * Describes compositional intent without turning it into a hard catalog
 * dependency. Every member remains independently removable according to its
 * priority; the solver uses these plans only for ordering, candidate seeding
 * and soft scoring.
 */
export const getFunctionalBlocks = (
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
): FunctionalBlockPlan[] => {
    const targetCategory = resolveTvTargetCategory(instances, preferences);
    const byDefinition = (definitionId: string) =>
        instances.filter((instance) => instance.definitionId === definitionId);
    const livingAnchors = instances.filter((instance) =>
        isTvTargetDefinition(getFurniture(instance.definitionId), "living"),
    );
    const sleepAnchors = instances.filter((instance) =>
        isTvTargetDefinition(getFurniture(instance.definitionId), "sleep"),
    );
    const workAnchors = byDefinition("desk");
    const televisions = instances.filter(
        (instance) => getFurniture(instance.definitionId).category === "media",
    );
    const plans: FunctionalBlockPlan[] = [];

    const addPlan = (
        kind: FunctionalBlockKind,
        anchor: FurnitureInstance | null,
        members: FurnitureInstance[],
    ) => {
        if (!anchor) return;
        const memberInstanceIds = members
            .filter((member) => member.instanceId !== anchor.instanceId)
            .map((member) => member.instanceId)
            .filter((instanceId, index, values) => values.indexOf(instanceId) === index)
            .sort();
        if (memberInstanceIds.length === 0) return;
        plans.push({
            id: `${kind}:${anchor.instanceId}`,
            kind,
            anchorInstanceId: anchor.instanceId,
            memberInstanceIds,
        });
    };

    addPlan("living", primaryBlockAnchor(livingAnchors), [
        ...byDefinition("coffee-table"),
        ...(targetCategory === "living" ? televisions : []),
    ]);
    addPlan("sleep", primaryBlockAnchor(sleepAnchors), [
        ...byDefinition("bedside-table"),
        ...byDefinition("dresser"),
        ...byDefinition("cradle"),
        ...(targetCategory === "sleep" ? televisions : []),
    ]);
    addPlan("work", primaryBlockAnchor(workAnchors), [...byDefinition("bookcase")]);

    return plans;
};

const livingTargetCandidatesForTv = (
    instance: FurnitureInstance,
    room: Room,
    profileId: LayoutVariantProfileId,
): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    if (!isTvTargetDefinition(definition, "living")) return [];

    const television = getFurniture("tv");
    const candidates: Placement[] = [];

    const viewingDistance = getViewingDistanceRange(television, "living");
    const viewingDistances = [
        viewingDistance.minimum,
        Math.round((viewingDistance.minimum + viewingDistance.maximum) / 2),
        viewingDistance.maximum,
    ];

    const televisionRotations = canonicalRotations(television).sort((first, second) => {
        if (profileId !== "long-wall") return first - second;
        const wallLengthForRotation = (rotation: Rotation) => {
            const wall = wallForBack(rotation);
            return wall === "top" || wall === "bottom" ? room.width : room.depth;
        };
        return wallLengthForRotation(second) - wallLengthForRotation(first) || first - second;
    });

    televisionRotations.forEach((tvRotation) => {
        const targetRotation = oppositeRotation(tvRotation);
        if (!definition.rotations.includes(targetRotation)) return;

        const tvGeometry = getRotatedGeometry(television, tvRotation);
        const targetGeometry = getRotatedGeometry(definition, targetRotation);
        const horizontalFacing = tvRotation === 90 || tvRotation === 270;
        const alongMaximum = horizontalFacing
            ? room.depth - targetGeometry.depth
            : room.width - targetGeometry.width;

        const alongValues =
            profileId === "open-center" || profileId === "perimeter"
                ? edgeFirstValues(alongMaximum)
                : centerFirstValues(alongMaximum);

        alongValues.forEach((along) => {
            viewingDistances.forEach((viewingDistance) => {
                let x = along;
                let y = along;

                switch (tvRotation) {
                    case 90:
                        x = room.width - tvGeometry.width - viewingDistance - targetGeometry.width;
                        break;
                    case 180:
                        y = room.depth - tvGeometry.depth - viewingDistance - targetGeometry.depth;
                        break;
                    case 270:
                        x = tvGeometry.width + viewingDistance;
                        break;
                    default:
                        y = tvGeometry.depth + viewingDistance;
                }

                candidates.push({
                    instanceId: instance.instanceId,
                    definitionId: instance.definitionId,
                    x: snapToGrid(x),
                    y: snapToGrid(y),
                    rotation: targetRotation,
                });
            });
        });
    });

    return candidates;
};

const tvCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    targetCategory: "sleep" | "living",
): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    const targets = placements.filter((placement) =>
        isTvTargetDefinition(getFurniture(placement.definitionId), targetCategory),
    );

    return targets.flatMap((target) => {
        const rotation = oppositeRotation(target.rotation);
        if (!definition.rotations.includes(rotation)) return [];

        const geometry = getRotatedGeometry(definition, rotation);
        const wall = wallForBack(rotation);
        const axis = wall === "top" || wall === "bottom" ? "x" : "y";
        const coordinates = coordinateSets(room, geometry, placements, axis, "center");

        return [...coordinates.critical, ...coordinates.grid]
            .map((along) => candidateForWall(instance, room, rotation, wall, along))
            .filter((candidate) => tvFacesTarget(candidate, target, targetCategory));
    });
};

const profileCandidateScore = (
    placement: Placement,
    room: Room,
    profileId: LayoutVariantProfileId,
): number => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation, placement);
    const roomCenter = getRoomCentroid(room);
    const centerDistance =
        Math.abs(placement.x + geometry.width / 2 - roomCenter.x) +
        Math.abs(placement.y + geometry.depth / 2 - roomCenter.y);
    const placementRect = {
        x: placement.x,
        y: placement.y,
        width: geometry.width,
        depth: geometry.depth,
    };
    const onPerimeter = (["top", "right", "bottom", "left"] as Wall[]).some((wall) =>
        rectTouchesRoomBoundary(placementRect, room, wall),
    );
    const windowScore = windowPreferenceScore(placement, room);

    switch (profileId) {
        case "fit-all":
            // Use the edge-first candidate source to form a compact, stable
            // packing. Exact feasibility remains exclusively in geometry.ts.
            return centerDistance;
        case "long-wall": {
            const wall = wallForBack(placement.rotation);
            const wallLength = wall === "top" || wall === "bottom" ? room.width : room.depth;
            const preferredLength = Math.max(room.width, room.depth);
            return (
                (definition.category === "media" && wallLength === preferredLength
                    ? -1_000_000
                    : 0) +
                centerDistance / 100
            );
        }
        case "daylight":
            return windowScore * 10 - centerDistance / 100;
        case "open-center":
        case "perimeter":
            return (onPerimeter ? -100_000 : 0) - centerDistance;
        default:
            return windowScore + centerDistance / 100;
    }
};

const prioritizedIntegerValues = (
    minimum: number,
    maximum: number,
    anchors: number[] = [],
): number[] => {
    const start = Math.ceil(minimum);
    const end = Math.floor(maximum);
    if (end < start) return [];

    const seen = new Set<number>();
    const values: number[] = [];
    const priorityValues = [...anchors, start, end, Math.round((start + end) / 2)];
    for (let value = Math.ceil(start / GRID_SIZE) * GRID_SIZE; value <= end; value += GRID_SIZE) {
        priorityValues.push(value);
    }

    for (const rawValue of priorityValues) {
        const value = Math.round(rawValue);
        if (value < start || value > end || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
    }

    // The remaining millimetre coordinates make the generator complete with
    // respect to the integer-mm validator, not merely the 50 mm UI grid.
    for (let value = start; value <= end; value += 1) {
        if (seen.has(value)) continue;
        values.push(value);
    }

    return values;
};

const overlapCoordinateRanges = (
    targetStart: number,
    targetEnd: number,
    dependentLength: number,
    roomMaximum: number,
    alignedOnly: boolean,
): Array<[number, number]> => {
    const overlapStart = Math.max(0, targetStart - dependentLength + 1);
    const overlapEnd = Math.min(roomMaximum, targetEnd - 1);
    if (overlapEnd < overlapStart) return [];
    if (!alignedOnly) return [[overlapStart, overlapEnd]];

    return [
        [targetStart - GRID_SIZE, targetStart + GRID_SIZE],
        [targetEnd - dependentLength - GRID_SIZE, targetEnd - dependentLength + GRID_SIZE],
    ]
        .map(
            ([start, end]) =>
                [Math.max(overlapStart, start), Math.min(overlapEnd, end)] as [number, number],
        )
        .filter(([start, end]) => end >= start);
};

function* relationCandidateSource(
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    rotations: readonly Rotation[],
    relation: RelationTemplate,
): Generator<Placement> {
    const definition = getFurniture(instance.definitionId);

    const targets = placements.filter((placement) =>
        relationTargetsDefinition(relation, getFurniture(placement.definitionId)),
    );
    const { minimumGap, maximumGap } = resolveRelationGapRange({
        ...relation,
        kind: relation.kind as "front-gap" | "adjacent" | "aligned-side",
    });

    for (const target of targets) {
        const targetBounds = getBounds(getWorldBodyRects(target));
        for (const rotation of rotations) {
            const geometry = getRotatedGeometry(definition, rotation);
            const maximumX = room.width - geometry.width;
            const maximumY = room.depth - geometry.depth;
            if (maximumX < 0 || maximumY < 0) continue;

            const horizontalRanges = overlapCoordinateRanges(
                targetBounds.y,
                targetBounds.y + targetBounds.depth,
                geometry.depth,
                maximumY,
                relation.kind === "aligned-side",
            );
            const verticalRanges = overlapCoordinateRanges(
                targetBounds.x,
                targetBounds.x + targetBounds.width,
                geometry.width,
                maximumX,
                relation.kind === "aligned-side",
            );

            for (const gap of prioritizedIntegerValues(minimumGap, maximumGap)) {
                if (relation.kind === "front-gap") {
                    const horizontalFacing = target.rotation === 90 || target.rotation === 270;
                    const ranges = horizontalFacing ? horizontalRanges : verticalRanges;
                    for (const [start, end] of ranges) {
                        for (const along of prioritizedIntegerValues(start, end, [
                            horizontalFacing ? targetBounds.y : targetBounds.x,
                            horizontalFacing
                                ? targetBounds.y + targetBounds.depth - geometry.depth
                                : targetBounds.x + targetBounds.width - geometry.width,
                        ])) {
                            let x = along;
                            let y = along;
                            switch (target.rotation) {
                                case 90:
                                    x = targetBounds.x - gap - geometry.width;
                                    y = along;
                                    break;
                                case 180:
                                    x = along;
                                    y = targetBounds.y - gap - geometry.depth;
                                    break;
                                case 270:
                                    x = targetBounds.x + targetBounds.width + gap;
                                    y = along;
                                    break;
                                default:
                                    x = along;
                                    y = targetBounds.y + targetBounds.depth + gap;
                            }
                            if (x < 0 || x > maximumX || y < 0 || y > maximumY) continue;
                            yield {
                                instanceId: instance.instanceId,
                                definitionId: instance.definitionId,
                                x,
                                y,
                                rotation,
                            };
                        }
                    }
                    continue;
                }

                const horizontalXs = [
                    targetBounds.x - gap - geometry.width,
                    targetBounds.x + targetBounds.width + gap,
                ];
                for (const x of horizontalXs) {
                    if (x < 0 || x > maximumX) continue;
                    for (const [start, end] of horizontalRanges) {
                        for (const y of prioritizedIntegerValues(start, end, [
                            targetBounds.y,
                            targetBounds.y + targetBounds.depth - geometry.depth,
                        ])) {
                            yield {
                                instanceId: instance.instanceId,
                                definitionId: instance.definitionId,
                                x,
                                y,
                                rotation,
                            };
                        }
                    }
                }

                const verticalYs = [
                    targetBounds.y - gap - geometry.depth,
                    targetBounds.y + targetBounds.depth + gap,
                ];
                for (const y of verticalYs) {
                    if (y < 0 || y > maximumY) continue;
                    for (const [start, end] of verticalRanges) {
                        for (const x of prioritizedIntegerValues(start, end, [
                            targetBounds.x,
                            targetBounds.x + targetBounds.width - geometry.width,
                        ])) {
                            yield {
                                instanceId: instance.instanceId,
                                definitionId: instance.definitionId,
                                x,
                                y,
                                rotation,
                            };
                        }
                    }
                }
            }
        }
    }
}

export const getRequiredRelationCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    rotationFilter?: readonly Rotation[],
): Iterable<Placement> | null => {
    const definition = getFurniture(instance.definitionId);
    const relation = definition.relations.find(
        (candidate) => candidate.required && SUPPORTED_RELATIONS.has(candidate.kind),
    );
    if (!relation) return null;

    const hasTarget = placements.some((placement) =>
        relationTargetsDefinition(relation, getFurniture(placement.definitionId)),
    );
    const rotations = canonicalRotations(definition).filter(
        (rotation) => rotationFilter === undefined || rotationFilter.includes(rotation),
    );
    return hasTarget
        ? relationCandidateSource(instance, room, placements, rotations, relation)
        : [];
};

/**
 * Soft catalog links guide the automatic search when their counterpart is
 * already placed, but never make a manually positioned item invalid.
 */
export const getPreferredRelationCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    rotationFilter?: readonly Rotation[],
): Iterable<Placement> | null => {
    const definition = getFurniture(instance.definitionId);
    const relation = definition.relations.find(
        (candidate) => !candidate.required && SUPPORTED_RELATIONS.has(candidate.kind),
    );
    if (!relation) return null;

    const hasTarget = placements.some((placement) =>
        relationTargetsDefinition(relation, getFurniture(placement.definitionId)),
    );
    if (!hasTarget) return null;

    const rotations = canonicalRotations(definition).filter(
        (rotation) => rotationFilter === undefined || rotationFilter.includes(rotation),
    );
    return relationCandidateSource(instance, room, placements, rotations, relation);
};

const MAX_BLOCK_ANCHOR_SEEDS = 96;
const MAX_BLOCK_MEMBER_CANDIDATES = 32;

const functionalSupportCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    blocks: FunctionalBlockPlan[],
): Placement[] => {
    if (instance.definitionId !== "dresser" && instance.definitionId !== "bookcase") return [];
    const block = blocks.find((candidate) =>
        candidate.memberInstanceIds.includes(instance.instanceId),
    );
    const anchor = block
        ? placements.find((placement) => placement.instanceId === block.anchorInstanceId)
        : null;
    if (!anchor) return [];

    const definition = getFurniture(instance.definitionId);
    const anchorBounds = getBounds(getWorldBodyRects(anchor));
    const anchorCenter = {
        x: anchorBounds.x + anchorBounds.width / 2,
        y: anchorBounds.y + anchorBounds.depth / 2,
    };
    const candidates: Placement[] = [];

    canonicalRotations(definition).forEach((rotation) => {
        const geometry = getRotatedGeometry(definition, rotation);
        definition.placement.allowedWallContactEdges.forEach((edge) => {
            const wall = wallForBodyEdge(rotation, edge);
            const maximumAlong =
                wall === "top" || wall === "bottom"
                    ? room.width - geometry.width
                    : room.depth - geometry.depth;
            if (maximumAlong < 0) return;
            const anchorStart =
                wall === "top" || wall === "bottom" ? anchorBounds.x : anchorBounds.y;
            const anchorLength =
                wall === "top" || wall === "bottom" ? anchorBounds.width : anchorBounds.depth;
            const bodyLength =
                wall === "top" || wall === "bottom" ? geometry.width : geometry.depth;
            const preferredAlong = anchorStart + anchorLength / 2 - bodyLength / 2;
            const alongValues = [
                anchorStart - bodyLength - DEFAULT_BODY_GAP,
                preferredAlong,
                anchorStart,
                anchorStart + anchorLength - bodyLength,
                anchorStart + anchorLength + DEFAULT_BODY_GAP,
            ]
                .map((value) => snapToGrid(Math.min(Math.max(value, 0), maximumAlong)))
                .filter((value, index, values) => values.indexOf(value) === index);

            alongValues.forEach((along) => {
                candidates.push(candidateForWall(instance, room, rotation, wall, along));
            });
        });
    });

    return candidates.sort((first, second) => {
        const centerDistance = (candidate: Placement) => {
            const bounds = getBounds(getWorldBodyRects(candidate));
            return Math.hypot(
                bounds.x + bounds.width / 2 - anchorCenter.x,
                bounds.y + bounds.depth / 2 - anchorCenter.y,
            );
        };
        return (
            centerDistance(first) - centerDistance(second) ||
            first.x - second.x ||
            first.y - second.y ||
            first.rotation - second.rotation
        );
    });
};

const canCompleteExplicitBlockMembers = (
    room: Room,
    placements: Placement[],
    members: FurnitureInstance[],
    allInstances: FurnitureInstance[],
    preferences: LayoutPreferences,
    index = 0,
): boolean => {
    if (index >= members.length) return true;
    const member = members[index];
    const definition = getFurniture(member.definitionId);
    const targetCategory = resolveTvTargetCategory(allInstances, preferences);
    const source =
        definition.category === "media"
            ? targetCategory
                ? tvCandidates(member, room, placements, targetCategory)
                : []
            : getRequiredRelationCandidates(member, room, placements) ?? [];
    let inspected = 0;
    const iterator = source[Symbol.iterator]();

    for (let next = iterator.next(); !next.done; next = iterator.next()) {
        const candidate = next.value;
        if (inspected >= MAX_BLOCK_MEMBER_CANDIDATES) break;
        inspected += 1;
        if (!validatePlacement(candidate, room, placements).valid) continue;
        if (
            canCompleteExplicitBlockMembers(
                room,
                [...placements, candidate],
                members,
                allInstances,
                preferences,
                index + 1,
            )
        ) {
            return true;
        }
    }

    return false;
};

function* functionalBlockAnchorSeeds(
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    allInstances: FurnitureInstance[],
    preferences: LayoutPreferences,
    blocks: FunctionalBlockPlan[],
    candidates: Iterable<Placement>,
): Generator<Placement> {
    const block = blocks.find((candidate) => candidate.anchorInstanceId === instance.instanceId);
    if (!block) return;
    const instanceById = new Map(
        allInstances.map((candidate) => [candidate.instanceId, candidate]),
    );
    const explicitMembers = block.memberInstanceIds
        .map((instanceId) => instanceById.get(instanceId))
        .filter((member): member is FurnitureInstance => Boolean(member))
        .filter((member) => {
            const definition = getFurniture(member.definitionId);
            return (
                definition.category === "media" ||
                definition.relations.some(
                    (relation) => relation.required && SUPPORTED_RELATIONS.has(relation.kind),
                )
            );
        });
    if (explicitMembers.length === 0) return;

    let inspected = 0;
    const iterator = candidates[Symbol.iterator]();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
        const candidate = next.value;
        if (inspected >= MAX_BLOCK_ANCHOR_SEEDS) return;
        inspected += 1;
        if (!validatePlacement(candidate, room, placements).valid) continue;
        if (
            canCompleteExplicitBlockMembers(
                room,
                [...placements, candidate],
                explicitMembers,
                allInstances,
                preferences,
            )
        ) {
            yield candidate;
        }
    }
}

interface CandidateGenerationState {
    emitted: number;
    truncated: boolean;
}

function* uniqueCandidates(
    candidates: Iterable<Placement>,
    limit: number,
    state: CandidateGenerationState,
): Generator<Placement> {
    const seen = new Set<string>();
    const iterator = candidates[Symbol.iterator]();

    for (let next = iterator.next(); !next.done; next = iterator.next()) {
        const candidate = next.value;
        const key = `${candidate.x}:${candidate.y}:${getCanonicalRotation(
            candidate.definitionId,
            candidate.rotation,
        )}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (state.emitted >= limit) {
            state.truncated = true;
            return;
        }

        state.emitted += 1;
        yield candidate;
    }
}

function* concatenateCandidates(...sources: Iterable<Placement>[]): Generator<Placement> {
    for (const source of sources) {
        const iterator = source[Symbol.iterator]();
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
            yield next.value;
        }
    }
}

const generateCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    allInstances: FurnitureInstance[],
    preferences: LayoutPreferences,
    profileId: LayoutVariantProfileId,
    generationLimit: number,
    relationGenerationLimit?: number,
): { candidates: Iterable<Placement>; state: CandidateGenerationState } => {
    const definition = getFurniture(instance.definitionId);
    const targetCategory = resolveTvTargetCategory(allInstances, preferences);
    const functionalBlocks = getFunctionalBlocks(allInstances, preferences);
    const state: CandidateGenerationState = { emitted: 0, truncated: false };

    if (definition.category === "media") {
        const source = targetCategory
            ? tvCandidates(instance, room, placements, targetCategory)
            : [];
        return {
            candidates: uniqueCandidates(source, generationLimit, state),
            state,
        };
    }

    const related = getRequiredRelationCandidates(instance, room, placements);
    if (related !== null) {
        const relationLimit = Math.min(
            generationLimit,
            Math.max(0, Math.floor(relationGenerationLimit ?? generationLimit)),
        );
        return {
            candidates: uniqueCandidates(related, relationLimit, state),
            state,
        };
    }

    // In the default packing mode, optional visual relations must not narrow
    // the search. They are useful for styled variants, but can otherwise make
    // a full, conflict-free set look needlessly impossible.
    const preferredRelated =
        profileId === "fit-all" ? null : getPreferredRelationCandidates(instance, room, placements);

    const televisionSelected = allInstances.some(
        (candidate) => getFurniture(candidate.definitionId).category === "media",
    );
    const tvAwareCandidates =
        televisionSelected && targetCategory === "living"
            ? livingTargetCandidatesForTv(instance, room, profileId)
            : [];
    const supportCandidates = functionalSupportCandidates(
        instance,
        room,
        placements,
        functionalBlocks,
    );
    const preferCenterFirst =
        definition.placement.centerAllowed &&
        definition.placement.windowPolicy !== "preferred" &&
        profileId !== "fit-all" &&
        profileId !== "open-center" &&
        profileId !== "perimeter";
    const baseSource = () =>
        preferCenterFirst
            ? concatenateCandidates(
                  tvAwareCandidates,
                  supportCandidates,
                  centerCandidates(instance, room, placements, profileId),
                  wallCandidates(instance, room, placements, profileId),
              )
            : concatenateCandidates(
                  tvAwareCandidates,
                  supportCandidates,
                  wallCandidates(instance, room, placements, profileId),
                  centerCandidates(instance, room, placements, profileId),
              );
    const source = concatenateCandidates(
        preferredRelated ?? [],
        functionalBlockAnchorSeeds(
            instance,
            room,
            placements,
            allInstances,
            preferences,
            functionalBlocks,
            baseSource(),
        ),
        baseSource(),
    );

    return {
        candidates: uniqueCandidates(source, generationLimit, state),
        state,
    };
};

const countPerimeterItems = (room: Room, placements: Placement[]): number =>
    placements.filter((placement) => {
        const geometry = getRotatedGeometry(
            getFurniture(placement.definitionId),
            placement.rotation,
        );
        const rect = {
            x: placement.x,
            y: placement.y,
            width: geometry.width,
            depth: geometry.depth,
        };
        return (["top", "right", "bottom", "left"] as Wall[]).some((wall) =>
            rectTouchesRoomBoundary(rect, room, wall),
        );
    }).length;

const getCenterClearance = (room: Room, placements: Placement[]): number => {
    if (placements.length === 0) return Math.round(Math.min(room.width, room.depth) / 2);

    const { x: centerX, y: centerY } = getRoomCentroid(room);
    return Math.round(
        Math.min(
            ...placements.flatMap((placement) =>
                getWorldBodyRects(placement).map((rect) => {
                    const dx = Math.max(rect.x - centerX, 0, centerX - (rect.x + rect.width));
                    const dy = Math.max(rect.y - centerY, 0, centerY - (rect.y + rect.depth));
                    return Math.hypot(dx, dy);
                }),
            ),
        ),
    );
};

const crossAxisCenterOffset = (placement: Placement, target: Placement): number => {
    const placementBounds = getBounds(getWorldBodyRects(placement));
    const targetBounds = getBounds(getWorldBodyRects(target));
    const horizontalFacing = target.rotation === 0 || target.rotation === 180;
    const placementCenter = horizontalFacing
        ? placementBounds.x + placementBounds.width / 2
        : placementBounds.y + placementBounds.depth / 2;
    const targetCenter = horizontalFacing
        ? targetBounds.x + targetBounds.width / 2
        : targetBounds.y + targetBounds.depth / 2;

    return Math.abs(placementCenter - targetCenter);
};

const coffeeTableFacesSofa = (table: Placement, sofa: Placement): boolean => {
    const definition = getFurniture(table.definitionId);
    const relation = definition.relations.find(
        (candidate) => candidate.kind === "front-gap" && candidate.targetCategory === "living",
    );
    if (!relation) return false;
    const { minimumGap, maximumGap } = resolveRelationGapRange({
        ...relation,
        kind: "front-gap",
    });

    return relationSatisfied(table, sofa, "front-gap", minimumGap, maximumGap);
};

/**
 * Rewards one coherent living-room composition. When several sofas exist, TV
 * and coffee table receive the full bonus only when they resolve to the same
 * sofa; merely satisfying two unrelated category links is not enough.
 */
export const scoreLivingComposition = (placements: Placement[]): number => {
    const sofas = placements.filter((placement) => {
        const definition = getFurniture(placement.definitionId);
        return definition.category === "living" && definition.id !== "coffee-table";
    });
    const tables = placements.filter((placement) => placement.definitionId === "coffee-table");
    const televisions = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === "media",
    );
    if (sofas.length === 0 || (tables.length === 0 && televisions.length === 0)) return 0;

    return Math.max(
        ...sofas.map((sofa) => {
            const matchedTables = tables.filter((table) => coffeeTableFacesSofa(table, sofa));
            const matchedTelevisions = televisions.filter((television) =>
                tvFacesTarget(television, sofa, "living"),
            );
            const allSelectedMembersMatch =
                matchedTables.length === tables.length &&
                matchedTelevisions.length === televisions.length;
            const memberScore =
                matchedTables.length * 350_000 + matchedTelevisions.length * 350_000;
            const coherentGroupBonus =
                tables.length > 0 && televisions.length > 0 && allSelectedMembersMatch
                    ? 1_000_000
                    : 0;
            const alignmentScore = [...matchedTables, ...matchedTelevisions].reduce(
                (score, member) =>
                    score + Math.max(0, 1200 - crossAxisCenterOffset(member, sofa)) * 250,
                0,
            );

            return Math.round(memberScore + coherentGroupBonus + alignmentScore);
        }),
    );
};

const boundsGapDistance = (first: Rect, second: Rect): number => {
    const dx = Math.max(first.x - (second.x + second.width), second.x - (first.x + first.width), 0);
    const dy = Math.max(first.y - (second.y + second.depth), second.y - (first.y + first.depth), 0);
    return Math.hypot(dx, dy);
};

const nearestSupportGap = (support: Placement, anchors: Placement[]): number | null => {
    if (anchors.length === 0) return null;
    const supportBounds = getBounds(getWorldBodyRects(support));
    return Math.min(
        ...anchors.map((anchor) =>
            boundsGapDistance(supportBounds, getBounds(getWorldBodyRects(anchor))),
        ),
    );
};

const supportProximityScore = (
    supports: Placement[],
    anchors: Placement[],
    idealGap: number,
): number =>
    supports.reduce((score, support) => {
        const nearestGap = nearestSupportGap(support, anchors);
        if (nearestGap === null) return score;
        if (nearestGap > 3000) {
            return score - Math.round(1_000_000 + (nearestGap - 3000) * 200);
        }
        return score + Math.max(0, Math.round(600_000 - Math.abs(nearestGap - idealGap) * 240));
    }, 0);

/** Soft cohesion for storage members that have no hard catalog relation. */
export const scoreFunctionalBlockCohesion = (placements: Placement[]): number => {
    const beds = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === "sleep",
    );
    const desks = placements.filter((placement) => placement.definitionId === "desk");
    const dressers = placements.filter((placement) => placement.definitionId === "dresser");
    const bookcases = placements.filter((placement) => placement.definitionId === "bookcase");

    return (
        scoreLivingComposition(placements) +
        supportProximityScore(dressers, beds, 1500) +
        supportProximityScore(bookcases, desks, 1200)
    );
};

const functionalZoneKey = (placement: Placement): "living" | "sleep" | "work" | null => {
    const definition = getFurniture(placement.definitionId);
    if (definition.category === "living" || definition.category === "media") return "living";
    if (
        definition.category === "sleep" ||
        definition.category === "children" ||
        definition.id === "bedside-table"
    ) {
        return "sleep";
    }
    if (definition.category === "work") return "work";
    return null;
};

const getFunctionalZoneSpreadPenalty = (placements: Placement[]): number => {
    const zoneKeys = ["living", "sleep", "work"] as const;

    return Math.round(
        zoneKeys.reduce((penalty, zoneKey) => {
            const members = placements.filter(
                (placement) => functionalZoneKey(placement) === zoneKey,
            );
            if (members.length < 2) return penalty;
            const rects = members.flatMap(getWorldBodyRects);
            const bounds = getBounds(rects);
            const occupiedArea = members.reduce(
                (sum, placement) => sum + bodyArea(getFurniture(placement.definitionId)),
                0,
            );

            return penalty + Math.max(0, bounds.width * bounds.depth - occupiedArea) / 100;
        }, 0),
    );
};

const getZoneBounds = (
    placements: Placement[],
    zoneKey: "living" | "sleep" | "work",
): Rect | null => {
    const rects = placements
        .filter((placement) => functionalZoneKey(placement) === zoneKey)
        .flatMap(getWorldBodyRects);
    return rects.length > 0 ? getBounds(rects) : null;
};

const getZoningMetrics = (
    room: Room,
    placements: Placement[],
): { separation: number; preferredSeparation: number } | null => {
    const living = getZoneBounds(placements, "living");
    const sleep = getZoneBounds(placements, "sleep");
    if (!living || !sleep) return null;

    const livingCenter = {
        x: living.x + living.width / 2,
        y: living.y + living.depth / 2,
    };
    const sleepCenter = {
        x: sleep.x + sleep.width / 2,
        y: sleep.y + sleep.depth / 2,
    };
    const separation = Math.hypot(livingCenter.x - sleepCenter.x, livingCenter.y - sleepCenter.y);
    const preferredSeparation = Math.min(Math.hypot(room.width, room.depth) * 0.42, 4500);

    return { separation, preferredSeparation };
};

const getZoningScore = (room: Room, placements: Placement[]): number => {
    const metrics = getZoningMetrics(room, placements);
    if (!metrics) return 0;

    return Math.max(
        0,
        Math.round(1_000_000 - Math.abs(metrics.separation - metrics.preferredSeparation) * 250),
    );
};

const countMediaOnLongWalls = (room: Room, placements: Placement[]): number =>
    placements.filter((placement) => {
        if (getFurniture(placement.definitionId).category !== "media") return false;
        const wall = wallForBack(placement.rotation);
        const wallLength = wall === "top" || wall === "bottom" ? room.width : room.depth;
        return wallLength === Math.max(room.width, room.depth);
    }).length;

/**
 * Packing uses the smallest envelope containing furniture bodies and required
 * access zones. It is deliberately not an interior-design score: every
 * candidate reaching this function has already passed the hard geometry,
 * opening and connected-access checks.
 */
const getRequiredFootprintArea = (placements: Placement[]): number => {
    const occupied = placements.flatMap((placement) => [
        ...getWorldBodyRects(placement),
        ...getWorldHardClearanceRects(placement),
    ]);
    if (occupied.length === 0) return 0;

    const bounds = getBounds(occupied);
    return bounds.width * bounds.depth;
};

/** Explicit deterministic objective used to compare every valid leaf visited. */
export const scoreLayoutForProfile = (
    room: Room,
    placements: Placement[],
    profileId: LayoutVariantProfileId,
): number => {
    const preferredWindowItems = placements.filter((placement) => {
        const definition = getFurniture(placement.definitionId);
        return (
            definition.placement.windowPolicy === "preferred" &&
            windowPreferenceScore(placement, room) < 0
        );
    }).length;

    const perimeterItems = countPerimeterItems(room, placements);
    const centerClearance = getCenterClearance(room, placements);
    const functionalBlockScore = scoreFunctionalBlockCohesion(placements);
    const zoneSpreadPenalty = getFunctionalZoneSpreadPenalty(placements);
    const zoningScore = getZoningScore(room, placements);
    const longWallMediaItems = countMediaOnLongWalls(room, placements);
    const preferredClearance = getPreferredClearanceSummary(room, placements);
    const preferredClearanceBonus = preferredClearance.satisfiedZones * 250_000;

    switch (profileId) {
        case "fit-all":
            // A full valid layout is always eligible. Within that safe set,
            // prefer a usable composition over the smallest possible pile of
            // furniture: circulation and hard operating zones were already
            // checked before scoring. The footprint is deliberately only a
            // weak deterministic tie-breaker, not the main packing goal.
            return Math.round(
                preferredClearanceBonus +
                    functionalBlockScore +
                    zoningScore +
                    centerClearance * 25 -
                    zoneSpreadPenalty -
                    getRequiredFootprintArea(placements) / 1_000,
            );
        case "long-wall":
            return Math.round(
                preferredClearanceBonus +
                    functionalBlockScore +
                    longWallMediaItems * 1_000_000 +
                    centerClearance * 50 +
                    perimeterItems * 100 -
                    zoneSpreadPenalty,
            );
        case "zoned":
            return Math.round(
                preferredClearanceBonus +
                    functionalBlockScore +
                    zoningScore +
                    preferredWindowItems * 100_000 +
                    centerClearance * 25 -
                    zoneSpreadPenalty,
            );
        case "daylight":
            return Math.round(
                preferredClearanceBonus +
                    functionalBlockScore +
                    preferredWindowItems * 1_000_000 +
                    centerClearance * 100 +
                    perimeterItems * 10 +
                    -zoneSpreadPenalty,
            );
        case "open-center":
        case "perimeter":
            return Math.round(
                preferredClearanceBonus +
                    functionalBlockScore +
                    centerClearance * 10_000 +
                    perimeterItems * 100 +
                    preferredWindowItems * 10 +
                    -zoneSpreadPenalty,
            );
        default:
            return Math.round(
                preferredClearanceBonus +
                    functionalBlockScore +
                    centerClearance * 50 +
                    preferredWindowItems * 100_000 +
                    perimeterItems * 100 +
                    -zoneSpreadPenalty,
            );
    }
};

const failure = (
    reason: LayoutFailure["reason"],
    message: string,
    exploredNodes = 0,
    placements: Placement[] = [],
    blockingInstanceIds: string[] = [],
): LayoutFailure => ({
    status: "failure",
    placements,
    exploredNodes,
    blockingInstanceIds,
    reason,
    message,
});

interface InternalSolveOptions {
    preferences: LayoutPreferences;
    profileId: LayoutVariantProfileId;
    maxSearchNodes: number;
    maxRelationCandidates?: number;
    excludedLayouts?: readonly Placement[][];
    excludedStructureSignatures?: ReadonlySet<string>;
}

const solveRoomInternal = (
    room: Room,
    instances: FurnitureInstance[],
    options: InternalSolveOptions,
): LayoutResult => {
    const nodeBudget = Math.max(0, Math.floor(options.maxSearchNodes));
    const roomError = validateRoomGeometry(room);
    if (roomError) {
        return {
            status: "failure",
            placements: [],
            exploredNodes: 0,
            blockingInstanceIds: [],
            reason: "invalid-room",
            message: roomError,
        };
    }

    const trustedDoorError = getTrustedAccessDoorError(room);
    if (trustedDoorError) {
        return {
            status: "failure",
            placements: [],
            exploredNodes: 0,
            blockingInstanceIds: [],
            reason: "access-unverified",
            message: trustedDoorError,
        };
    }

    const invalidPriorityInstances = instances.filter(
        (instance) =>
            !["required", "preferred", "optional"].includes(instance.priority) ||
            instance.required !== (instance.priority === "required"),
    );
    if (invalidPriorityInstances.length > 0) {
        return failure(
            "invalid-request",
            "Приоритет мебели передан некорректно; required должен совпадать с priority.",
            0,
            [],
            invalidPriorityInstances.map((instance) => instance.instanceId),
        );
    }

    const televisions = instances.filter(
        (instance) => getFurniture(instance.definitionId).category === "media",
    );
    const targetCategory = resolveTvTargetCategory(instances, options.preferences);
    const targetInstances = targetCategory
        ? instances.filter((instance) =>
              isTvTargetDefinition(getFurniture(instance.definitionId), targetCategory),
          )
        : [];

    const instancesWithMissingDependency = instances.filter((instance) => {
        const definition = getFurniture(instance.definitionId);

        return definition.relations.some(
            (relation) =>
                relation.required &&
                SUPPORTED_RELATIONS.has(relation.kind) &&
                !instances.some(
                    (candidate) =>
                        candidate.instanceId !== instance.instanceId &&
                        relationTargetsDefinition(relation, getFurniture(candidate.definitionId)),
                ),
        );
    });

    if (instancesWithMissingDependency.length > 0) {
        const firstDefinition = getFurniture(instancesWithMissingDependency[0].definitionId);
        return failure(
            "invalid-request",
            `${firstDefinition.shortLabel}: не найден обязательный связанный предмет.`,
            0,
            [],
            instancesWithMissingDependency.map((instance) => instance.instanceId),
        );
    }

    if (televisions.length > 0 && targetInstances.length === 0) {
        const targetLabel =
            targetCategory === "living"
                ? "диван"
                : targetCategory === "sleep"
                  ? "кровать"
                  : "диван или кровать";
        return failure(
            "invalid-request",
            `Для телевизора не выбран целевой предмет: добавьте ${targetLabel}.`,
            0,
            [],
            televisions.map((television) => television.instanceId),
        );
    }

    if (instances.length === 0) {
        if (options.excludedLayouts?.some((layout) => layout.length === 0)) {
            return failure(
                "proven-impossible",
                "Другого уникального варианта для пустой комнаты нет.",
            );
        }

        return {
            status: "success",
            placements: [],
            exploredNodes: 0,
            score: 1000,
            notes: [],
        };
    }

    const orderedInstances = orderInstances(instances, options.preferences, options.profileId);
    let exploredNodes = 0;
    let reachedSearchLimit = false;
    let deepestIndex = 0;
    let deepestPlacements: Placement[] = [];
    let bestPlacements: Placement[] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTieKey = "";

    const exactLayoutTieKey = (placements: Placement[]): string =>
        placements
            .map(
                (placement) =>
                    `${placement.definitionId}:${placement.x}:${placement.y}:${getCanonicalRotation(
                        placement.definitionId,
                        placement.rotation,
                    )}`,
            )
            .sort()
            .join("|");

    const search = (index: number, placements: Placement[]): void => {
        if (index >= orderedInstances.length) {
            const validation = validateLayout(room, placements, options.preferences);
            if (!validation.valid) return;
            if (
                options.excludedStructureSignatures?.has(
                    getLayoutStructureSignature(room, placements),
                )
            ) {
                return;
            }
            if (
                options.excludedLayouts?.some(
                    (excluded) => !areLayoutsNoticeablyDifferent(placements, excluded),
                )
            ) {
                return;
            }

            const candidateScore = scoreLayoutForProfile(room, placements, options.profileId);
            const tieKey = exactLayoutTieKey(placements);
            if (
                candidateScore > bestScore ||
                (candidateScore === bestScore && (bestPlacements === null || tieKey < bestTieKey))
            ) {
                bestPlacements = [...placements];
                bestScore = candidateScore;
                bestTieKey = tieKey;
            }
            return;
        }

        if (exploredNodes >= nodeBudget) {
            reachedSearchLimit = true;
            return;
        }

        if (index > deepestIndex) {
            deepestIndex = index;
            deepestPlacements = placements;
        }

        const instance = orderedInstances[index];
        const generation = generateCandidates(
            instance,
            room,
            placements,
            instances,
            options.preferences,
            options.profileId,
            nodeBudget - exploredNodes,
            options.maxRelationCandidates,
        );

        const iterator = generation.candidates[Symbol.iterator]();
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
            const candidate = next.value;
            if (exploredNodes >= nodeBudget) {
                reachedSearchLimit = true;
                break;
            }

            exploredNodes += 1;

            if (!validatePlacement(candidate, room, placements).valid) continue;

            search(index + 1, [...placements, candidate]);
        }

        if (generation.state.truncated) reachedSearchLimit = true;
    };

    search(0, []);

    if (bestPlacements !== null) {
        const notes: string[] = [];
        const preferredClearance = getPreferredClearanceSummary(room, bestPlacements);
        const connectedAccess = analyzeConnectedAccess(room, bestPlacements);

        if (room.windows.length > 0) {
            notes.push(
                `Для штор временно зарезервирован консервативный буфер ${PROVISIONAL_CURTAIN_BUFFER_MM} мм вдоль стены и внутрь комнаты; направление нужно подтвердить у дизайнера.`,
            );
            if (instances.some((instance) => instance.definitionId === "dresser")) {
                notes.push(
                    `Комод исключён из зоны окна с отдельным отступом ${DRESSER_WINDOW_EXCLUSION_MM} мм.`,
                );
            }
        }

        if (
            instances.some((instance) =>
                isSchematicFurnitureSource(getFurniture(instance.definitionId).source),
            )
        ) {
            notes.push(
                "В плане есть схематичные предметы с типовыми размерами; перед покупкой сверьте габариты выбранной модели.",
            );
        }

        if (connectedAccess.applicable && connectedAccess.connected) {
            notes.push(
                `Связный проход от двери проверен для ширины ${MIN_CONNECTED_PASSAGE_WIDTH} мм. Расчётная модель использует допуск ${ACCESS_PATH_CELL_ENVELOPE} мм: она может пропустить пограничную тесноту, но не отклонит реальный проход из-за дискретизации.`,
            );
        }

        if (televisions.length > 0 && targetCategory) {
            const viewingDistance = getViewingDistanceRange(
                getFurniture(televisions[0].definitionId),
                targetCategory,
            );
            notes.push(
                targetCategory === "living"
                    ? `ТВ направлен на диван; допустимое расстояние — от ${viewingDistance.minimum} до ${viewingDistance.maximum} мм.`
                    : `ТВ направлен на кровать; допустимое расстояние — от ${viewingDistance.minimum} до ${viewingDistance.maximum} мм.`,
            );
        }

        if (preferredClearance.satisfiedZones < preferredClearance.totalZones) {
            notes.push(
                `Желательные дополнительные зоны соблюдены для ${preferredClearance.satisfiedZones} из ${preferredClearance.totalZones}; обязательные проходы при этом проверены отдельно и соблюдены.`,
            );
        }

        if (reachedSearchLimit) {
            notes.push(
                "Выбран лучший проверенный план среди просмотренных вариантов; лимит не позволяет утверждать глобальный оптимум.",
            );
        }

        return {
            status: "success",
            placements: bestPlacements,
            exploredNodes,
            score: bestScore,
            notes,
        };
    }

    const failedInstance = orderedInstances[deepestIndex];
    const optionalByRemovalPriority = orderedInstances
        .filter((instance) => instance.priority === "optional")
        .sort(
            (first, second) =>
                getFurniture(first.definitionId).removalPriority -
                getFurniture(second.definitionId).removalPriority,
        );
    const blockingInstanceIds = [
        failedInstance?.instanceId,
        ...optionalByRemovalPriority.map((instance) => instance.instanceId),
        ...deepestPlacements.slice(-1).map((placement) => placement.instanceId),
    ]
        .filter((instanceId): instanceId is string => Boolean(instanceId))
        .filter((instanceId, index, values) => values.indexOf(instanceId) === index)
        .slice(0, 4);

    return failure(
        reachedSearchLimit ? "search-exhausted" : "proven-impossible",
        reachedSearchLimit
            ? "Поиск остановлен по лимиту. Это не доказывает, что набор не помещается; попробуйте повторить расчёт после уточнения условий."
            : "Полный дискретный поиск MVP завершён: допустимой расстановки для этого набора не найдено.",
        exploredNodes,
        deepestPlacements,
        blockingInstanceIds,
    );
};

export const solveRoom = (
    room: Room,
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
    searchOptions: SolverSearchOptions = {},
): LayoutResult =>
    solveRoomInternal(room, instances, {
        preferences,
        profileId: "fit-all",
        maxSearchNodes: searchOptions.maxSearchNodes ?? MAX_SEARCH_NODES,
        maxRelationCandidates: searchOptions.maxRelationCandidates,
    });

const profileLabel = (
    profileId: LayoutVariantProfileId,
    variantNumber: number,
    windowPreferredItems: number,
): string => {
    switch (profileId) {
        case "fit-all":
            return "Уместить всё";
        case "daylight":
            return windowPreferredItems > 0 ? "Больше света" : `Вариант ${variantNumber}`;
        case "open-center":
            return "Свободный центр";
        case "perimeter":
            return "По периметру";
        case "long-wall":
            return "ТВ вдоль длинной стены";
        case "zoned":
            return "Разделение зон";
        default:
            return "Сбалансированный";
    }
};

export const getVariantProfileIds = (
    room: Room,
    instances: FurnitureInstance[],
): LayoutVariantProfileId[] => {
    const definitions = instances.map((instance) => getFurniture(instance.definitionId));
    const hasLiving = definitions.some(
        (definition) => definition.category === "living" && definition.id !== "coffee-table",
    );
    const hasSleep = definitions.some((definition) => definition.category === "sleep");
    const hasTelevision = definitions.some((definition) => definition.category === "media");
    const hasDesk = definitions.some((definition) => definition.category === "work");
    const scenarioProfile: LayoutVariantProfileId =
        hasLiving && hasSleep
            ? "zoned"
            : hasLiving && hasTelevision
              ? "long-wall"
              : hasDesk && room.windows.length > 0
                ? "daylight"
                : "perimeter";

    // The fit-first plan is always the first and default result. The two
    // remaining profiles are deliberately optional alternatives for people
    // who do care about a visual arrangement.
    return ["fit-all", scenarioProfile, "open-center"];
};

const profileForLayout = (
    profileId: LayoutVariantProfileId,
    room: Room,
    placements: Placement[],
    variantNumber: number,
): LayoutVariantProfile => {
    const windowPreferredItems = placements.filter(
        (placement) => windowPreferenceScore(placement, room) < 0,
    ).length;
    const perimeterItems = countPerimeterItems(room, placements);
    const centerClearance = getCenterClearance(room, placements);

    return {
        id: profileId,
        label: profileLabel(profileId, variantNumber, windowPreferredItems),
        windowPreferredItems,
        perimeterItems,
        centerClearance,
    };
};

/**
 * Turns the profile objective into short, verifiable user-facing evidence.
 * These statements describe the current placements rather than exposing the
 * solver's arbitrary numeric weights as if they were meaningful measurements.
 */
export const explainLayoutForProfile = (
    room: Room,
    placements: Placement[],
    profileId: LayoutVariantProfileId,
    preferences: LayoutPreferences = {},
): string[] => {
    const highlights: string[] = [];
    const windowPreferredItems = placements.filter(
        (placement) => windowPreferenceScore(placement, room) < 0,
    ).length;
    const perimeterItems = countPerimeterItems(room, placements);
    const centerClearance = getCenterClearance(room, placements);
    const longWallMediaItems = countMediaOnLongWalls(room, placements);
    const zoningMetrics = getZoningMetrics(room, placements);
    const sofas = placements.filter((placement) => {
        const definition = getFurniture(placement.definitionId);
        return definition.category === "living" && definition.id !== "coffee-table";
    });
    const televisions = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === "media",
    );
    const coffeeTables = placements.filter(
        (placement) => placement.definitionId === "coffee-table",
    );
    const beds = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === "sleep",
    );
    const desks = placements.filter((placement) => placement.definitionId === "desk");
    const dresser = placements.find((placement) => placement.definitionId === "dresser");
    const bookcase = placements.find((placement) => placement.definitionId === "bookcase");
    const televisionTargetsLiving = preferences.tvTargetCategory
        ? preferences.tvTargetCategory === "living"
        : sofas.length > 0;
    const hasFacingTelevision =
        televisionTargetsLiving &&
        sofas.some((sofa) =>
            televisions.some((television) => tvFacesTarget(television, sofa, "living")),
        );
    const hasFacingCoffeeTable = sofas.some((sofa) =>
        coffeeTables.some((table) => coffeeTableFacesSofa(table, sofa)),
    );

    switch (profileId) {
        case "fit-all":
            highlights.push(
                `Размещены все ${placements.length} предметов; приоритет — вместимость без конфликтов, а не стилистическая композиция.`,
            );
            break;
        case "long-wall":
            if (longWallMediaItems > 0) {
                highlights.push(
                    "ТВ установлен у длинной стены — это главный критерий этого сценария.",
                );
            }
            if (hasFacingTelevision) {
                highlights.push(
                    "ТВ направлен на диван и находится в допустимом диапазоне просмотра.",
                );
            }
            break;
        case "zoned":
            if (zoningMetrics) {
                highlights.push(
                    `Центры спальной и гостиной зон разнесены на ${(zoningMetrics.separation / 1000).toFixed(1)} м.`,
                );
            }
            if (hasFacingTelevision || hasFacingCoffeeTable) {
                highlights.push("Мебель гостиной сохранена как связанная функциональная группа.");
            }
            break;
        case "daylight":
            if (windowPreferredItems > 0) {
                highlights.push(
                    `У окна размещено предметов, для которых важен дневной свет: ${windowPreferredItems}.`,
                );
            }
            break;
        case "open-center":
            highlights.push(
                `До ближайшей мебели от центра комнаты оставлено около ${(centerClearance / 1000).toFixed(1)} м.`,
            );
            break;
        case "perimeter":
            highlights.push(
                `У стен размещено ${perimeterItems} из ${placements.length} предметов, поэтому центр меньше загружен.`,
            );
            break;
        default:
            if (hasFacingTelevision && hasFacingCoffeeTable) {
                highlights.push("Диван, ТВ и кофейный столик собраны в одну функциональную зону.");
            } else if (hasFacingTelevision) {
                highlights.push(
                    "ТВ направлен на диван и находится в допустимом диапазоне просмотра.",
                );
            } else if (hasFacingCoffeeTable) {
                highlights.push("Кофейный столик расположен перед диваном в рабочем диапазоне.");
            }
            highlights.push(
                `У стен размещено ${perimeterItems} из ${placements.length} предметов; свободный центр — около ${(centerClearance / 1000).toFixed(1)} м.`,
            );
    }

    const dresserGap = dresser ? nearestSupportGap(dresser, beds) : null;
    if (dresserGap !== null && dresserGap <= 3000) {
        highlights.push(
            `Комод включён в спальную зону: между его корпусом и кроватью около ${(dresserGap / 1000).toFixed(1)} м.`,
        );
    }
    const bookcaseGap = bookcase ? nearestSupportGap(bookcase, desks) : null;
    if (bookcaseGap !== null && bookcaseGap <= 3000) {
        highlights.push(
            `Книжный шкаф включён в рабочую зону: до стола около ${(bookcaseGap / 1000).toFixed(1)} м.`,
        );
    }

    const validation = validateLayout(room, placements, preferences);
    if (validation.valid) {
        highlights.push(
            "Расстановка прошла проверку корпусов, обязательных проходов, проёмов и служебных зон.",
        );
    }

    return Array.from(new Set(highlights)).slice(0, 3);
};

export const solveRoomVariants = (
    room: Room,
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
    limit = 3,
): LayoutVariantsResult => {
    const requestedLimit = Math.max(0, Math.min(3, Math.floor(limit)));
    if (requestedLimit === 0) {
        return { status: "success", variants: [], exploredNodes: 0, notes: [] };
    }

    const variants: LayoutVariant[] = [];
    const structureSignatures = new Set<string>();
    let exploredNodes = 0;
    let firstFailure: LayoutFailure | null = null;

    for (const profileId of getVariantProfileIds(room, instances)) {
        if (variants.length >= requestedLimit || exploredNodes >= MAX_VARIANT_SEARCH_NODES) break;

        const remainingNodeBudget = MAX_VARIANT_SEARCH_NODES - exploredNodes;
        if (remainingNodeBudget <= 0) break;

        const result = solveRoomInternal(room, instances, {
            preferences,
            profileId,
            maxSearchNodes: Math.min(MAX_SEARCH_NODES, remainingNodeBudget),
            excludedLayouts: variants.map((variant) => variant.placements),
            excludedStructureSignatures: structureSignatures,
        });
        exploredNodes += Math.min(result.exploredNodes, remainingNodeBudget);

        if (result.status === "failure") {
            firstFailure ??= result;
            if (result.reason === "invalid-room" || result.exploredNodes === 0) break;
            continue;
        }

        if (
            variants.some(
                (variant) =>
                    !areLayoutsNoticeablyDifferent(variant.placements, result.placements) ||
                    !areLayoutsStructurallyDifferent(room, variant.placements, result.placements),
            )
        ) {
            continue;
        }

        structureSignatures.add(getLayoutStructureSignature(room, result.placements));

        variants.push({
            ...result,
            variantId: `${profileId}-${variants.length + 1}`,
            profile: profileForLayout(profileId, room, result.placements, variants.length + 1),
        });
    }

    if (variants.length > 0) {
        return {
            status: "success",
            variants,
            exploredNodes,
            notes:
                variants.length < requestedLimit
                    ? [`Найдено ${variants.length} уникальных вариантов из ${requestedLimit}.`]
                    : [],
        };
    }

    const result =
        firstFailure ??
        failure(
            "search-exhausted",
            "Поиск вариантов завершён без результата; это не доказывает, что мебель не помещается.",
        );
    return { ...result, exploredNodes, variants: [] };
};

const combinationCount = (itemCount: number, selectionCount: number, cap: number): number => {
    const effectiveSelection = Math.min(selectionCount, itemCount - selectionCount);
    let result = 1;
    for (let index = 1; index <= effectiveSelection; index += 1) {
        result = (result * (itemCount - effectiveSelection + index)) / index;
        if (result > cap) return cap + 1;
    }
    return Math.round(result);
};

const combinationsOfSize = <T>(items: T[], size: number): T[][] => {
    const combinations: T[][] = [];
    const visit = (start: number, selected: T[]) => {
        if (selected.length === size) {
            combinations.push([...selected]);
            return;
        }

        const remainingNeeded = size - selected.length;
        for (let index = start; index <= items.length - remainingNeeded; index += 1) {
            selected.push(items[index]);
            visit(index + 1, selected);
            selected.pop();
        }
    };

    visit(0, []);
    return combinations;
};

const removalLoss = (instances: FurnitureInstance[]): number =>
    instances.reduce(
        (total, instance) => total + getFurniture(instance.definitionId).removalPriority,
        0,
    );

/**
 * Computes a removal proposal after the UI's explicit confirmation action.
 * Inputs are never mutated. A proposal is returned only when the original set
 * is proven impossible and every cheaper combination has been conclusively
 * rejected; any incomplete search aborts the proposal.
 */
export const solveWithAutomaticRemoval = (
    room: Room,
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
    searchOptions: SolverSearchOptions = {},
): AutoRemovalResult => {
    const initialResult = solveRoom(room, instances, preferences, searchOptions);
    if (initialResult.status !== "failure" || initialResult.reason !== "proven-impossible") {
        return { result: initialResult, removedInstances: [] };
    }

    const optionalInstances = instances
        .filter((instance) => instance.priority === "optional")
        .sort((first, second) => first.instanceId.localeCompare(second.instanceId));
    const combinationBudget = Math.max(
        0,
        Math.floor(searchOptions.maxRemovalCombinationChecks ?? MAX_REMOVAL_COMBINATION_CHECKS),
    );
    let checkedCombinations = 0;
    let remainingRemovalNodes = Math.max(
        0,
        Math.floor(searchOptions.maxRemovalSearchNodes ?? MAX_VARIANT_SEARCH_NODES),
    );

    for (let removalCount = 1; removalCount <= optionalInstances.length; removalCount += 1) {
        const remainingBudget = combinationBudget - checkedCombinations;
        const countAtThisSize = combinationCount(
            optionalInstances.length,
            removalCount,
            remainingBudget,
        );

        if (countAtThisSize > remainingBudget) {
            return {
                result: failure(
                    "search-exhausted",
                    "Лимит подбора удаляемых предметов исчерпан; минимальное предложение не доказано, поэтому ничего не удалено.",
                    initialResult.exploredNodes,
                    initialResult.placements,
                    initialResult.blockingInstanceIds,
                ),
                removedInstances: [],
            };
        }

        const combinations = combinationsOfSize(optionalInstances, removalCount).sort(
            (first, second) =>
                removalLoss(first) - removalLoss(second) ||
                first
                    .map((instance) => instance.instanceId)
                    .join("|")
                    .localeCompare(second.map((instance) => instance.instanceId).join("|")),
        );

        for (const removedInstances of combinations) {
            if (remainingRemovalNodes <= 0) {
                return {
                    result: failure(
                        "search-exhausted",
                        "Лимит проверки предложений исчерпан; минимальное удаление не доказано, поэтому набор не изменён.",
                        initialResult.exploredNodes,
                        initialResult.placements,
                        initialResult.blockingInstanceIds,
                    ),
                    removedInstances: [],
                };
            }

            checkedCombinations += 1;
            const removedIds = new Set(removedInstances.map((instance) => instance.instanceId));
            const remaining = instances.filter((instance) => !removedIds.has(instance.instanceId));
            const result = solveRoom(room, remaining, preferences, {
                ...searchOptions,
                maxSearchNodes: Math.min(
                    searchOptions.maxSearchNodes ?? MAX_SEARCH_NODES,
                    remainingRemovalNodes,
                ),
            });
            remainingRemovalNodes -= Math.min(result.exploredNodes, remainingRemovalNodes);

            if (result.status === "success") return { result, removedInstances };

            if (result.reason === "search-exhausted" || result.reason === "invalid-room") {
                return { result, removedInstances: [] };
            }
        }
    }

    return { result: initialResult, removedInstances: [] };
};

/**
 * Builds a usable plan even when the complete requested set cannot be found
 * quickly. Required furniture is solved first. If that complete required set
 * hits the search budget, the same geometry checks build a working plan from
 * scratch instead of returning an empty room. Every remaining item then gets
 * a direct attempt in the already valid layout before the bounded re-solve
 * fallback. This never removes an item or claims an unplaced item is
 * physically impossible — it only reports what did not enter the quick plan.
 */
export const solveWithPreferredPlacementFallback = (
    room: Room,
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
): PreferredPlacementFallbackResult => {
    const requiredInstances = instances.filter((instance) => instance.priority === "required");
    const compareRemainingInstances = (first: FurnitureInstance, second: FurnitureInstance) =>
        Number(first.priority === "optional") - Number(second.priority === "optional") ||
        getFurniture(second.definitionId).removalPriority -
            getFurniture(first.definitionId).removalPriority ||
        first.instanceId.localeCompare(second.instanceId);
    const remainingInstances = instances
        .filter((instance) => instance.priority !== "required")
        .sort(compareRemainingInstances);
    const requiredResult = solveRoom(room, requiredInstances, preferences);
    const requiredSearchDidNotFinish = requiredResult.status === "failure";
    let acceptedInstances = requiredSearchDidNotFinish ? [] : requiredInstances;
    let acceptedResult: LayoutSuccess =
        requiredResult.status === "success"
            ? requiredResult
            : {
                  status: "success",
                  placements: [],
                  exploredNodes: 0,
                  score: 0,
                  notes: [],
              };
    let acceptedPlacements =
        requiredResult.status === "success" ? [...requiredResult.placements] : [];
    let remainingNodeBudget = MAX_PREFERRED_FALLBACK_NODES;
    const unplacedInstances: FurnitureInstance[] = [];

    const tryPlaceDirectly = (instance: FurnitureInstance): Placement | null => {
        const generation = generateCandidates(
            instance,
            room,
            acceptedPlacements,
            [...acceptedInstances, instance],
            preferences,
            "balanced",
            MAX_PREFERRED_DIRECT_CANDIDATES,
        );

        const iterator = generation.candidates[Symbol.iterator]();
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
            const candidate = next.value;
            if (!validatePlacement(candidate, room, acceptedPlacements).valid) continue;
            if (validateLayout(room, [...acceptedPlacements, candidate], preferences).valid) {
                return candidate;
            }
        }

        return null;
    };

    let pendingInstances = (requiredSearchDidNotFinish ? [...instances] : remainingInstances).sort(
        compareRemainingInstances,
    );
    const directPlacementRank = (instance: FurnitureInstance): number => {
        const definition = getFurniture(instance.definitionId);
        const hasAcceptedTarget = (
            targetCategory: FurnitureDefinition["category"],
            relation?: {
                targetDefinitionIds?: string[];
            },
        ) =>
            acceptedInstances.some((candidate) => {
                const candidateDefinition = getFurniture(candidate.definitionId);
                return (
                    candidateDefinition.category === targetCategory &&
                    (relation?.targetDefinitionIds === undefined ||
                        relation.targetDefinitionIds.includes(candidateDefinition.id))
                );
            });
        const requiredRelation = definition.relations.find(
            (relation) => relation.required && SUPPORTED_RELATIONS.has(relation.kind),
        );

        if (definition.category === "media") {
            const targetCategory = resolveTvTargetCategory(
                [...acceptedInstances, instance],
                preferences,
            );
            return targetCategory && hasAcceptedTarget(targetCategory) ? 0 : 2;
        }
        if (requiredRelation) {
            return hasAcceptedTarget(requiredRelation.targetCategory, requiredRelation) ? 0 : 2;
        }
        return 1;
    };
    const blockedDirectIds = new Set<string>();

    while (pendingInstances.length > 0) {
        const candidates = pendingInstances
            .filter((instance) => !blockedDirectIds.has(instance.instanceId))
            .sort(
                (first, second) =>
                    directPlacementRank(first) - directPlacementRank(second) ||
                    compareRemainingInstances(first, second),
            );
        const instance = candidates[0];
        if (!instance) break;

        const placement = tryPlaceDirectly(instance);
        if (!placement) {
            blockedDirectIds.add(instance.instanceId);
            continue;
        }

        acceptedInstances = [...acceptedInstances, instance];
        acceptedPlacements = [...acceptedPlacements, placement];
        pendingInstances = pendingInstances.filter(
            (candidate) => candidate.instanceId !== instance.instanceId,
        );
        blockedDirectIds.clear();
    }

    for (const instance of pendingInstances) {
        if (remainingNodeBudget <= 0) {
            unplacedInstances.push(instance);
            continue;
        }

        const candidateResult = solveRoom(room, [...acceptedInstances, instance], preferences, {
            maxSearchNodes: Math.min(MAX_PREFERRED_FALLBACK_ATTEMPT_NODES, remainingNodeBudget),
        });
        remainingNodeBudget -= Math.min(candidateResult.exploredNodes, remainingNodeBudget);

        if (candidateResult.status === "success") {
            acceptedInstances = [...acceptedInstances, instance];
            acceptedResult = candidateResult;
            acceptedPlacements = candidateResult.placements;
        } else {
            unplacedInstances.push(instance);
        }
    }

    if (acceptedPlacements.length === 0 && requiredSearchDidNotFinish) {
        return { result: requiredResult, unplacedInstances: [] };
    }

    const result = {
        ...acceptedResult,
        placements: acceptedPlacements,
        score: scoreLayoutForProfile(room, acceptedPlacements, "balanced"),
    };

    if (unplacedInstances.length === 0) return { result, unplacedInstances };

    return {
        result: {
            ...result,
            notes: [
                ...result.notes,
                requiredSearchDidNotFinish
                    ? "Показан рабочий вариант из размещённых предметов; часть обязательной мебели не вошла в быстрый расчёт и остаётся в наборе для ручной расстановки."
                    : "Показан рабочий вариант с обязательными предметами; часть желательной мебели не вошла в быстрый расчёт и остаётся в наборе.",
            ],
        },
        unplacedInstances,
    };
};
