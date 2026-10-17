import { getFurniture } from "./catalog";
import { getRotatedGeometry } from "./geometry-shapes";
import { Placement, Room, Rotation } from "./types";

/**
 * Two layouts must move at least one item by this Euclidean distance to count
 * as visibly different. Four 50 mm keyboard steps avoid presenting a one-step
 * nudge as a separate design variant.
 */
export const NOTICEABLE_VARIANT_TOLERANCE_MM = 200;

export function getCanonicalRotation(definitionId: string, rotation: Rotation): Rotation {
    const definition = getFurniture(definitionId);
    const group = definition.equivalentRotationGroups.find((rotations) =>
        rotations.includes(rotation),
    );

    return group ? [...group].sort((first, second) => first - second)[0] ?? rotation : rotation;
}

const placementsEquivalentWithinTolerance = (
    first: Placement,
    second: Placement,
    tolerance: number,
): boolean =>
    first.definitionId === second.definitionId &&
    getCanonicalRotation(first.definitionId, first.rotation) ===
        getCanonicalRotation(second.definitionId, second.rotation) &&
    Math.hypot(first.x - second.x, first.y - second.y) < tolerance;

const groupCanBeMatched = (
    first: Placement[],
    second: Placement[],
    tolerance: number,
    index = 0,
    used = new Set<number>(),
): boolean => {
    if (index >= first.length) return true;

    return second.some((candidate, candidateIndex) => {
        if (used.has(candidateIndex)) return false;
        if (!placementsEquivalentWithinTolerance(first[index], candidate, tolerance)) return false;

        used.add(candidateIndex);
        const matched = groupCanBeMatched(first, second, tolerance, index + 1, used);
        used.delete(candidateIndex);
        return matched;
    });
};

/**
 * Instance IDs are ignored and identical definitions are matched as a set.
 * A one-grid-step nudge is therefore not advertised as another variant.
 */
export const areLayoutsNoticeablyDifferent = (
    first: Placement[],
    second: Placement[],
    tolerance = NOTICEABLE_VARIANT_TOLERANCE_MM,
): boolean => {
    if (first.length !== second.length) return true;

    const definitionIds = Array.from(
        new Set([
            ...first.map((placement) => placement.definitionId),
            ...second.map((placement) => placement.definitionId),
        ]),
    );

    for (const definitionId of definitionIds) {
        const firstGroup = first.filter((placement) => placement.definitionId === definitionId);
        const secondGroup = second.filter((placement) => placement.definitionId === definitionId);
        if (firstGroup.length !== secondGroup.length) return true;
        if (!groupCanBeMatched(firstGroup, secondGroup, tolerance)) return true;
    }

    return false;
};

/** Diagnostic bucket signature; pairwise variant comparison uses the robust
 * matcher above so values close to a bucket boundary are still deduplicated. */
export const getSemanticLayoutSignature = (placements: Placement[]): string =>
    placements
        .map(
            (placement) =>
                `${placement.definitionId}:${Math.round(
                    placement.x / NOTICEABLE_VARIANT_TOLERANCE_MM,
                )}:${Math.round(
                    placement.y / NOTICEABLE_VARIANT_TOLERANCE_MM,
                )}:${getCanonicalRotation(placement.definitionId, placement.rotation)}`,
        )
        .sort()
        .join("|");

const getPlacementStructureToken = (room: Room, placement: Placement): string => {
    const geometry = getRotatedGeometry(getFurniture(placement.definitionId), placement.rotation);
    const walls = [
        placement.y === 0 ? "top" : "",
        placement.x + geometry.width === room.width ? "right" : "",
        placement.y + geometry.depth === room.depth ? "bottom" : "",
        placement.x === 0 ? "left" : "",
    ].filter(Boolean);
    if (walls.length > 0) return `wall:${walls.join("+")}`;

    const centerX = placement.x + geometry.width / 2;
    const centerY = placement.y + geometry.depth / 2;
    const horizontalHalf = centerX < room.width / 2 ? "left" : "right";
    const verticalHalf = centerY < room.depth / 2 ? "top" : "bottom";
    return `inner:${verticalHalf}-${horizontalHalf}`;
};

/**
 * Structural identity ignores small coordinate changes and records the design
 * decision instead: wall/corner versus an interior room region and rotation.
 */
export const getLayoutStructureSignature = (room: Room, placements: Placement[]): string =>
    placements
        .map(
            (placement) =>
                `${placement.definitionId}:${getPlacementStructureToken(
                    room,
                    placement,
                )}:${getCanonicalRotation(placement.definitionId, placement.rotation)}`,
        )
        .sort()
        .join("|");

export const areLayoutsStructurallyDifferent = (
    room: Room,
    first: Placement[],
    second: Placement[],
): boolean =>
    getLayoutStructureSignature(room, first) !== getLayoutStructureSignature(room, second);
