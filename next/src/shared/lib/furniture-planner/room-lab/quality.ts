import { getFurniture } from "../catalog";
import { getBounds, getWorldBodyRects, wallForBack } from "../geometry";
import {
    explainLayoutForProfile,
    getFunctionalBlocks,
    getLayoutStructureSignature,
    isPlacementNearPreferredWindow,
} from "../solver";
import type { Placement, Rect } from "../types";
import { placementsForZone, rectGap } from "./metrics";
import type {
    RoomLabCase,
    RoomLabExecution,
    RoomLabFinding,
    RoomLabFunctionalZone,
    RoomLabMetrics,
} from "./types";

export const ROOM_LAB_QUALITY_THRESHOLDS = {
    orphanDistanceMm: 4500,
    storageZoneDistanceMm: 3000,
    zoneScatterRatio: 8,
    weakTvAxisRatio: 0.75,
    cornerSectorRatio: 0.35,
    cornerMaximumEnvelopeRatio: 0.45,
    cornerMaximumBalance: 0.55,
    oversizedEmptyMaximumEnvelopeRatio: 0.35,
    oversizedEmptyMaximumBalance: 0.65,
    centerBarrierCoverageRatio: 0.7,
} as const;

export const isOrphanDistance = (distanceMm: number): boolean =>
    distanceMm > ROOM_LAB_QUALITY_THRESHOLDS.orphanDistanceMm;

export const isStorageOutsideZone = (distanceMm: number): boolean =>
    distanceMm > ROOM_LAB_QUALITY_THRESHOLDS.storageZoneDistanceMm;

export const isZoneScatter = (spreadRatio: number): boolean =>
    spreadRatio > ROOM_LAB_QUALITY_THRESHOLDS.zoneScatterRatio;

export const isWeakTvAxis = (axisOffsetRatio: number): boolean =>
    axisOffsetRatio >= ROOM_LAB_QUALITY_THRESHOLDS.weakTvAxisRatio;

export const isCenterBarrierCoverage = (coverageRatio: number): boolean =>
    coverageRatio >= ROOM_LAB_QUALITY_THRESHOLDS.centerBarrierCoverageRatio;

const measuredValue = (metric: RoomLabMetrics[keyof RoomLabMetrics]): number | null =>
    typeof metric === "object" &&
    metric !== null &&
    "status" in metric &&
    metric.status === "measured"
        ? metric.value
        : null;

const placementCenter = (placements: Placement[]): { x: number; y: number } | null => {
    const bodyRects = placements.flatMap(getWorldBodyRects);
    if (bodyRects.length === 0) return null;
    const bounds = getBounds(bodyRects);
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.depth / 2 };
};

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const centerCorner = (center: { x: number; y: number }, roomCase: RoomLabCase): Corner | null => {
    const { cornerSectorRatio } = ROOM_LAB_QUALITY_THRESHOLDS;
    const horizontal =
        center.x <= roomCase.room.width * cornerSectorRatio
            ? "left"
            : center.x >= roomCase.room.width * (1 - cornerSectorRatio)
              ? "right"
              : null;
    const vertical =
        center.y <= roomCase.room.depth * cornerSectorRatio
            ? "top"
            : center.y >= roomCase.room.depth * (1 - cornerSectorRatio)
              ? "bottom"
              : null;
    return horizontal && vertical ? `${vertical}-${horizontal}` : null;
};

export const isCornerPile = (
    roomCase: RoomLabCase,
    placements: Placement[],
    metrics: RoomLabMetrics,
): boolean => {
    const zones: RoomLabFunctionalZone[] = ["living", "sleep", "work"];
    const corners = zones
        .map((zone) => placementCenter(placementsForZone(placements, zone)))
        .filter((center): center is { x: number; y: number } => Boolean(center))
        .map((center) => centerCorner(center, roomCase));
    const envelopeRatio = measuredValue(metrics.occupiedEnvelopeAreaRatio);
    const balance = measuredValue(metrics.freeSpaceBalance);

    return (
        corners.length >= 2 &&
        corners[0] !== null &&
        corners.every((corner) => corner === corners[0]) &&
        isCornerConcentration(envelopeRatio, balance)
    );
};

export const isCornerConcentration = (
    envelopeRatio: number | null,
    balance: number | null,
): boolean =>
    envelopeRatio !== null &&
    envelopeRatio <= ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumEnvelopeRatio &&
    balance !== null &&
    balance <= ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumBalance;

export const isOversizedEmptyRegion = (
    placementCount: number,
    envelopeRatio: number | null,
    balance: number | null,
): boolean =>
    placementCount >= 3 &&
    envelopeRatio !== null &&
    envelopeRatio <= ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumEnvelopeRatio &&
    balance !== null &&
    balance <= ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumBalance;

interface AxisInterval {
    start: number;
    end: number;
}

