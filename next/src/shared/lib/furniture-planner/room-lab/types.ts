import type { SolverSearchOptions } from "../solver";
import type {
    FurnitureInstance,
    LayoutPreferences,
    LayoutVariant,
    Placement,
    Room,
} from "../types";

export type RoomLabCaseSource = "curated" | "real" | "generated" | "regression";

export type RoomLabExpectedStatus =
    | "success"
    | "proven-impossible"
    | "search-exhausted"
    | "invalid-room"
    | "invalid-request"
    | "access-unverified";

export type RoomLabFunctionalZone = "living" | "sleep" | "work";

export type RoomLabPredicate =
    | { kind: "layout-valid" }
    | { kind: "all-selected-items-placed" }
    | { kind: "connected-access"; minimumMm: number }
    | { kind: "living-block-coherent" }
    | { kind: "sleep-block-coherent" }
    | { kind: "work-block-coherent" }
    | { kind: "desk-near-window"; maximumMm: number }
    | { kind: "dresser-away-from-window"; minimumMm: number }
    | { kind: "tv-faces-target"; target: "living" | "sleep" }
    | { kind: "tv-on-long-wall" }
    | {
          kind: "zones-separated";
          first: RoomLabFunctionalZone;
          second: RoomLabFunctionalZone;
          minimumMm: number;
      }
    | { kind: "variants-structurally-unique"; minimumCount: number }
    | { kind: "deterministic" }
    | { kind: "maximum-runtime"; milliseconds: number };

export type RoomLabFindingCode =
    | "corner-pile"
    | "zone-scatter"
    | "orphan-item"
    | "oversized-empty-region"
    | "center-barrier"
    | "weak-tv-axis"
    | "storage-outside-zone"
    | "variants-too-similar"
    | "explanation-mismatch"
    | "asset-geometry-mismatch"
    | "unreasonable-removal"
    | "false-incompatibility"
    | "runtime-regression";

export type RoomLabMetricUnit = "mm" | "ratio" | "score" | "count";

export type RoomLabMetric =
    | {
          status: "measured";
          value: number;
          unit: RoomLabMetricUnit;
      }
    | {
          status: "not-applicable";
          value: null;
          unit: RoomLabMetricUnit;
      };

export interface RoomLabBlockMetric {
    kind: RoomLabFunctionalZone;
    anchorInstanceId: string;
    memberInstanceIds: string[];
    spreadRatio: number;
    maximumMemberGapMm: number;
}

export interface RoomLabZoneSeparationMetric {
    first: RoomLabFunctionalZone;
    second: RoomLabFunctionalZone;
    distanceMm: number;
}

export interface RoomLabMetrics {
    livingCompositionScore: RoomLabMetric;
    sleepStorageCohesion: RoomLabMetric;
    workStorageCohesion: RoomLabMetric;
    tvViewingDistanceMm: RoomLabMetric;
    tvCrossAxisOffsetMm: RoomLabMetric;
    tvAxisOffsetRatio: RoomLabMetric;
    coffeeTableGapMm: RoomLabMetric;
    bedsideTableGapMm: RoomLabMetric;
    dresserToBedMm: RoomLabMetric;
    bookcaseToDeskMm: RoomLabMetric;
    deskToWindowMm: RoomLabMetric;
    occupiedBodyAreaRatio: RoomLabMetric;
    occupiedEnvelopeAreaRatio: RoomLabMetric;
    freeSpaceBalance: RoomLabMetric;
    variantTopologyCount: RoomLabMetric;
    functionalBlocks: RoomLabBlockMetric[];
    zoneSeparations: RoomLabZoneSeparationMetric[];
}

export interface RoomLabFinding {
    code: RoomLabFindingCode;
    severity: "warning" | "info";
    message: string;
    instanceIds: string[];
    measuredValue?: number;
    threshold?: number;
}

export interface RoomLabCase {
    id: string;
    title: string;
    description: string;
    source: RoomLabCaseSource;
    tags: string[];
    room: Room;
    instances: FurnitureInstance[];
    preferences?: LayoutPreferences;
    requestedVariants: 1 | 2 | 3;
    expectation: {
        allowedStatuses: RoomLabExpectedStatus[];
        requiredPredicates: RoomLabPredicate[];
        forbiddenFindings?: RoomLabFindingCode[];
        expectedRemoval?: {
            allowedDefinitionIds: string[];
            maximumCount: number;
        };
    };
    provenance?: {
        reference?: string;
        note?: string;
    };
    /** Operational overrides used only by explicit boundary cases such as NG-04. */
    solverOptions?: SolverSearchOptions;
}

export interface RoomLabPredicateResult {
    predicate: RoomLabPredicate;
    passed: boolean;
    message: string;
}

export interface RoomLabExecution {
    status: RoomLabExpectedStatus;
    message: string;
    placements: Placement[];
    variants: LayoutVariant[];
    exploredNodes: number;
    durationMs: number;
    removedInstances: FurnitureInstance[];
    removalResultStatus: RoomLabExpectedStatus | null;
}

export interface RoomLabCaseResult {
    caseId: string;
    title: string;
    passed: boolean;
    statusAllowed: boolean;
    removalAllowed: boolean;
    execution: RoomLabExecution;
    predicates: RoomLabPredicateResult[];
    metrics: RoomLabMetrics;
    findings: RoomLabFinding[];
}

export interface RoomLabReport {
    schemaVersion: 3;
    generatedAt: string;
    summary: {
        total: number;
        passed: number;
        failed: number;
        totalDurationMs: number;
        casesWithFindings: number;
        findingCounts: Partial<Record<RoomLabFindingCode, number>>;
    };
    cases: RoomLabCaseResult[];
}
