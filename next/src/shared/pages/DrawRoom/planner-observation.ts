import type { PlannerObservationCreateInput } from "@/services/plannerObservationService";
import {
    buildPlanSpecification,
    validateLayout,
    type FurnitureInstance,
    type FurniturePriority,
    type LayoutPreferences,
    type LayoutVariantProfile,
    type Placement,
    type Room,
} from "@/shared/lib/furniture-planner";

export const WORKING_CORE_OBSERVATION_ID = "working-core";

export interface PlannerObservationTarget {
    id: string;
    placements: Placement[];
    exploredNodes: number;
    score: number;
    notes: string[];
    solverStatus: "success" | "partial";
    profile?: LayoutVariantProfile;
    workingCore?: {
        requestedItemCount: number;
        unplacedInstanceIds: string[];
    };
}

const snapshotRoom = (room: Room): Room => ({
    ...room,
    ...(room.geometry?.kind === "orthogonal"
        ? {
              geometry: {
                  ...room.geometry,
                  vertices: room.geometry.vertices.map((vertex) => ({ ...vertex })),
              },
          }
        : room.geometry
          ? { geometry: { ...room.geometry } }
          : {}),
    doors: room.doors.map((door) => ({ ...door })),
    windows: room.windows.map((window) => ({ ...window })),
    radiators: (room.radiators ?? []).map((radiator) => ({ ...radiator })),
});

const createObservationClientId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `planner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** A compact diagnostic key. The immutable JSON snapshots remain the source of truth. */
const createObservationFingerprint = (value: string): string => {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
};

export const createPlannerObservationRequests = ({
    room,
    selection,
    priorities,
    preferences,
    instances,
    targets,
    generatedAt,
    inputSignature,
}: {
    room: Room;
    selection: Record<string, number>;
    priorities: Record<string, FurniturePriority>;
    preferences: LayoutPreferences;
    instances: FurnitureInstance[];
    targets: PlannerObservationTarget[];
    generatedAt: string;
    inputSignature: string;
}): Record<string, PlannerObservationCreateInput> =>
    Object.fromEntries(
        targets.flatMap((target) => {
            const validation = validateLayout(room, target.placements, preferences);
            if (!validation.valid) return [];

            const specification = buildPlanSpecification({
                room,
                placements: target.placements,
                priorities,
                validation,
                generatedAt,
            });
            const layoutSnapshot = {
                schemaVersion: "stylefinder-planner-observation-v1",
                variant: {
                    variantId: target.id,
                    ...(target.profile ? { profile: { ...target.profile } } : {}),
                    placements: target.placements.map((placement) => ({ ...placement })),
                    exploredNodes: target.exploredNodes,
                    score: target.score,
                    notes: [...target.notes],
                },
                ...(target.workingCore
                    ? {
                          workingCore: {
                              requestedItemCount: target.workingCore.requestedItemCount,
                              placedItemCount: target.placements.length,
                              unplacedInstanceIds: [...target.workingCore.unplacedInstanceIds],
                          },
                      }
                    : {}),
                validation: {
                    valid: validation.valid,
                    issues: validation.issues.map((issue) => ({
                        ...issue,
                        instanceIds: [...issue.instanceIds],
                    })),
                },
                specification,
            };
            const exactLayout = JSON.stringify({
                placements: layoutSnapshot.variant.placements,
                ...(target.workingCore ? { workingCore: layoutSnapshot.workingCore } : {}),
            });

            return [
                [
                    target.id,
                    {
                        clientObservationId: createObservationClientId(),
                        inputSnapshot: {
                            schemaVersion: "stylefinder-planner-observation-v1",
                            generatedAt,
                            room: snapshotRoom(room),
                            selection: { ...selection },
                            priorities: { ...priorities },
                            preferences: { ...preferences },
                            furniture: instances.map((instance) => ({ ...instance })),
                        },
                        layoutSnapshot,
                        inputFingerprint: createObservationFingerprint(inputSignature),
                        layoutFingerprint: createObservationFingerprint(exactLayout),
                        algorithmVersion: specification.algorithmVersion,
                        catalogVersion: specification.catalogRevision,
                        solverStatus: target.solverStatus,
                    } satisfies PlannerObservationCreateInput,
                ],
            ];
        }),
    );