const mergedIntervalCoverage = (intervals: AxisInterval[]): number => {
    const ordered = [...intervals].sort((first, second) => first.start - second.start);
    if (ordered.length === 0) return 0;
    let coverage = 0;
    let currentStart = ordered[0].start;
    let currentEnd = ordered[0].end;

    ordered.slice(1).forEach((interval) => {
        if (interval.start <= currentEnd) {
            currentEnd = Math.max(currentEnd, interval.end);
            return;
        }
        coverage += currentEnd - currentStart;
        currentStart = interval.start;
        currentEnd = interval.end;
    });

    return coverage + currentEnd - currentStart;
};

const rectIntersectsBand = (rect: Rect, axis: "x" | "y", start: number, end: number): boolean =>
    axis === "x"
        ? rect.x < end && rect.x + rect.width > start
        : rect.y < end && rect.y + rect.depth > start;

export const centerBarrierCoverage = (roomCase: RoomLabCase, placements: Placement[]): number => {
    const bodyRects = placements.flatMap(getWorldBodyRects);
    if (roomCase.room.doors.length === 0 || placements.length < 2) return 0;

    return Math.max(
        ...roomCase.room.doors.map((door) => {
            const entersVertically = door.wall === "top" || door.wall === "bottom";
            const bandAxis = entersVertically ? "y" : "x";
            const bandLength = entersVertically ? roomCase.room.depth : roomCase.room.width;
            const projectionLength = entersVertically ? roomCase.room.width : roomCase.room.depth;
            const bandStart = bandLength * 0.35;
            const bandEnd = bandLength * 0.65;
            const intervals = bodyRects
                .filter((rect) => rectIntersectsBand(rect, bandAxis, bandStart, bandEnd))
                .map((rect) =>
                    entersVertically
                        ? {
                              start: Math.max(0, rect.x),
                              end: Math.min(roomCase.room.width, rect.x + rect.width),
                          }
                        : {
                              start: Math.max(0, rect.y),
                              end: Math.min(roomCase.room.depth, rect.y + rect.depth),
                          },
                )
                .filter((interval) => interval.end > interval.start);
            return mergedIntervalCoverage(intervals) / Math.max(projectionLength, 1);
        }),
    );
};

const storageFindings = (roomCase: RoomLabCase, placements: Placement[]): RoomLabFinding[] => {
    const placementById = new Map(placements.map((placement) => [placement.instanceId, placement]));
    const findings: RoomLabFinding[] = [];

    getFunctionalBlocks(roomCase.instances, roomCase.preferences).forEach((block) => {
        const anchor = placementById.get(block.anchorInstanceId);
        if (!anchor) return;
        block.memberInstanceIds.forEach((instanceId) => {
            const member = placementById.get(instanceId);
            if (!member || !["dresser", "bookcase"].includes(member.definitionId)) return;
            const distance = rectGap(
                getBounds(getWorldBodyRects(member)),
                getBounds(getWorldBodyRects(anchor)),
            );

            if (isStorageOutsideZone(distance)) {
                findings.push({
                    code: "storage-outside-zone",
                    severity: "warning",
                    message: `${getFurniture(member.definitionId).shortLabel} находится в ${Math.round(distance)} мм от основной зоны ${block.kind}.`,
                    instanceIds: [member.instanceId, anchor.instanceId],
                    measuredValue: Math.round(distance),
                    threshold: ROOM_LAB_QUALITY_THRESHOLDS.storageZoneDistanceMm,
                });
            }
            if (isOrphanDistance(distance)) {
                findings.push({
                    code: "orphan-item",
                    severity: "warning",
                    message: `${getFurniture(member.definitionId).shortLabel} выглядит отдельным от своего функционального блока.`,
                    instanceIds: [member.instanceId, anchor.instanceId],
                    measuredValue: Math.round(distance),
                    threshold: ROOM_LAB_QUALITY_THRESHOLDS.orphanDistanceMm,
                });
            }
        });
    });

    return findings;
};

const explanationMismatch = (
    roomCase: RoomLabCase,
    execution: RoomLabExecution,
): RoomLabFinding | null => {
    for (const variant of execution.variants) {
        const explanation = explainLayoutForProfile(
            roomCase.room,
            variant.placements,
            variant.profile.id,
            roomCase.preferences,
        ).join(" ");
        const televisions = variant.placements.filter(
            (placement) => placement.definitionId === "tv",
        );
        const longWalls =
            roomCase.room.width >= roomCase.room.depth
                ? new Set(["top", "bottom"])
                : new Set(["left", "right"]);
        const longWallClaimMismatch =
            explanation.includes("длинной стены") &&
            !televisions.some((television) => longWalls.has(wallForBack(television.rotation)));
        const daylightClaimMismatch =
            (explanation.includes("У окна") || explanation.includes("дневной свет")) &&
            !variant.placements.some((placement) =>
                isPlacementNearPreferredWindow(placement, roomCase.room),
            );

        if (longWallClaimMismatch || daylightClaimMismatch) {
            return {
                code: "explanation-mismatch",
                severity: "warning",
                message: `Объяснение варианта ${variant.variantId} не подтверждается его геометрией.`,
                instanceIds: variant.placements.map((placement) => placement.instanceId),
            };
        }
    }
    return null;
};

