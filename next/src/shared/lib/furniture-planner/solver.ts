import { getFurniture } from "./catalog";
import {
    GRID_SIZE,
    TV_VIEWING_GAP,
    getBounds,
    getRotatedGeometry,
    getWorldBodyRects,
    snapToGrid,
    tvFacesTarget,
    validateLayout,
    validatePlacement,
    validateRoomGeometry,
    wallForBack,
} from "./geometry";
import {
    AutoRemovalResult,
    FurnitureDefinition,
    FurnitureInstance,
    LayoutFailure,
    LayoutPreferences,
    LayoutResult,
    LayoutVariant,
    LayoutVariantProfile,
    LayoutVariantProfileId,
    LayoutVariantsResult,
    Placement,
    Room,
    Rotation,
    Wall,
} from "./types";

const MAX_SEARCH_NODES = 45_000;
const MAX_VARIANT_SEARCH_NODES = 90_000;
const MAX_WALL_CANDIDATES = 192;
const MAX_CENTER_CANDIDATES = 180;
/** Maximum perpendicular distance from an item's back edge to its matching window wall. */
export const WINDOW_PROXIMITY_THRESHOLD = 600;
const SUPPORTED_RELATIONS = new Set(["front-gap", "adjacent", "aligned-side"]);
const VARIANT_PROFILE_IDS: LayoutVariantProfileId[] = ["balanced", "daylight", "open-center"];

const bodyArea = (definition: FurnitureDefinition): number =>
    definition.body.rects.reduce((sum, rect) => sum + rect.width * rect.depth, 0);

const isTvTargetDefinition = (
    definition: FurnitureDefinition,
    category: "sleep" | "living",
): boolean =>
    definition.category === category && (category !== "living" || definition.id !== "coffee-table");

const hasRequiredDependency = (definition: FurnitureDefinition): boolean =>
    definition.category === "media" ||
    definition.relations.some(
        (relation) => relation.required && SUPPORTED_RELATIONS.has(relation.kind),
    );

