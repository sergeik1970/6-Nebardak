import { describe, expect, it } from "vitest";
import type { FurnitureInstance, LayoutVariant, Placement, Room } from "../types";
import { computeRoomLabMetrics } from "./metrics";
import {
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
import type { RoomLabCase, RoomLabExecution } from "./types";

const instance = (instanceId: string, definitionId: string): FurnitureInstance => ({
    instanceId,
    definitionId,
    priority: "required",
    required: true,
});

const placement = (
    instanceId: string,
    definitionId: string,
    x: number,
    y: number,
    rotation: Placement["rotation"] = 0,
): Placement => ({ instanceId, definitionId, x, y, rotation });

const roomCase = (
    room: Room,
    instances: FurnitureInstance[],
    requestedVariants: 1 | 2 | 3 = 1,
): RoomLabCase => ({
    id: "quality-test",
    title: "Quality test",
    description: "Synthetic boundary fixture.",
    source: "curated",
    tags: ["quality-test"],
    room,
    instances,
    requestedVariants,
    expectation: {
        allowedStatuses: ["success"],
        requiredPredicates: [],
    },
});

const successExecution = (
    placements: Placement[],
    variants: LayoutVariant[] = [],
): RoomLabExecution => ({
    status: "success",
    message: "",
    placements,
    variants,
    exploredNodes: 0,
    durationMs: 0,
    removedInstances: [],
    removalResultStatus: null,
});

const variant = (
    variantId: string,
    placements: Placement[],
    profileId: LayoutVariant["profile"]["id"],
): LayoutVariant => ({
    status: "success",
    variantId,
    placements,
    exploredNodes: 0,
    score: 0,
    notes: [],
    profile: {
        id: profileId,
        label: variantId,
        windowPreferredItems: 0,
        perimeterItems: placements.length,
        centerClearance: 0,
    },
});

describe("room-lab quality boundaries", () => {
    it("keeps distance and spread thresholds explicit at their boundary", () => {
        expect(isOrphanDistance(ROOM_LAB_QUALITY_THRESHOLDS.orphanDistanceMm)).toBe(false);
        expect(isOrphanDistance(ROOM_LAB_QUALITY_THRESHOLDS.orphanDistanceMm + 0.01)).toBe(true);
        expect(isStorageOutsideZone(ROOM_LAB_QUALITY_THRESHOLDS.storageZoneDistanceMm)).toBe(false);
        expect(isStorageOutsideZone(ROOM_LAB_QUALITY_THRESHOLDS.storageZoneDistanceMm + 0.01)).toBe(
            true,
        );
        expect(isZoneScatter(ROOM_LAB_QUALITY_THRESHOLDS.zoneScatterRatio)).toBe(false);
        expect(isZoneScatter(ROOM_LAB_QUALITY_THRESHOLDS.zoneScatterRatio + 0.01)).toBe(true);
    });

    it("treats weak-axis and center-barrier limits as inclusive warning boundaries", () => {
        expect(isWeakTvAxis(ROOM_LAB_QUALITY_THRESHOLDS.weakTvAxisRatio - 0.01)).toBe(false);
        expect(isWeakTvAxis(ROOM_LAB_QUALITY_THRESHOLDS.weakTvAxisRatio)).toBe(true);
        expect(
            isCenterBarrierCoverage(ROOM_LAB_QUALITY_THRESHOLDS.centerBarrierCoverageRatio - 0.01),
        ).toBe(false);
        expect(
            isCenterBarrierCoverage(ROOM_LAB_QUALITY_THRESHOLDS.centerBarrierCoverageRatio),
        ).toBe(true);
    });

    it("uses both clustering and balance at empty-space boundaries", () => {
        expect(
            isCornerConcentration(
                ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumEnvelopeRatio,
                ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumBalance,
            ),
        ).toBe(true);
        expect(
            isCornerConcentration(
                ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumEnvelopeRatio + 0.01,
                ROOM_LAB_QUALITY_THRESHOLDS.cornerMaximumBalance,
            ),
        ).toBe(false);
        expect(
            isOversizedEmptyRegion(
                3,
                ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumEnvelopeRatio,
                ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumBalance,
            ),
        ).toBe(true);
        expect(
            isOversizedEmptyRegion(
                3,
                ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumEnvelopeRatio,
                ROOM_LAB_QUALITY_THRESHOLDS.oversizedEmptyMaximumBalance + 0.01,
            ),
        ).toBe(false);
    });

    it("detects two independent functional zones concentrated in one corner", () => {
        const syntheticCase = roomCase(
            { width: 10_000, depth: 8000, doors: [], windows: [], radiators: [] },
            [instance("bed", "double-bed"), instance("sofa", "sofa-two")],
        );
        const placements = [
            placement("bed", "double-bed", 0, 0),
            placement("sofa", "sofa-two", 1900, 0),
        ];
        const execution = successExecution(placements);
        const metrics = computeRoomLabMetrics(syntheticCase, execution);

        expect(isCornerPile(syntheticCase, placements, metrics)).toBe(true);
    });

    it("measures a transverse center barrier from merged body projections", () => {
        const syntheticCase = roomCase(
            {
                width: 5000,
                depth: 5000,
                doors: [
                    {
                        id: "door",
                        wall: "top",
                        offset: 2050,
                        width: 900,
                        clearanceDepth: 900,
                    },
                ],
                windows: [],
                radiators: [],
            },
            [instance("bed", "double-bed"), instance("sofa", "sofa-three")],
        );
        const coverage = centerBarrierCoverage(syntheticCase, [
            placement("sofa", "sofa-three", 0, 2000),
            placement("bed", "double-bed", 2200, 2000),
        ]);

        expect(coverage).toBe(0.8);
        expect(isCenterBarrierCoverage(coverage)).toBe(true);
    });

    it("stores unavailable metrics as not-applicable instead of zero", () => {
        const syntheticCase = roomCase(
            { width: 5000, depth: 4000, doors: [], windows: [], radiators: [] },
            [instance("tv", "tv")],
        );
        const metrics = computeRoomLabMetrics(syntheticCase, {
            ...successExecution([]),
            status: "invalid-request",
        });

        expect(metrics.tvViewingDistanceMm).toEqual({
            status: "not-applicable",
            value: null,
            unit: "mm",
        });
        expect(metrics.livingCompositionScore.status).toBe("not-applicable");
    });

    it("flags a requested third topology when only two structural variants exist", () => {
        const syntheticCase = roomCase(
            { width: 6000, depth: 5000, doors: [], windows: [], radiators: [] },
            [instance("bed", "double-bed")],
            3,
        );
        const first = [placement("bed", "double-bed", 0, 0)];
        const second = [placement("bed", "double-bed", 4200, 0)];
        const execution = successExecution(first, [
            variant("balanced-1", first, "balanced"),
            variant("open-center-2", second, "open-center"),
        ]);
        const metrics = computeRoomLabMetrics(syntheticCase, execution);
        const findings = collectRoomLabFindings(syntheticCase, execution, metrics);

        expect(metrics.variantTopologyCount).toMatchObject({ status: "measured", value: 2 });
        expect(findings.map((finding) => finding.code)).toContain("variants-too-similar");
    });
});
