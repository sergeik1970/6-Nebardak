import { getFurniture } from "../catalog";
import { getBounds, getWindowCurtainObstacle, getWorldBodyRects, tvFacesTarget } from "../geometry";
import { getRoomArea, getRoomCentroid } from "../room-geometry";
import {
    getFunctionalBlocks,
    getLayoutStructureSignature,
    scoreLivingComposition,
} from "../solver";
import type { FurnitureCategory, Placement, Rect } from "../types";
import type {
    RoomLabBlockMetric,
    RoomLabCase,
    RoomLabExecution,
    RoomLabFunctionalZone,
    RoomLabMetric,
    RoomLabMetricUnit,
    RoomLabMetrics,
    RoomLabZoneSeparationMetric,
} from "./types";

const measured = (value: number, unit: RoomLabMetricUnit): RoomLabMetric => ({
    status: "measured",
    value: Math.round(value * 100) / 100,
    unit,
});

const notApplicable = (unit: RoomLabMetricUnit): RoomLabMetric => ({
    status: "not-applicable",
    value: null,
    unit,
});

export const rectGap = (first: Rect, second: Rect): number => {
    const dx = Math.max(first.x - (second.x + second.width), second.x - (first.x + first.width), 0);
    const dy = Math.max(first.y - (second.y + second.depth), second.y - (first.y + first.depth), 0);
    return Math.hypot(dx, dy);
};

const placementBounds = (placement: Placement): Rect => getBounds(getWorldBodyRects(placement));

const nearestPlacementGap = (
    placements: Placement[],
    anchors: Placement[],
): { gap: number; placement: Placement; anchor: Placement } | null => {
    let nearest: { gap: number; placement: Placement; anchor: Placement } | null = null;

    placements.forEach((placement) => {
        anchors.forEach((anchor) => {
            const gap = rectGap(placementBounds(placement), placementBounds(anchor));
            if (!nearest || gap < nearest.gap) nearest = { gap, placement, anchor };
        });
    });

    return nearest;
};

const metricForNearestGap = (placements: Placement[], anchors: Placement[]): RoomLabMetric => {
    const nearest = nearestPlacementGap(placements, anchors);
    return nearest ? measured(nearest.gap, "mm") : notApplicable("mm");
};

const categoryPlacements = (
    placements: Placement[],
    categories: FurnitureCategory[],
): Placement[] =>
    placements.filter((placement) =>
        categories.includes(getFurniture(placement.definitionId).category),
    );

export const placementsForZone = (
    placements: Placement[],
    zone: RoomLabFunctionalZone,
): Placement[] =>
    placements.filter((placement) => {
        const definition = getFurniture(placement.definitionId);
        switch (zone) {
            case "living":
                return definition.category === "living" || definition.category === "media";
            case "sleep":
                return (
                    definition.category === "sleep" ||
                    definition.category === "children" ||
                    definition.id === "bedside-table" ||
                    definition.id === "dresser"
                );
            case "work":
                return definition.category === "work" || definition.id === "bookcase";
        }
    });

const centerOfPlacements = (placements: Placement[]): { x: number; y: number } | null => {
    if (placements.length === 0) return null;
    const bounds = getBounds(placements.flatMap(getWorldBodyRects));
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.depth / 2 };
};

const zoneSeparationMetrics = (placements: Placement[]): RoomLabZoneSeparationMetric[] => {
    const zones: RoomLabFunctionalZone[] = ["living", "sleep", "work"];
    const result: RoomLabZoneSeparationMetric[] = [];

    zones.forEach((first, firstIndex) => {
        const firstCenter = centerOfPlacements(placementsForZone(placements, first));
        if (!firstCenter) return;
        zones.slice(firstIndex + 1).forEach((second) => {
            const secondCenter = centerOfPlacements(placementsForZone(placements, second));
            if (!secondCenter) return;
            result.push({
                first,
                second,
                distanceMm:
                    Math.round(
                        Math.hypot(firstCenter.x - secondCenter.x, firstCenter.y - secondCenter.y) *
                            100,
                    ) / 100,
            });
        });
    });

    return result;
};

const averageCohesion = (supports: Placement[], anchors: Placement[]): RoomLabMetric => {
    if (supports.length === 0 || anchors.length === 0) return notApplicable("ratio");
    const scores = supports.map((support) => {
        const nearest = nearestPlacementGap([support], anchors);
        return nearest ? Math.max(0, 1 - nearest.gap / 3000) : 0;
    });
    return measured(scores.reduce((total, score) => total + score, 0) / scores.length, "ratio");
};