const orderInstances = (instances: FurnitureInstance[]): FurnitureInstance[] =>
    [...instances].sort((first, second) => {
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

const edgeFirstValues = (maximum: number): number[] => {
    if (maximum < 0) return [];

    const values: number[] = [];
    for (let offset = 0; offset <= maximum; offset += GRID_SIZE) {
        values.push(offset, maximum - offset);
    }

    return Array.from(
        new Set(values.map(snapToGrid).filter((value) => value >= 0 && value <= maximum)),
    );
};

const centerFirstValues = (maximum: number): number[] => {
    if (maximum < 0) return [];

    const values: number[] = [];
    for (let value = 0; value <= maximum; value += GRID_SIZE) values.push(value);

    const center = maximum / 2;
    return values.sort(
        (first, second) => Math.abs(first - center) - Math.abs(second - center) || first - second,
    );
};

const wallSampleValues = (maximum: number): number[] => {
    const values = [
        ...edgeFirstValues(maximum).slice(0, 24),
        ...centerFirstValues(maximum).slice(0, 24),
    ];

    return Array.from(new Set(values)).slice(0, 48);
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

export const isPlacementNearPreferredWindow = (placement: Placement, room: Room): boolean => {
    const definition = getFurniture(placement.definitionId);
    if (definition.placement.windowPolicy !== "preferred") return false;

    const geometry = getRotatedGeometry(definition, placement.rotation);
    const wall = wallForBack(placement.rotation);
    const perpendicularDistance = (() => {
        switch (wall) {
            case "top":
                return placement.y;
            case "right":
                return room.width - (placement.x + geometry.width);
            case "bottom":
                return room.depth - (placement.y + geometry.depth);
            case "left":
                return placement.x;
        }
    })();

    if (perpendicularDistance < 0 || perpendicularDistance > WINDOW_PROXIMITY_THRESHOLD) {
        return false;
    }

    return room.windows.some((window) => {
        if (window.wall !== wall) return false;

        if (wall === "top" || wall === "bottom") {
            return (
                placement.x < window.offset + window.width &&
                placement.x + geometry.width > window.offset
            );
        }

        return (
            placement.y < window.offset + window.width &&
            placement.y + geometry.depth > window.offset
        );
    });
};

const windowPreferenceScore = (placement: Placement, room: Room): number =>
    isPlacementNearPreferredWindow(placement, room) ? -10_000 : 0;

const wallCandidates = (instance: FurnitureInstance, room: Room): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    const candidates: Placement[] = [];

    definition.rotations.forEach((rotation) => {
        const geometry = getRotatedGeometry(definition, rotation);
        const wall = wallForBack(rotation);
        const maximum =
            wall === "top" || wall === "bottom"
                ? room.width - geometry.width
                : room.depth - geometry.depth;

        wallSampleValues(maximum).forEach((along) => {
            candidates.push(candidateForWall(instance, room, rotation, wall, along));
        });
    });

    return candidates
        .sort(
            (first, second) =>
                windowPreferenceScore(first, room) - windowPreferenceScore(second, room),
        )
        .slice(0, MAX_WALL_CANDIDATES);
};

const centerCandidates = (instance: FurnitureInstance, room: Room): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    if (!definition.placement.centerAllowed) return [];

    const candidates: Placement[] = [];

    definition.rotations.forEach((rotation) => {
        const geometry = getRotatedGeometry(definition, rotation);
        const xValues = centerFirstValues(room.width - geometry.width).slice(0, 12);
        const yValues = centerFirstValues(room.depth - geometry.depth).slice(0, 12);

        xValues.forEach((x) => {
            yValues.forEach((y) => {
                candidates.push({
                    instanceId: instance.instanceId,
                    definitionId: instance.definitionId,
                    x,
                    y,
                    rotation,
                });
            });
        });
    });

    const roomCenterX = room.width / 2;
    const roomCenterY = room.depth / 2;

    return candidates
        .sort((first, second) => {
            const firstGeometry = getRotatedGeometry(definition, first.rotation);
            const secondGeometry = getRotatedGeometry(definition, second.rotation);
            const firstDistance =
                Math.abs(first.x + firstGeometry.width / 2 - roomCenterX) +
                Math.abs(first.y + firstGeometry.depth / 2 - roomCenterY);
            const secondDistance =
                Math.abs(second.x + secondGeometry.width / 2 - roomCenterX) +
                Math.abs(second.y + secondGeometry.depth / 2 - roomCenterY);

            return firstDistance - secondDistance;
        })
        .slice(0, MAX_CENTER_CANDIDATES);
};

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

const livingTargetCandidatesForTv = (instance: FurnitureInstance, room: Room): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    if (!isTvTargetDefinition(definition, "living")) return [];

    const television = getFurniture("tv");
    const candidates: Placement[] = [];

    television.rotations.forEach((tvRotation) => {
        const targetRotation = oppositeRotation(tvRotation);
        if (!definition.rotations.includes(targetRotation)) return;

        const tvGeometry = getRotatedGeometry(television, tvRotation);
        const targetGeometry = getRotatedGeometry(definition, targetRotation);
        const horizontalFacing = tvRotation === 90 || tvRotation === 270;
        const alongMaximum = horizontalFacing
            ? room.depth - targetGeometry.depth
            : room.width - targetGeometry.width;

        wallSampleValues(alongMaximum).forEach((along) => {
            let x = along;
            let y = along;

            switch (tvRotation) {
                case 90:
                    x = room.width - tvGeometry.width - TV_VIEWING_GAP - targetGeometry.width;
                    break;
                case 180:
                    y = room.depth - tvGeometry.depth - TV_VIEWING_GAP - targetGeometry.depth;
                    break;
                case 270:
                    x = tvGeometry.width + TV_VIEWING_GAP;
                    break;
                default:
                    y = tvGeometry.depth + TV_VIEWING_GAP;
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
        const targetBounds = getBounds(getWorldBodyRects(target));
        const wall = wallForBack(rotation);
        const along =
            wall === "top" || wall === "bottom"
                ? snapToGrid(targetBounds.x + targetBounds.width / 2 - geometry.width / 2)
                : snapToGrid(targetBounds.y + targetBounds.depth / 2 - geometry.depth / 2);
        const candidate = candidateForWall(instance, room, rotation, wall, along);

        return tvFacesTarget(candidate, target, targetCategory) ? [candidate] : [];
    });
};

const profileCandidateScore = (
    placement: Placement,
    room: Room,
    profileId: LayoutVariantProfileId,
): number => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation);
    const centerDistance =
        Math.abs(placement.x + geometry.width / 2 - room.width / 2) +
        Math.abs(placement.y + geometry.depth / 2 - room.depth / 2);
    const onPerimeter =
        placement.x === 0 ||
        placement.y === 0 ||
        placement.x + geometry.width === room.width ||
        placement.y + geometry.depth === room.depth;
    const windowScore = windowPreferenceScore(placement, room);

    switch (profileId) {
        case "daylight":
            return windowScore * 10 - centerDistance / 100;
        case "open-center":
        case "perimeter":
            return (onPerimeter ? -100_000 : 0) - centerDistance;
        default:
            return windowScore + centerDistance / 100;
    }
};

const placeInFront = (instance: FurnitureInstance, target: Placement, gap: number): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    const targetBounds = getBounds(getWorldBodyRects(target));

    return definition.rotations.map((rotation) => {
        const geometry = getRotatedGeometry(definition, rotation);
        const centeredX = snapToGrid(targetBounds.x + targetBounds.width / 2 - geometry.width / 2);
        const centeredY = snapToGrid(targetBounds.y + targetBounds.depth / 2 - geometry.depth / 2);
        let x = centeredX;
        let y = centeredY;

        switch (target.rotation) {
            case 90:
                x = targetBounds.x - gap - geometry.width;
                break;
            case 180:
                y = targetBounds.y - gap - geometry.depth;
                break;
            case 270:
                x = targetBounds.x + targetBounds.width + gap;
                break;
            default:
                y = targetBounds.y + targetBounds.depth + gap;
        }

        return {
            instanceId: instance.instanceId,
            definitionId: instance.definitionId,
            x: snapToGrid(x),
            y: snapToGrid(y),
            rotation,
        };
    });
};