export const collectRoomLabFindings = (
    roomCase: RoomLabCase,
    execution: RoomLabExecution,
    metrics: RoomLabMetrics,
): RoomLabFinding[] => {
    if (execution.status !== "success") {
        const invalidRemoval = execution.removedInstances.some(
            (removed) => removed.priority !== "optional",
        );
        return invalidRemoval
            ? [
                  {
                      code: "unreasonable-removal",
                      severity: "warning",
                      message: "Предложено удалить preferred или required предмет.",
                      instanceIds: execution.removedInstances.map(
                          (instance) => instance.instanceId,
                      ),
                  },
              ]
            : [];
    }

    const findings: RoomLabFinding[] = [...storageFindings(roomCase, execution.placements)];
    metrics.functionalBlocks
        .filter((block) => isZoneScatter(block.spreadRatio))
        .forEach((block) => {
            findings.push({
                code: "zone-scatter",
                severity: "warning",
                message: `Блок ${block.kind} растянут: envelope/body = ${block.spreadRatio}.`,
                instanceIds: [block.anchorInstanceId, ...block.memberInstanceIds],
                measuredValue: block.spreadRatio,
                threshold: ROOM_LAB_QUALITY_THRESHOLDS.zoneScatterRatio,
            });
        });

    const tvAxisRatio = measuredValue(metrics.tvAxisOffsetRatio);
    if (tvAxisRatio !== null && isWeakTvAxis(tvAxisRatio)) {
        findings.push({
            code: "weak-tv-axis",
            severity: "info",
            message: `ТВ формально направлен на цель, но поперечное смещение близко к границе (${tvAxisRatio.toFixed(2)}).`,
            instanceIds: execution.placements
                .filter((placement) => placement.definitionId === "tv")
                .map((placement) => placement.instanceId),
            measuredValue: tvAxisRatio,
            threshold: ROOM_LAB_QUALITY_THRESHOLDS.weakTvAxisRatio,
        });
    }

    const envelopeRatio = measuredValue(metrics.occupiedEnvelopeAreaRatio);
    const balance = measuredValue(metrics.freeSpaceBalance);
    if (isCornerPile(roomCase, execution.placements, metrics)) {
        findings.push({
            code: "corner-pile",
            severity: "warning",
            message: "Независимые функциональные зоны собраны в одном углу комнаты.",
            instanceIds: execution.placements.map((placement) => placement.instanceId),
            measuredValue: envelopeRatio ?? undefined,
            threshold: ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumEnvelopeRatio,
        });
    }
    if (isOversizedEmptyRegion(execution.placements.length, envelopeRatio, balance)) {
        findings.push({
            code: "oversized-empty-region",
            severity: "info",
            message:
                "Мебель образует тесный кластер, оставляя непропорционально большую пустую часть комнаты.",
            instanceIds: execution.placements.map((placement) => placement.instanceId),
            measuredValue: envelopeRatio ?? undefined,
            threshold: ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumEnvelopeRatio,
        });
    }

    const barrierCoverage = centerBarrierCoverage(roomCase, execution.placements);
    if (isCenterBarrierCoverage(barrierCoverage)) {
        findings.push({
            code: "center-barrier",
            severity: "warning",
            message: `Корпуса перекрывают ${Math.round(barrierCoverage * 100)}% поперечного центра комнаты.`,
            instanceIds: execution.placements.map((placement) => placement.instanceId),
            measuredValue: Math.round(barrierCoverage * 100) / 100,
            threshold: ROOM_LAB_QUALITY_THRESHOLDS.centerBarrierCoverageRatio,
        });
    }

    const topologyCount = measuredValue(metrics.variantTopologyCount);
    const structuralSignatures = new Set(
        execution.variants.map((variant) =>
            getLayoutStructureSignature(roomCase.room, variant.placements),
        ),
    );
    if (
        roomCase.requestedVariants > 1 &&
        (topologyCount === null ||
            topologyCount < roomCase.requestedVariants ||
            structuralSignatures.size < execution.variants.length)
    ) {
        findings.push({
            code: "variants-too-similar",
            severity: "info",
            message: `Запрошено ${roomCase.requestedVariants} топологии, найдено ${topologyCount ?? 0}.`,
            instanceIds: [],
            measuredValue: topologyCount ?? 0,
            threshold: roomCase.requestedVariants,
        });
    }

    const mismatch = explanationMismatch(roomCase, execution);
    if (mismatch) findings.push(mismatch);

    return findings.filter(
        (finding, index, values) =>
            values.findIndex(
                (candidate) =>
                    candidate.code === finding.code &&
                    candidate.instanceIds.join("|") === finding.instanceIds.join("|"),
            ) === index,
    );
};