const functionalBlockMetrics = (
    roomCase: RoomLabCase,
    placements: Placement[],
): RoomLabBlockMetric[] => {
    const byInstanceId = new Map(placements.map((placement) => [placement.instanceId, placement]));

    return getFunctionalBlocks(roomCase.instances, roomCase.preferences).flatMap((block) => {
        const anchor = byInstanceId.get(block.anchorInstanceId);
        const members = block.memberInstanceIds
            .map((instanceId) => byInstanceId.get(instanceId))
            .filter((placement): placement is Placement => Boolean(placement));
        if (!anchor || members.length === 0) return [];

        const blockPlacements = [anchor, ...members];
        const bounds = getBounds(blockPlacements.flatMap(getWorldBodyRects));
        const bodyArea = blockPlacements
            .flatMap(getWorldBodyRects)
            .reduce((total, rect) => total + rect.width * rect.depth, 0);
        const memberGaps = members.map((member) =>
            rectGap(placementBounds(member), placementBounds(anchor)),
        );

        return [
            {
                kind: block.kind,
                anchorInstanceId: block.anchorInstanceId,
                memberInstanceIds: block.memberInstanceIds,
                spreadRatio:
                    Math.round(((bounds.width * bounds.depth) / Math.max(bodyArea, 1)) * 100) / 100,
                maximumMemberGapMm: Math.round(Math.max(...memberGaps) * 100) / 100,
            },
        ];
    });
};

const tvMetrics = (
    roomCase: RoomLabCase,
    placements: Placement[],
): {
    distance: RoomLabMetric;
    crossAxisOffset: RoomLabMetric;
    axisOffsetRatio: RoomLabMetric;
} => {
    const television = placements.find((placement) => placement.definitionId === "tv");
    const livingTargets = categoryPlacements(placements, ["living"]).filter(
        (placement) => placement.definitionId !== "coffee-table",
    );
    const sleepTargets = categoryPlacements(placements, ["sleep"]);
    const targetCategory =
        roomCase.preferences?.tvTargetCategory ??
        (livingTargets.length > 0 ? "living" : sleepTargets.length > 0 ? "sleep" : null);
    const targets = targetCategory === "living" ? livingTargets : sleepTargets;
    if (!television || !targetCategory || targets.length === 0) {
        return {
            distance: notApplicable("mm"),
            crossAxisOffset: notApplicable("mm"),
            axisOffsetRatio: notApplicable("ratio"),
        };
    }

    const target =
        targets.find((candidate) => tvFacesTarget(television, candidate, targetCategory)) ??
        nearestPlacementGap([television], targets)?.anchor;
    if (!target) {
        return {
            distance: notApplicable("mm"),
            crossAxisOffset: notApplicable("mm"),
            axisOffsetRatio: notApplicable("ratio"),
        };
    }

    const televisionBounds = placementBounds(television);
    const targetBounds = placementBounds(target);
    const horizontalCrossAxis = target.rotation === 0 || target.rotation === 180;
    const tvCrossCenter = horizontalCrossAxis
        ? televisionBounds.x + televisionBounds.width / 2
        : televisionBounds.y + televisionBounds.depth / 2;
    const targetCrossCenter = horizontalCrossAxis
        ? targetBounds.x + targetBounds.width / 2
        : targetBounds.y + targetBounds.depth / 2;
    const tvCrossLength = horizontalCrossAxis ? televisionBounds.width : televisionBounds.depth;
    const targetCrossLength = horizontalCrossAxis ? targetBounds.width : targetBounds.depth;
    const crossAxisOffset = Math.abs(tvCrossCenter - targetCrossCenter);
    const maximumOverlapOffset = (tvCrossLength + targetCrossLength) / 2;

    return {
        distance: measured(rectGap(televisionBounds, targetBounds), "mm"),
        crossAxisOffset: measured(crossAxisOffset, "mm"),
        axisOffsetRatio: measured(
            maximumOverlapOffset > 0 ? crossAxisOffset / maximumOverlapOffset : 0,
            "ratio",
        ),
    };
};

const nearestDeskWindowDistance = (
    roomCase: RoomLabCase,
    placements: Placement[],
): RoomLabMetric => {
    const desks = placements.filter((placement) => placement.definitionId === "desk");
    if (desks.length === 0 || roomCase.room.windows.length === 0) return notApplicable("mm");

    const distances = desks.flatMap((desk) =>
        roomCase.room.windows.map((window) =>
            rectGap(placementBounds(desk), getWindowCurtainObstacle(window, roomCase.room, 0)),
        ),
    );
    return measured(Math.min(...distances), "mm");
};