const placeBeside = (instance: FurnitureInstance, target: Placement, gap: number): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    const rotation = definition.rotations.includes(target.rotation)
        ? target.rotation
        : definition.rotations[0];
    const geometry = getRotatedGeometry(definition, rotation);
    const targetBounds = getBounds(getWorldBodyRects(target));

    if (target.rotation === 0 || target.rotation === 180) {
        const y =
            target.rotation === 0
                ? targetBounds.y
                : targetBounds.y + targetBounds.depth - geometry.depth;

        return [
            {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                x: targetBounds.x - gap - geometry.width,
                y,
                rotation,
            },
            {
                instanceId: instance.instanceId,
                definitionId: instance.definitionId,
                x: targetBounds.x + targetBounds.width + gap,
                y,
                rotation,
            },
        ];
    }

    const x =
        target.rotation === 90
            ? targetBounds.x + targetBounds.width - geometry.width
            : targetBounds.x;

    return [
        {
            instanceId: instance.instanceId,
            definitionId: instance.definitionId,
            x,
            y: targetBounds.y - gap - geometry.depth,
            rotation,
        },
        {
            instanceId: instance.instanceId,
            definitionId: instance.definitionId,
            x,
            y: targetBounds.y + targetBounds.depth + gap,
            rotation,
        },
    ];
};

const relationCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
): Placement[] | null => {
    const definition = getFurniture(instance.definitionId);
    const relation = definition.relations.find(
        (candidate) => candidate.required && SUPPORTED_RELATIONS.has(candidate.kind),
    );

    if (!relation) return null;

    const targets = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === relation.targetCategory,
    );

    if (targets.length === 0) return [];

    const gap = snapToGrid(
        relation.kind === "front-gap"
            ? ((relation.minGap ?? 350) + (relation.maxGap ?? 450)) / 2
            : relation.minGap ?? GRID_SIZE,
    );

    return targets.flatMap((target) => {
        if (relation.kind === "front-gap") {
            return placeInFront(instance, target, gap);
        }

        return placeBeside(instance, target, gap);
    });
};

const uniqueCandidates = (candidates: Placement[]): Placement[] => {
    const seen = new Set<string>();

    return candidates.filter((candidate) => {
        const key = `${candidate.x}:${candidate.y}:${candidate.rotation}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const generateCandidates = (
    instance: FurnitureInstance,
    room: Room,
    placements: Placement[],
    allInstances: FurnitureInstance[],
    preferences: LayoutPreferences,
    profileId: LayoutVariantProfileId,
): Placement[] => {
    const definition = getFurniture(instance.definitionId);
    const targetCategory = resolveTvTargetCategory(allInstances, preferences);

    if (definition.category === "media") {
        return targetCategory
            ? uniqueCandidates(tvCandidates(instance, room, placements, targetCategory))
            : [];
    }

    const related = relationCandidates(instance, room, placements);
    if (related !== null) return uniqueCandidates(related);

    const televisionSelected = allInstances.some(
        (candidate) => getFurniture(candidate.definitionId).category === "media",
    );
    const tvAwareCandidates =
        televisionSelected && targetCategory === "living"
            ? livingTargetCandidatesForTv(instance, room)
            : [];
    const candidates = uniqueCandidates([
        ...tvAwareCandidates,
        ...wallCandidates(instance, room),
        ...centerCandidates(instance, room),
    ]);

    return candidates.sort(
        (first, second) =>
            profileCandidateScore(first, room, profileId) -
                profileCandidateScore(second, room, profileId) ||
            first.rotation - second.rotation ||
            first.x - second.x ||
            first.y - second.y,
    );
};

const finalScore = (
    room: Room,
    placements: Placement[],
    profileId: LayoutVariantProfileId,
): number => {
    const occupiedArea = placements.reduce(
        (sum, placement) => sum + bodyArea(getFurniture(placement.definitionId)),
        0,
    );
    const freeRatio = 1 - occupiedArea / (room.width * room.depth);
    const preferredWindowItems = placements.filter((placement) => {
        const definition = getFurniture(placement.definitionId);
        return (
            definition.placement.windowPolicy === "preferred" &&
            windowPreferenceScore(placement, room) < 0
        );
    }).length;

    const perimeterItems = placements.filter((placement) => {
        const geometry = getRotatedGeometry(
            getFurniture(placement.definitionId),
            placement.rotation,
        );
        return (
            placement.x === 0 ||
            placement.y === 0 ||
            placement.x + geometry.width === room.width ||
            placement.y + geometry.depth === room.depth
        );
    }).length;
    const profileBonus =
        profileId === "daylight"
            ? preferredWindowItems * 200
            : profileId === "open-center" || profileId === "perimeter"
              ? perimeterItems * 80
              : preferredWindowItems * 100;

    return Math.round(freeRatio * 1000 + profileBonus);
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

const layoutSignature = (placements: Placement[]): string =>
    [...placements]
        .sort((first, second) => first.instanceId.localeCompare(second.instanceId))
        .map(
            (placement) =>
                `${placement.instanceId}:${placement.definitionId}:${placement.x}:${placement.y}:${placement.rotation}`,
        )
        .join("|");

interface InternalSolveOptions {
    preferences: LayoutPreferences;
    profileId: LayoutVariantProfileId;
    maxSearchNodes: number;
    excludedSignatures?: ReadonlySet<string>;
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

    const televisions = instances.filter(
        (instance) => getFurniture(instance.definitionId).category === "media",
    );
    const targetCategory = resolveTvTargetCategory(instances, options.preferences);
    const targetInstances = targetCategory
        ? instances.filter((instance) =>
              isTvTargetDefinition(getFurniture(instance.definitionId), targetCategory),
          )
        : [];

    if (televisions.length > 0 && targetInstances.length === 0) {
        const targetLabel =
            targetCategory === "living"
                ? "диван"
                : targetCategory === "sleep"
                  ? "кровать"
                  : "диван или кровать";
        return failure(
            "no-layout",
            `Для телевизора не выбран целевой предмет: добавьте ${targetLabel}.`,
            0,
            [],
            televisions.map((television) => television.instanceId),
        );
    }

    if (instances.length === 0) {
        if (options.excludedSignatures?.has("")) {
            return failure("no-layout", "Другого уникального варианта для пустой комнаты нет.");
        }

        return {
            status: "success",
            placements: [],
            exploredNodes: 0,
            score: 1000,
            notes: [],
        };
    }

    const orderedInstances = orderInstances(instances);
    let exploredNodes = 0;
    let reachedSearchLimit = false;
    let deepestIndex = 0;
    let deepestPlacements: Placement[] = [];

    const search = (index: number, placements: Placement[]): Placement[] | null => {
        if (exploredNodes >= nodeBudget) {
            reachedSearchLimit = true;
            return null;
        }

        if (index >= orderedInstances.length) {
            const validation = validateLayout(room, placements, options.preferences);
            if (!validation.valid) return null;

            return options.excludedSignatures?.has(layoutSignature(placements)) ? null : placements;
        }

        if (index > deepestIndex) {
            deepestIndex = index;
            deepestPlacements = placements;
        }

        const instance = orderedInstances[index];
        const candidates = generateCandidates(
            instance,
            room,
            placements,
            instances,
            options.preferences,
            options.profileId,
        );

        for (const candidate of candidates) {
            if (exploredNodes >= nodeBudget) {
                reachedSearchLimit = true;
                break;
            }

            exploredNodes += 1;

            if (!validatePlacement(candidate, room, placements).valid) continue;

            const result = search(index + 1, [...placements, candidate]);
            if (result) return result;
        }

        return null;
    };

    const placements = search(0, []);

    if (placements) {
        return {
            status: "success",
            placements,
            exploredNodes,
            score: finalScore(room, placements, options.profileId),
            notes:
                televisions.length > 0 && targetCategory
                    ? [
                          targetCategory === "living"
                              ? `ТВ направлен на диван; расчётное расстояние — ${TV_VIEWING_GAP} мм.`
                              : "ТВ направлен на кровать; расстояние будет уточнено после согласования формулы.",
                      ]
                    : [],
        };
    }

    const failedInstance = orderedInstances[deepestIndex];
    const optionalByRemovalPriority = orderedInstances
        .filter((instance) => !instance.required)
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
        reachedSearchLimit ? "search-limit" : "no-layout",
        reachedSearchLimit
            ? "Комбинация слишком плотная для быстрого расчёта. Уберите один необязательный предмет или увеличьте комнату."
            : "Для выбранного набора не удалось сохранить проходы, связи и доступ ко всей мебели.",
        exploredNodes,
        deepestPlacements,
        blockingInstanceIds,
    );
};

export const solveRoom = (
    room: Room,
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
): LayoutResult =>
    solveRoomInternal(room, instances, {
        preferences,
        profileId: "balanced",
        maxSearchNodes: MAX_SEARCH_NODES,
    });

const profileLabel = (profileId: LayoutVariantProfileId): string => {
    switch (profileId) {
        case "daylight":
            return "Больше света";
        case "open-center":
            return "Свободный центр";
        case "perimeter":
            return "По периметру";
        default:
            return "Сбалансированный";
    }
};

const profileForLayout = (
    profileId: LayoutVariantProfileId,
    room: Room,
    placements: Placement[],
): LayoutVariantProfile => {
    const windowPreferredItems = placements.filter(
        (placement) => windowPreferenceScore(placement, room) < 0,
    ).length;
    const perimeterItems = placements.filter((placement) => {
        const geometry = getRotatedGeometry(
            getFurniture(placement.definitionId),
            placement.rotation,
        );
        return (
            placement.x === 0 ||
            placement.y === 0 ||
            placement.x + geometry.width === room.width ||
            placement.y + geometry.depth === room.depth
        );
    }).length;
    const roomCenter = { x: room.width / 2, y: room.depth / 2 };
    const centerClearance = placements.length
        ? Math.round(
              Math.min(
                  ...placements.flatMap((placement) =>
                      getWorldBodyRects(placement).map((rect) => {
                          const dx = Math.max(
                              rect.x - roomCenter.x,
                              0,
                              roomCenter.x - (rect.x + rect.width),
                          );
                          const dy = Math.max(
                              rect.y - roomCenter.y,
                              0,
                              roomCenter.y - (rect.y + rect.depth),
                          );
                          return Math.hypot(dx, dy);
                      }),
                  ),
              ),
          )
        : Math.round(Math.min(room.width, room.depth) / 2);

    return {
        id: profileId,
        label: profileLabel(profileId),
        windowPreferredItems,
        perimeterItems,
        centerClearance,
    };
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
    const signatures = new Set<string>();
    let exploredNodes = 0;
    let firstFailure: LayoutFailure | null = null;

    for (const profileId of VARIANT_PROFILE_IDS) {
        if (variants.length >= requestedLimit || exploredNodes >= MAX_VARIANT_SEARCH_NODES) break;

        const remainingNodeBudget = MAX_VARIANT_SEARCH_NODES - exploredNodes;
        if (remainingNodeBudget <= 0) break;

        const result = solveRoomInternal(room, instances, {
            preferences,
            profileId,
            maxSearchNodes: Math.min(MAX_SEARCH_NODES, remainingNodeBudget),
            excludedSignatures: signatures,
        });
        exploredNodes += Math.min(result.exploredNodes, remainingNodeBudget);

        if (result.status === "failure") {
            firstFailure ??= result;
            if (result.reason === "invalid-room" || result.exploredNodes === 0) break;
            continue;
        }

        const signature = layoutSignature(result.placements);
        if (signatures.has(signature)) continue;
        signatures.add(signature);

        variants.push({
            ...result,
            variantId: `${profileId}-${variants.length + 1}`,
            profile: profileForLayout(profileId, room, result.placements),
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
        firstFailure ?? failure("no-layout", "Не удалось построить варианты планировки.");
    return { ...result, exploredNodes, variants: [] };
};

export const solveWithAutomaticRemoval = (
    room: Room,
    instances: FurnitureInstance[],
    preferences: LayoutPreferences = {},
): AutoRemovalResult => {
    let remaining = [...instances];
    const removedInstances: FurnitureInstance[] = [];
    let result = solveRoom(room, remaining, preferences);

    while (result.status === "failure" && result.reason !== "invalid-room") {
        const nextToRemove = remaining
            .filter((instance) => !instance.required)
            .sort(
                (first, second) =>
                    getFurniture(first.definitionId).removalPriority -
                    getFurniture(second.definitionId).removalPriority,
            )[0];

        if (!nextToRemove) break;

        remaining = remaining.filter((instance) => instance.instanceId !== nextToRemove.instanceId);
        removedInstances.push(nextToRemove);
        result = solveRoom(room, remaining, preferences);
    }

    return { result, removedInstances };
};
