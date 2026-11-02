export {
    ROOM_BENCHMARK_VARIANT_MIN_AREA_M2,
    ROOM_BENCHMARK_VERSION,
    compareRoomBenchmark,
    createRoomBenchmarkReport,
    renderRoomBenchmarkMarkdown,
    runRoomBenchmarkCase,
} from "./benchmark";
export type {
    RoomBenchmarkComparison,
    RoomBenchmarkRecord,
    RoomBenchmarkReport,
    RoomBenchmarkRun,
    RoomBenchmarkTotals,
} from "./benchmark";
export { ROOM_LAB_CURATED_CASES, getRoomLabCase } from "./cases/curated";
export {
    ROOM_BENCHMARK_KINDS,
    ROOM_BENCHMARK_SCENARIOS,
    ROOM_LAB_GENERATED_CASES,
} from "./cases/generated";
export { renderRoomLabContactSheet } from "./contact-sheet";
export type { RoomLabAssetDataUrls } from "./contact-sheet";
export { evaluateRoomLab, evaluateRoomLabCase } from "./evaluate";
export { computeRoomLabMetrics } from "./metrics";
export {
    ROOM_LAB_QUALITY_THRESHOLDS,
    centerBarrierCoverage,
    collectRoomLabFindings,
    isCenterBarrierCoverage,
    isCornerConcentration,
    isCornerPile,
    isOrphanDistance,
    isOversizedEmptyRegion,
    isStorageOutsideZone,
    isWeakTvAxis,
    isZoneScatter,
} from "./quality";
export { createRoomLabReport, renderRoomLabMarkdown } from "./report";
export type {
    RoomLabCase,
    RoomLabCaseResult,
    RoomLabExpectedStatus,
    RoomLabFinding,
    RoomLabFindingCode,
    RoomLabMetrics,
    RoomLabPredicate,
    RoomLabPredicateResult,
    RoomLabReport,
} from "./types";
