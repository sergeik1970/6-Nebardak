export { ROOM_LAB_CURATED_CASES, getRoomLabCase } from "./cases/curated";
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
