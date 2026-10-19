import { FURNITURE_CATALOG } from "../../lib/furniture-planner/catalog";
import {
    FurniturePriority,
    LayoutResult,
    LayoutPreferences,
    RemovalRecord,
    Room,
} from "../../lib/furniture-planner/types";
import { canonicalRoomGeometry } from "../../lib/furniture-planner/room-geometry";

const canonicalRoomForSignature = (room: Room) => ({
    width: room.width,
    depth: room.depth,
    geometry:
        canonicalRoomGeometry(room).kind === "rect"
            ? { version: 1, kind: "rect" as const }
            : {
                  version: 1,
                  kind: "orthogonal" as const,
                  vertices:
                      room.geometry?.kind === "orthogonal"
                          ? room.geometry.vertices.map((vertex) => ({ ...vertex }))
                          : [],
              },
    partitions: [...(room.partitions ?? [])]
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((partition) => ({
            id: partition.id,
            start: { ...partition.start },
            end: { ...partition.end },
            thickness: partition.thickness,
        })),
    doors: [...room.doors]
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((door) => ({
            id: door.id,
            wall: door.wall,
            segmentId: door.segmentId ?? `rect-${door.wall}`,
            partitionId: door.partitionId ?? null,
            offset: door.offset,
            width: door.width,
            clearanceDepth: door.clearanceDepth,
            hinge: door.hinge ?? "start",
            swingDirection: door.swingDirection ?? "inward",
            doorKind: door.doorKind ?? "room",
        })),
    windows: [...room.windows]
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((window) => ({
            id: window.id,
            wall: window.wall,
            segmentId: window.segmentId ?? `rect-${window.wall}`,
            offset: window.offset,
            width: window.width,
            windowKind: window.windowKind ?? "standard",
        })),
    radiators: [...(room.radiators ?? [])]
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((radiator) => ({
            id: radiator.id,
            wall: radiator.wall,
            segmentId: radiator.segmentId ?? `rect-${radiator.wall}`,
            offset: radiator.offset,
            width: radiator.width,
            depth: radiator.depth,
            clearanceDepth: radiator.clearanceDepth,
        })),
});

export const buildPlannerSelectionSignature = (
    room: Room,
    selection: Record<string, number>,
    priorities: Record<string, FurniturePriority>,
    preferences: LayoutPreferences,
    removedInstanceIds: string[] = [],
): string =>
    JSON.stringify({
        room: canonicalRoomForSignature(room),
        selection: FURNITURE_CATALOG.map((definition) => [
            definition.id,
            selection[definition.id] ?? 0,
            priorities[definition.id] ?? "preferred",
        ]),
        preferences,
        removedInstanceIds: [...removedInstanceIds].sort(),
    });

export const canApplyAutomaticRemovalProposal = ({
    proposalSignature,
    currentSignature,
    removedItems,
    priorities,
}: {
    proposalSignature: string;
    currentSignature: string;
    removedItems: RemovalRecord[];
    priorities: Record<string, FurniturePriority>;
}): boolean =>
    proposalSignature === currentSignature &&
    removedItems.length > 0 &&
    removedItems.every((record) => (priorities[record.definitionId] ?? "preferred") === "optional");

/** A failed solver result may contain a partial diagnostic branch. It is never a plan. */
export const shouldShowPlannerLayout = ({
    isStale,
    result,
}: {
    isStale: boolean;
    result: Pick<LayoutResult, "status">;
}): boolean => !isStale && result.status === "success";

interface IdentifiedFurniture {
    instanceId: string;
    definitionId: string;
}

export const layoutMatchesFurnitureInstances = (
    instances: IdentifiedFurniture[],
    placements: IdentifiedFurniture[],
): boolean => {
    if (instances.length !== placements.length) return false;
    const placementById = new Map(
        placements.map((placement) => [placement.instanceId, placement.definitionId]),
    );
    if (placementById.size !== placements.length) return false;
    return instances.every(
        (instance) => placementById.get(instance.instanceId) === instance.definitionId,
    );
};