const occupancyMetrics = (
    roomCase: RoomLabCase,
    placements: Placement[],
): {
    bodyAreaRatio: RoomLabMetric;
    envelopeAreaRatio: RoomLabMetric;
    freeSpaceBalance: RoomLabMetric;
} => {
    if (placements.length === 0) {
        return {
            bodyAreaRatio: notApplicable("ratio"),
            envelopeAreaRatio: notApplicable("ratio"),
            freeSpaceBalance: notApplicable("ratio"),
        };
    }

    const bodyRects = placements.flatMap(getWorldBodyRects);
    const bodyArea = bodyRects.reduce((total, rect) => total + rect.width * rect.depth, 0);
    const bounds = getBounds(bodyRects);
    const roomArea = getRoomArea(roomCase.room);
    const roomCenter = getRoomCentroid(roomCase.room);
    const boundsCenter = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.depth / 2,
    };
    const maximumCenterDistance = Math.hypot(roomCenter.x, roomCenter.y);
    const centerDistance = Math.hypot(boundsCenter.x - roomCenter.x, boundsCenter.y - roomCenter.y);

    return {
        bodyAreaRatio: measured(bodyArea / roomArea, "ratio"),
        envelopeAreaRatio: measured((bounds.width * bounds.depth) / roomArea, "ratio"),
        freeSpaceBalance: measured(
            1 - Math.min(1, centerDistance / Math.max(maximumCenterDistance, 1)),
            "ratio",
        ),
    };
};

export const computeRoomLabMetrics = (
    roomCase: RoomLabCase,
    execution: RoomLabExecution,
): RoomLabMetrics => {
    if (execution.status !== "success") {
        return {
            livingCompositionScore: notApplicable("score"),
            sleepStorageCohesion: notApplicable("ratio"),
            workStorageCohesion: notApplicable("ratio"),
            tvViewingDistanceMm: notApplicable("mm"),
            tvCrossAxisOffsetMm: notApplicable("mm"),
            tvAxisOffsetRatio: notApplicable("ratio"),
            coffeeTableGapMm: notApplicable("mm"),
            bedsideTableGapMm: notApplicable("mm"),
            dresserToBedMm: notApplicable("mm"),
            bookcaseToDeskMm: notApplicable("mm"),
            deskToWindowMm: notApplicable("mm"),
            occupiedBodyAreaRatio: notApplicable("ratio"),
            occupiedEnvelopeAreaRatio: notApplicable("ratio"),
            freeSpaceBalance: notApplicable("ratio"),
            variantTopologyCount: notApplicable("count"),
            functionalBlocks: [],
            zoneSeparations: [],
        };
    }

    const placements = execution.placements;
    const beds = categoryPlacements(placements, ["sleep"]);
    const sofas = categoryPlacements(placements, ["living"]).filter(
        (placement) => placement.definitionId !== "coffee-table",
    );
    const desks = placements.filter((placement) => placement.definitionId === "desk");
    const dressers = placements.filter((placement) => placement.definitionId === "dresser");
    const bookcases = placements.filter((placement) => placement.definitionId === "bookcase");
    const bedsideTables = placements.filter(
        (placement) => placement.definitionId === "bedside-table",
    );
    const coffeeTables = placements.filter(
        (placement) => placement.definitionId === "coffee-table",
    );
    const tv = tvMetrics(roomCase, placements);
    const occupancy = occupancyMetrics(roomCase, placements);
    const livingScore = scoreLivingComposition(placements);
    const hasLivingBlock =
        sofas.length > 0 && (coffeeTables.length > 0 || tv.distance.status === "measured");
    const variantSignatures = new Set(
        execution.variants.map((variant) =>
            getLayoutStructureSignature(roomCase.room, variant.placements),
        ),
    );

    return {
        livingCompositionScore: hasLivingBlock
            ? measured(livingScore, "score")
            : notApplicable("score"),
        sleepStorageCohesion: averageCohesion([...dressers, ...bedsideTables], beds),
        workStorageCohesion: averageCohesion(bookcases, desks),
        tvViewingDistanceMm: tv.distance,
        tvCrossAxisOffsetMm: tv.crossAxisOffset,
        tvAxisOffsetRatio: tv.axisOffsetRatio,
        coffeeTableGapMm: metricForNearestGap(coffeeTables, sofas),
        bedsideTableGapMm: metricForNearestGap(bedsideTables, beds),
        dresserToBedMm: metricForNearestGap(dressers, beds),
        bookcaseToDeskMm: metricForNearestGap(bookcases, desks),
        deskToWindowMm: nearestDeskWindowDistance(roomCase, placements),
        occupiedBodyAreaRatio: occupancy.bodyAreaRatio,
        occupiedEnvelopeAreaRatio: occupancy.envelopeAreaRatio,
        freeSpaceBalance: occupancy.freeSpaceBalance,
        variantTopologyCount: measured(
            execution.variants.length > 0 ? variantSignatures.size : 1,
            "count",
        ),
        functionalBlocks: functionalBlockMetrics(roomCase, placements),
        zoneSeparations: zoneSeparationMetrics(placements),
    };
};
