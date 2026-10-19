import { describe, expect, it } from "vitest";

import { getRotatedGeometry, relationSatisfied, validateLayout, wallForBack } from "./geometry";
import { getFurniture } from "./catalog";
import {
    NOTICEABLE_VARIANT_TOLERANCE_MM,
    areLayoutsNoticeablyDifferent,
    areLayoutsStructurallyDifferent,
    explainLayoutForProfile,
    getCanonicalRotation,
    getCriticalAxisCoordinates,
    getFunctionalBlocks,
    getLayoutStructureSignature,
    getPreferredRelationCandidates,
    getVariantProfileIds,
    getRequiredRelationCandidates,
    getSemanticLayoutSignature,
    solveRoom,
    solveRoomVariants,
    solveWithAutomaticRemoval,
    scoreFunctionalBlockCohesion,
    scoreLayoutForProfile,
    scoreLivingComposition,
} from "./solver";
import {
    FurnitureInstance,
    FurniturePriority,
    Placement,
    RelationKind,
    Room,
    Rotation,
} from "./types";
import { applyRoomGeometry, createLRoomGeometry } from "./room-geometry";

const ROOM: Room = {
    width: 6000,
    depth: 5000,
    doors: [],
    windows: [],
    radiators: [],
};

const RELATION_ROOM: Room = {
    width: 10_000,
    depth: 10_000,
    doors: [],
    windows: [],
    radiators: [],
};

const instance = (
    instanceId: string,
    definitionId: string,
    required = false,
    priority: FurniturePriority = required ? "required" : "preferred",
): FurnitureInstance => ({ instanceId, definitionId, priority, required: priority === "required" });

const placement = (
    instanceId: string,
    definitionId: string,
    x: number,
    y: number,
    rotation: Rotation = 0,
): Placement => ({ instanceId, definitionId, x, y, rotation });

const exhaustiveGridHasValidPlacement = (room: Room, definitionId: string): boolean => {
    const definition = getFurniture(definitionId);

    return definition.rotations.some((rotation) => {
        const geometry = getRotatedGeometry(definition, rotation);
        const maximumX = room.width - geometry.width;
        const maximumY = room.depth - geometry.depth;
        if (maximumX < 0 || maximumY < 0) return false;
        const xValues = Array.from(
            new Set([
                ...Array.from({ length: Math.floor(maximumX / 50) + 1 }, (_, index) => index * 50),
                maximumX,
            ]),
        );
        const yValues = Array.from(
            new Set([
                ...Array.from({ length: Math.floor(maximumY / 50) + 1 }, (_, index) => index * 50),
                maximumY,
            ]),
        );

        return xValues.some((x) =>
            yValues.some(
                (y) =>
                    validateLayout(room, [
                        {
                            instanceId: `${definitionId}-exhaustive`,
                            definitionId,
                            x,
                            y,
                            rotation,
                        },
                    ]).valid,
            ),
        );
    });
};

interface Bounds {
    x: number;
    y: number;
    width: number;
    depth: number;
}

interface RelationCoverageCase {
    name: string;
    dependentDefinitionId: string;
    target: Placement;
    kind: Extract<RelationKind, "front-gap" | "adjacent" | "aligned-side">;
    minimumGap: number;
    maximumGap: number;
    temporarilyRequired?: boolean;
}

const placementBounds = (candidate: Placement): Bounds => {
    const geometry = getRotatedGeometry(getFurniture(candidate.definitionId), candidate.rotation);

    return {
        x: candidate.x,
        y: candidate.y,
        width: geometry.width,
        depth: geometry.depth,
    };
};

const intervalOverlap = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
): number => Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart);

const intervalGap = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
): number => Math.max(secondStart - firstEnd, firstStart - secondEnd, 0);

/** Independent geometry oracle: intentionally does not call solver relation code. */
const relationOracle = (
    candidate: Placement,
    target: Placement,
    kind: RelationCoverageCase["kind"],
    minimumGap: number,
    maximumGap: number,
): boolean => {
    const dependent = placementBounds(candidate);
    const targetBounds = placementBounds(target);
    const horizontalGap = intervalGap(
        dependent.x,
        dependent.x + dependent.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalGap = intervalGap(
        dependent.y,
        dependent.y + dependent.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );
    const horizontalOverlap = intervalOverlap(
        dependent.x,
        dependent.x + dependent.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalOverlap = intervalOverlap(
        dependent.y,
        dependent.y + dependent.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );

    if (kind === "front-gap") {
        switch (target.rotation) {
            case 90:
                return (
                    verticalOverlap > 0 &&
                    targetBounds.x - (dependent.x + dependent.width) >= minimumGap &&
                    targetBounds.x - (dependent.x + dependent.width) <= maximumGap
                );
            case 180:
                return (
                    horizontalOverlap > 0 &&
                    targetBounds.y - (dependent.y + dependent.depth) >= minimumGap &&
                    targetBounds.y - (dependent.y + dependent.depth) <= maximumGap
                );
            case 270:
                return (
                    verticalOverlap > 0 &&
                    dependent.x - (targetBounds.x + targetBounds.width) >= minimumGap &&
                    dependent.x - (targetBounds.x + targetBounds.width) <= maximumGap
                );
            default:
                return (
                    horizontalOverlap > 0 &&
                    dependent.y - (targetBounds.y + targetBounds.depth) >= minimumGap &&
                    dependent.y - (targetBounds.y + targetBounds.depth) <= maximumGap
                );
        }
    }

    const horizontalSide =
        verticalOverlap > 0 && horizontalGap >= minimumGap && horizontalGap <= maximumGap;
    const verticalSide =
        horizontalOverlap > 0 && verticalGap >= minimumGap && verticalGap <= maximumGap;
    if (kind === "adjacent") return horizontalSide || verticalSide;

    return (
        (horizontalSide &&
            (Math.abs(dependent.y - targetBounds.y) <= 50 ||
                Math.abs(dependent.y + dependent.depth - (targetBounds.y + targetBounds.depth)) <=
                    50)) ||
        (verticalSide &&
            (Math.abs(dependent.x - targetBounds.x) <= 50 ||
                Math.abs(dependent.x + dependent.width - (targetBounds.x + targetBounds.width)) <=
                    50))
    );
};

const relationSamplePlacements = (
    testCase: RelationCoverageCase,
    rotation: Rotation,
): Placement[] => {
    const dependentGeometry = getRotatedGeometry(
        getFurniture(testCase.dependentDefinitionId),
        rotation,
    );
    const targetBounds = placementBounds(testCase.target);
    const gaps = Array.from(
        new Set([
            testCase.minimumGap,
            testCase.minimumGap + 1,
            Math.round((testCase.minimumGap + testCase.maximumGap) / 2),
            testCase.maximumGap,
        ]),
    );

    if (testCase.kind === "front-gap") {
        const horizontalFacing =
            testCase.target.rotation === 90 || testCase.target.rotation === 270;
        const alongValues = horizontalFacing
            ? [
                  targetBounds.y - dependentGeometry.depth + 1,
                  targetBounds.y + 37,
                  targetBounds.y + targetBounds.depth - 1,
              ]
            : [
                  targetBounds.x - dependentGeometry.width + 1,
                  targetBounds.x + 37,
                  targetBounds.x + targetBounds.width - 1,
              ];

        return gaps.flatMap((gap) =>
            alongValues.map((along) => {
                let x = along;
                let y = along;
                switch (testCase.target.rotation) {
                    case 90:
                        x = targetBounds.x - gap - dependentGeometry.width;
                        y = along;
                        break;
                    case 180:
                        x = along;
                        y = targetBounds.y - gap - dependentGeometry.depth;
                        break;
                    case 270:
                        x = targetBounds.x + targetBounds.width + gap;
                        y = along;
                        break;
                    default:
                        x = along;
                        y = targetBounds.y + targetBounds.depth + gap;
                }

                return {
                    instanceId: `${testCase.dependentDefinitionId}-1`,
                    definitionId: testCase.dependentDefinitionId,
                    x,
                    y,
                    rotation,
                };
            }),
        );
    }

    const yValues =
        testCase.kind === "aligned-side"
            ? [
                  targetBounds.y - 50,
                  targetBounds.y + 50,
                  targetBounds.y + targetBounds.depth - dependentGeometry.depth - 50,
                  targetBounds.y + targetBounds.depth - dependentGeometry.depth + 50,
              ]
            : [
                  targetBounds.y - dependentGeometry.depth + 1,
                  targetBounds.y + 37,
                  targetBounds.y + targetBounds.depth - 1,
              ];

    const xValues =
        testCase.kind === "aligned-side"
            ? [
                  targetBounds.x - 50,
                  targetBounds.x + 50,
                  targetBounds.x + targetBounds.width - dependentGeometry.width - 50,
                  targetBounds.x + targetBounds.width - dependentGeometry.width + 50,
              ]
            : [
                  targetBounds.x - dependentGeometry.width + 1,
                  targetBounds.x + 37,
                  targetBounds.x + targetBounds.width - 1,
              ];

    return gaps.flatMap((gap) => [
        ...yValues.flatMap((y) => [
            {
                instanceId: `${testCase.dependentDefinitionId}-1`,
                definitionId: testCase.dependentDefinitionId,
                x: targetBounds.x - gap - dependentGeometry.width,
                y,
                rotation,
            },
            {
                instanceId: `${testCase.dependentDefinitionId}-1`,
                definitionId: testCase.dependentDefinitionId,
                x: targetBounds.x + targetBounds.width + gap,
                y,
                rotation,
            },
        ]),
        ...xValues.flatMap((x) => [
            {
                instanceId: `${testCase.dependentDefinitionId}-1`,
                definitionId: testCase.dependentDefinitionId,
                x,
                y: targetBounds.y - gap - dependentGeometry.depth,
                rotation,
            },
            {
                instanceId: `${testCase.dependentDefinitionId}-1`,
                definitionId: testCase.dependentDefinitionId,
                x,
                y: targetBounds.y + targetBounds.depth + gap,
                rotation,
            },
        ]),
    ]);
};

const placementKey = (candidate: Placement): string =>
    `${candidate.rotation}:${candidate.x}:${candidate.y}`;

const RELATION_COVERAGE_CASES: RelationCoverageCase[] = [
    {
        name: "adjacent",
        dependentDefinitionId: "bedside-table",
        target: {
            instanceId: "double-bed-1",
            definitionId: "double-bed",
            x: 4000,
            y: 4000,
            rotation: 0,
        },
        kind: "adjacent",
        minimumGap: 50,
        maximumGap: 100,
    },
    {
        name: "aligned-side",
        dependentDefinitionId: "cradle",
        target: {
            instanceId: "double-bed-1",
            definitionId: "double-bed",
            x: 4000,
            y: 4000,
            rotation: 0,
        },
        kind: "aligned-side",
        minimumGap: 750,
        maximumGap: 800,
        temporarilyRequired: true,
    },
    ...([0, 90, 180, 270] as const).map(
        (targetRotation): RelationCoverageCase => ({
            name: `front-gap target ${targetRotation}°`,
            dependentDefinitionId: "coffee-table",
            target: {
                instanceId: "sofa-two-1",
                definitionId: "sofa-two",
                x: 4000,
                y: 4000,
                rotation: targetRotation,
            },
            kind: "front-gap",
            minimumGap: 350,
            maximumGap: 450,
            temporarilyRequired: true,
        }),
    ),
];

const OMITTED_RELATION_BOUND_CASES: Array<{
    name: string;
    dependentDefinitionId: string;
    target: Placement;
    expectedCandidate: Placement;
    temporarilyRequired?: boolean;
}> = [
    {
        name: "adjacent",
        dependentDefinitionId: "bedside-table",
        target: {
            instanceId: "double-bed-default-adjacent",
            definitionId: "double-bed",
            x: 4000,
            y: 4000,
            rotation: 0,
        },
        expectedCandidate: {
            instanceId: "bedside-table-default",
            definitionId: "bedside-table",
            x: 3500,
            y: 4000,
            rotation: 0,
        },
    },
    {
        name: "aligned-side",
        dependentDefinitionId: "cradle",
        target: {
            instanceId: "double-bed-default-aligned",
            definitionId: "double-bed",
            x: 4000,
            y: 4000,
            rotation: 0,
        },
        expectedCandidate: {
            instanceId: "cradle-default",
            definitionId: "cradle",
            x: 5850,
            y: 4000,
            rotation: 0,
        },
        temporarilyRequired: true,
    },
    {
        name: "front-gap",
        dependentDefinitionId: "coffee-table",
        target: {
            instanceId: "sofa-two-default-front",
            definitionId: "sofa-two",
            x: 4000,
            y: 4000,
            rotation: 0,
        },
        expectedCandidate: {
            instanceId: "coffee-table-default",
            definitionId: "coffee-table",
            x: 4000,
            y: 5300,
            rotation: 0,
        },
        temporarilyRequired: true,
    },
];

describe("solver trust guarantees", () => {
    it("solves an L-room deterministically without placing furniture in the cutout", () => {
        const room = applyRoomGeometry(
            { ...ROOM, width: 6000, depth: 4600 },
            createLRoomGeometry(6000, 4600, "right"),
        );
        const requested = [instance("dresser-1", "dresser", true, "required")];

        const first = solveRoom(room, requested);
        const second = solveRoom(room, requested);

        expect(first.status).toBe("success");
        expect(second).toEqual(first);
        if (first.status !== "success") throw new Error(first.message);
        expect(validateLayout(room, first.placements).valid).toBe(true);
    });

    it("prefers one coherent living-room composition over links split across sofas", () => {
        const sofaA = placement("sofa-a", "sofa-two", 1000, 1000, 0);
        const sofaB = placement("sofa-b", "sofa-two", 5000, 1000, 0);
        const centeredTable = placement("table", "coffee-table", 1550, 2300, 0);
        const tvForSofaA = placement("tv", "tv", 1425, 3350, 180);
        const tvForSofaB = placement("tv", "tv", 5425, 3350, 180);

        const coherent = [sofaA, sofaB, centeredTable, tvForSofaA];
        const split = [sofaA, sofaB, centeredTable, tvForSofaB];

        expect(scoreLivingComposition(coherent)).toBeGreaterThan(scoreLivingComposition(split));
    });

    it("rewards centering TV and coffee table on the sofa axis", () => {
        const sofa = placement("sofa", "sofa-two", 1000, 1000, 0);
        const centered = [
            sofa,
            placement("table", "coffee-table", 1550, 2300, 0),
            placement("tv", "tv", 1425, 3350, 180),
        ];
        const edgeAligned = [
            sofa,
            placement("table", "coffee-table", 2450, 2300, 0),
            placement("tv", "tv", 2500, 3350, 180),
        ];

        expect(scoreLivingComposition(centered)).toBeGreaterThan(
            scoreLivingComposition(edgeAligned),
        );
    });

    it("makes a full conflict-free living-room layout primary instead of requiring a composition", () => {
        const result = solveRoom(
            ROOM,
            [
                instance("sofa", "sofa-two", true),
                instance("table", "coffee-table", true),
                instance("tv", "tv", true),
            ],
            { tvTargetCategory: "living" },
        );

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(result.placements).toHaveLength(3);
        expect(validateLayout(ROOM, result.placements, { tvTargetCategory: "living" })).toEqual({
            valid: true,
            issues: [],
        });
    });

    it("places schematic furniture by its stated geometry without treating a TV console as a television", () => {
        const result = solveRoom(ROOM, [
            instance("dining-table-1", "dining-table", true),
            instance("dining-chair-1", "dining-chair", true),
            instance("dining-chair-2", "dining-chair", true),
            instance("armchair-1", "armchair", true),
            instance("tv-console-1", "tv-console", true),
            instance("pouf-1", "pouf", true),
        ]);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(result.placements).toHaveLength(6);
        expect(validateLayout(ROOM, result.placements)).toEqual({ valid: true, issues: [] });
        expect(result.notes).toContain(
            "В плане есть схематичные предметы с типовыми размерами; перед покупкой сверьте габариты выбранной модели.",
        );
    });

    it("returns a fully validated layout and is deterministic for the same request", () => {
        const instances = [
            instance("double-bed-1", "double-bed", true),
            instance("bookcase-1", "bookcase"),
            instance("dresser-1", "dresser"),
        ];
        const first = solveRoom(ROOM, instances);
        const second = solveRoom(ROOM, instances);

        expect(first.status).toBe("success");
        expect(second).toEqual(first);
        if (first.status !== "success") throw new Error(first.message);
        expect(validateLayout(ROOM, first.placements)).toEqual({ valid: true, issues: [] });
    });

    it("allows a cradle request without a double bed", () => {
        const result = solveRoom(ROOM, [
            instance("single-bed-1", "single-bed", true),
            instance("cradle-1", "cradle", true),
        ]);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(validateLayout(ROOM, result.placements)).toEqual({ valid: true, issues: [] });
    });

    it("uses the double bed as a soft placement hint for a cradle", () => {
        const doubleBed = placement("double-bed-1", "double-bed", 4000, 4000);
        const source = getPreferredRelationCandidates(
            instance("cradle-1", "cradle"),
            RELATION_ROOM,
            [doubleBed],
            [0],
        );

        if (!source) throw new Error("Missing cradle preference source");
        const first = source[Symbol.iterator]().next();
        if (first.done) throw new Error("Cradle preference source is empty");

        expect(relationSatisfied(first.value, doubleBed, "aligned-side", 750, 800)).toBe(true);
    });

    it("rejects contradictory boolean and explicit priority metadata", () => {
        const contradictory = {
            ...instance("bookcase-1", "bookcase", false, "preferred"),
            required: true,
        };
        const result = solveRoom(ROOM, [contradictory]);

        expect(result).toEqual(
            expect.objectContaining({
                status: "failure",
                reason: "invalid-request",
                exploredNodes: 0,
                blockingInstanceIds: ["bookcase-1"],
            }),
        );
    });

    it("reports a zero-budget search as inconclusive and never auto-removes furniture", () => {
        const instances = [instance("bookcase-1", "bookcase")];
        const knownValidPlacement: Placement = {
            instanceId: "bookcase-1",
            definitionId: "bookcase",
            x: 1500,
            y: 0,
            rotation: 0,
        };
        const result = solveRoom(ROOM, instances, {}, { maxSearchNodes: 0 });
        const removal = solveWithAutomaticRemoval(ROOM, instances, {}, { maxSearchNodes: 0 });

        expect(validateLayout(ROOM, [knownValidPlacement])).toEqual({ valid: true, issues: [] });
        expect(result).toEqual(
            expect.objectContaining({
                status: "failure",
                reason: "search-exhausted",
                exploredNodes: 0,
            }),
        );
        if (result.status !== "failure") throw new Error("Expected an exhausted search");
        expect(result.message).toContain("не доказывает");
        expect(removal.removedInstances).toEqual([]);
        expect(removal.result).toEqual(result);
    });

    it("reports a truncated required-relation stream as search-exhausted", () => {
        const instances = [
            instance("double-bed-1", "double-bed", true),
            instance("cradle-1", "cradle", true),
        ];
        const knownValidPlacements: Placement[] = [
            {
                instanceId: "double-bed-1",
                definitionId: "double-bed",
                x: 1000,
                y: 0,
                rotation: 0,
            },
            {
                instanceId: "cradle-1",
                definitionId: "cradle",
                x: 3550,
                y: 0,
                rotation: 0,
            },
        ];

        const cradleRelation = getFurniture("cradle").relations[0];
        const originalRequired = cradleRelation.required;
        cradleRelation.required = true;
        try {
            expect(validateLayout(ROOM, knownValidPlacements)).toEqual({ valid: true, issues: [] });
            const result = solveRoom(
                ROOM,
                instances,
                {},
                {
                    maxSearchNodes: 500,
                    maxRelationCandidates: 0,
                },
            );

            expect(result).toEqual(
                expect.objectContaining({
                    status: "failure",
                    reason: "search-exhausted",
                }),
            );
            if (result.status !== "failure") throw new Error("Expected an exhausted search");
            expect(result.message).toContain("не доказывает");
        } finally {
            cradleRelation.required = originalRequired;
        }
    });

    it("keeps evaluating valid leaves and retains the best packing score", () => {
        const instances = [instance("bookcase-1", "bookcase")];
        const firstValid = solveRoom(ROOM, instances, {}, { maxSearchNodes: 1 });
        const optimized = solveRoom(ROOM, instances, {}, { maxSearchNodes: 500 });

        expect(firstValid.status).toBe("success");
        expect(optimized.status).toBe("success");
        if (firstValid.status !== "success" || optimized.status !== "success") {
            throw new Error("Expected valid layouts");
        }
        expect(optimized.exploredNodes).toBeGreaterThan(1);
        expect(optimized.score).toBeGreaterThanOrEqual(firstValid.score);
        expect(optimized.score).toBe(scoreLayoutForProfile(ROOM, optimized.placements, "fit-all"));
    });

    it("treats swapped identical instances as the same semantic layout", () => {
        const first: Placement[] = [
            {
                instanceId: "bedside-table-1",
                definitionId: "bedside-table",
                x: 0,
                y: 0,
                rotation: 0,
            },
            {
                instanceId: "bedside-table-2",
                definitionId: "bedside-table",
                x: 500,
                y: 0,
                rotation: 0,
            },
        ];
        const swapped: Placement[] = [
            {
                instanceId: "bedside-table-1",
                definitionId: "bedside-table",
                x: 500,
                y: 0,
                rotation: 0,
            },
            {
                instanceId: "bedside-table-2",
                definitionId: "bedside-table",
                x: 0,
                y: 0,
                rotation: 0,
            },
        ];

        expect(getSemanticLayoutSignature(swapped)).toBe(getSemanticLayoutSignature(first));
    });

    it("canonicalizes every declared round-table rotation", () => {
        const atZero: Placement[] = [
            {
                instanceId: "coffee-1",
                definitionId: "coffee-table",
                x: 2000,
                y: 2000,
                rotation: 0,
            },
        ];
        const atTwoSeventy: Placement[] = [{ ...atZero[0], rotation: 270 }];

        expect(getCanonicalRotation("coffee-table", 270)).toBe(0);
        expect(getSemanticLayoutSignature(atTwoSeventy)).toBe(getSemanticLayoutSignature(atZero));
        expect(getCanonicalRotation("double-bed", 180)).toBe(180);
    });

    it("does not advertise a one-grid-step nudge as a different variant", () => {
        const original: Placement[] = [
            {
                instanceId: "bookcase-1",
                definitionId: "bookcase",
                x: 0,
                y: 0,
                rotation: 0,
            },
        ];
        const oneStep = [{ ...original[0], x: 50 }];
        const noticeable = [{ ...original[0], x: NOTICEABLE_VARIANT_TOLERANCE_MM }];

        expect(areLayoutsNoticeablyDifferent(original, oneStep)).toBe(false);
        expect(getSemanticLayoutSignature(original)).toBe(getSemanticLayoutSignature(oneStep));
        expect(areLayoutsNoticeablyDifferent(original, noticeable)).toBe(true);
    });

    it("keeps the complete grid and the previously skipped x=1500 critical coordinate", () => {
        const coordinates = getCriticalAxisCoordinates(
            10_000,
            800,
            [{ start: 0, end: 800 }],
            [
                { start: 0, end: 1450 },
                { start: 2300, end: 10_000 },
            ],
            "edge",
        );
        const allCoordinates = new Set([...coordinates.critical, ...coordinates.grid]);

        expect(coordinates.critical).toContain(1500);
        for (let coordinate = 0; coordinate <= 9200; coordinate += 50) {
            expect(allCoordinates.has(coordinate), `missing grid coordinate ${coordinate}`).toBe(
                true,
            );
        }
        expect(allCoordinates.size).toBeGreaterThanOrEqual(185);
    });

    it.each([
        [4200, 3400, "bookcase"],
        [5000, 4000, "dresser"],
        [6000, 5000, "double-bed"],
    ] as const)(
        "validates every success for a %ix%i room with %s",
        (width, depth, definitionId) => {
            const room: Room = { width, depth, doors: [], windows: [], radiators: [] };
            const result = solveRoom(room, [instance(`${definitionId}-1`, definitionId)]);
            const repeated = solveRoom(room, [instance(`${definitionId}-1`, definitionId)]);

            expect(result.status).toBe("success");
            expect(repeated).toEqual(result);
            if (result.status !== "success") throw new Error(result.message);
            expect(validateLayout(room, result.placements)).toEqual({ valid: true, issues: [] });
        },
    );

    it.each(["dresser", "double-bed"])(
        "matches an independent exhaustive 50 mm small-room search for %s",
        (definitionId) => {
            const room: Room = {
                width: 2400,
                depth: 2400,
                doors: [],
                windows: [],
                radiators: [],
            };
            const exhaustiveHasSolution = exhaustiveGridHasValidPlacement(room, definitionId);
            const result = solveRoom(room, [instance(`${definitionId}-1`, definitionId)]);

            expect(result.status === "success").toBe(exhaustiveHasSolution);
            if (result.status === "success") {
                expect(validateLayout(room, result.placements)).toEqual({
                    valid: true,
                    issues: [],
                });
            } else {
                expect(result.reason).toBe("proven-impossible");
            }
        },
    );

    it.each(RELATION_COVERAGE_CASES)(
        "matches the independent validator oracle for $name rotations, integer gaps and offsets",
        (testCase) => {
            const definition = getFurniture(testCase.dependentDefinitionId);
            const relation = definition.relations.find(
                (candidate) => candidate.kind === testCase.kind,
            );
            const originalRequired = relation?.required;
            if (relation && testCase.temporarilyRequired) relation.required = true;
            const canonicalRotations = Array.from(
                new Set(
                    definition.rotations.map((rotation) =>
                        getCanonicalRotation(definition.id, rotation),
                    ),
                ),
            );

            try {
                canonicalRotations.forEach((rotation) => {
                    const expectedSamples = relationSamplePlacements(testCase, rotation);
                    const missing = new Set(expectedSamples.map(placementKey));
                    const source = getRequiredRelationCandidates(
                        instance(
                            `${testCase.dependentDefinitionId}-1`,
                            testCase.dependentDefinitionId,
                        ),
                        RELATION_ROOM,
                        [testCase.target],
                        [rotation],
                    );
                    if (!source) throw new Error(`Missing ${testCase.name} relation source`);

                    const iterator = source[Symbol.iterator]();
                    let emitted = 0;
                    for (let next = iterator.next(); !next.done; next = iterator.next()) {
                        const candidate = next.value;
                        emitted += 1;
                        if (
                            !relationOracle(
                                candidate,
                                testCase.target,
                                testCase.kind,
                                testCase.minimumGap,
                                testCase.maximumGap,
                            )
                        ) {
                            throw new Error(
                                `${testCase.name} emitted validator-rejected ${placementKey(candidate)}`,
                            );
                        }
                        missing.delete(placementKey(candidate));
                        if (missing.size === 0) break;
                        if (emitted > 250_000) {
                            throw new Error(`${testCase.name} coverage stream exceeded test bound`);
                        }
                    }

                    expect(Array.from(missing), `${testCase.name} rotation ${rotation}`).toEqual(
                        [],
                    );
                    expectedSamples.forEach((candidate) => {
                        expect(
                            validateLayout(RELATION_ROOM, [testCase.target, candidate]).issues.some(
                                (issue) =>
                                    issue.code === "relation-broken" &&
                                    issue.instanceIds.includes(candidate.instanceId),
                            ),
                            `${testCase.name} validator rejected ${placementKey(candidate)}`,
                        ).toBe(false);
                    });
                });
            } finally {
                if (relation && originalRequired !== undefined)
                    relation.required = originalRequired;
            }
        },
        10_000,
    );

    it.each(OMITTED_RELATION_BOUND_CASES)(
        "uses identical shared defaults for omitted $name bounds in generation and validation",
        ({ dependentDefinitionId, target, expectedCandidate, temporarilyRequired }) => {
            const relation = getFurniture(dependentDefinitionId).relations[0];
            const originalMinimumGap = relation.minGap;
            const originalMaximumGap = relation.maxGap;
            const originalRequired = relation.required;

            relation.minGap = undefined;
            relation.maxGap = undefined;
            if (temporarilyRequired) relation.required = true;
            try {
                const source = getRequiredRelationCandidates(
                    instance(expectedCandidate.instanceId, dependentDefinitionId),
                    RELATION_ROOM,
                    [target],
                    [expectedCandidate.rotation],
                );
                if (!source) throw new Error(`Missing ${dependentDefinitionId} relation source`);

                let generated = false;
                let inspected = 0;
                const iterator = source[Symbol.iterator]();
                for (let next = iterator.next(); !next.done; next = iterator.next()) {
                    const candidate = next.value;
                    inspected += 1;
                    if (placementKey(candidate) === placementKey(expectedCandidate)) {
                        generated = true;
                        break;
                    }
                    if (inspected > 250_000) break;
                }

                expect(generated).toBe(true);
                expect(
                    validateLayout(RELATION_ROOM, [target, expectedCandidate]).issues.some(
                        (issue) =>
                            issue.code === "relation-broken" &&
                            issue.instanceIds.includes(expectedCandidate.instanceId),
                    ),
                ).toBe(false);
            } finally {
                relation.minGap = originalMinimumGap;
                relation.maxGap = originalMaximumGap;
                relation.required = originalRequired;
            }
        },
        10_000,
    );

    it("returns only semantically unique variants", () => {
        const result = solveRoomVariants(ROOM, [instance("bookcase-1", "bookcase")], {}, 3);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        const signatures = result.variants.map((variant) =>
            getSemanticLayoutSignature(variant.placements),
        );
        const structureSignatures = result.variants.map((variant) =>
            getLayoutStructureSignature(ROOM, variant.placements),
        );
        expect(new Set(signatures).size).toBe(signatures.length);
        expect(new Set(structureSignatures).size).toBe(structureSignatures.length);
        for (const variant of result.variants) {
            expect(validateLayout(ROOM, variant.placements).valid).toBe(true);
        }
        expect(result.variants[0]?.profile).toMatchObject({
            id: "fit-all",
            label: "Уместить всё",
        });
    });

    it("selects a scenario profile from the actual furniture set", () => {
        const living = [instance("sofa", "sofa-two"), instance("tv", "tv")];
        const mixed = [instance("bed", "double-bed"), instance("sofa", "sofa-two")];
        const workplace = [instance("desk", "desk")];
        const roomWithWindow: Room = {
            ...ROOM,
            windows: [{ id: "window", wall: "top", offset: 2000, width: 1200 }],
        };

        expect(getVariantProfileIds(ROOM, living)).toEqual(["fit-all", "long-wall", "open-center"]);
        expect(getVariantProfileIds(ROOM, mixed)).toEqual(["fit-all", "zoned", "open-center"]);
        expect(getVariantProfileIds(roomWithWindow, workplace)).toEqual([
            "fit-all",
            "daylight",
            "open-center",
        ]);
    });

    it("builds decomposable living, sleep and work composition plans", () => {
        const instances = [
            instance("sofa-1", "sofa-two"),
            instance("coffee-table-1", "coffee-table", false, "optional"),
            instance("tv-1", "tv"),
            instance("bed-1", "double-bed"),
            instance("bedside-table-1", "bedside-table", false, "optional"),
            instance("dresser-1", "dresser", false, "optional"),
            instance("desk-1", "desk"),
            instance("bookcase-1", "bookcase", false, "optional"),
        ];

        expect(getFunctionalBlocks(instances, { tvTargetCategory: "living" })).toEqual([
            {
                id: "living:sofa-1",
                kind: "living",
                anchorInstanceId: "sofa-1",
                memberInstanceIds: ["coffee-table-1", "tv-1"],
            },
            {
                id: "sleep:bed-1",
                kind: "sleep",
                anchorInstanceId: "bed-1",
                memberInstanceIds: ["bedside-table-1", "dresser-1"],
            },
            {
                id: "work:desk-1",
                kind: "work",
                anchorInstanceId: "desk-1",
                memberInstanceIds: ["bookcase-1"],
            },
        ]);
        expect(
            getFunctionalBlocks(instances, { tvTargetCategory: "sleep" }).find(
                (block) => block.kind === "sleep",
            )?.memberInstanceIds,
        ).toContain("tv-1");
        expect(instances.find((item) => item.instanceId === "coffee-table-1")?.priority).toBe(
            "optional",
        );
    });

    it("rewards useful storage proximity without forcing everything into one corner", () => {
        const bed = placement("bed-1", "double-bed", 1000, 0);
        const nearDresser = placement("dresser-1", "dresser", 4300, 0);
        const farDresser = placement("dresser-1", "dresser", 9000, 0);

        expect(scoreFunctionalBlockCohesion([bed, nearDresser])).toBeGreaterThan(
            scoreFunctionalBlockCohesion([bed, farDresser]),
        );
        expect(scoreFunctionalBlockCohesion([bed, nearDresser])).toBeGreaterThan(0);
        expect(scoreFunctionalBlockCohesion([bed, farDresser])).toBeLessThan(0);
        expect(
            explainLayoutForProfile(RELATION_ROOM, [bed, nearDresser], "balanced").join(" "),
        ).toContain("спальную зону");
    });

    it("uses functional cohesion when ranking equally compact fit-all layouts", () => {
        const bed = placement("bed-1", "double-bed", 1000, 0);
        // The pouf fixes the outer envelope in both cases. Before the v3
        // objective, fit-all therefore gave both layouts the same score.
        const roomEdge = placement("pouf-1", "pouf", 9500, 9500);
        const cohesive = [bed, placement("dresser-1", "dresser", 4300, 0), roomEdge];
        const scattered = [bed, placement("dresser-1", "dresser", 9000, 0), roomEdge];

        expect(scoreFunctionalBlockCohesion(cohesive)).toBeGreaterThan(
            scoreFunctionalBlockCohesion(scattered),
        );
        expect(scoreLayoutForProfile(RELATION_ROOM, cohesive, "fit-all")).toBeGreaterThan(
            scoreLayoutForProfile(RELATION_ROOM, scattered, "fit-all"),
        );
    });

    it("produces a structural long-wall TV scenario in a wide living room", () => {
        const wideRoom: Room = { width: 8000, depth: 4000, doors: [], windows: [] };
        const result = solveRoomVariants(
            wideRoom,
            [instance("sofa", "sofa-two"), instance("tv", "tv")],
            { tvTargetCategory: "living" },
            3,
        );

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        const longWall = result.variants.find((variant) => variant.profile.id === "long-wall");
        expect(longWall).toBeDefined();
        const television = longWall?.placements.find(
            (placement) => placement.definitionId === "tv",
        );
        expect(television && ["top", "bottom"].includes(wallForBack(television.rotation))).toBe(
            true,
        );
        const explanation = explainLayoutForProfile(
            wideRoom,
            longWall?.placements ?? [],
            "long-wall",
        ).join(" ");
        expect(explanation).toContain("длинной стены");
        expect(explanation).toContain("прошла проверку");
        const signatures = result.variants.map((variant) =>
            getLayoutStructureSignature(wideRoom, variant.placements),
        );
        expect(new Set(signatures).size).toBe(signatures.length);
    });

    it("does not treat a coordinate nudge on the same wall as a new structural variant", () => {
        const first = [placement("bookcase", "bookcase", 500, 0, 0)];
        const sameWall = [placement("bookcase", "bookcase", 1500, 0, 0)];
        const otherWall = [placement("bookcase", "bookcase", 5700, 500, 90)];

        expect(areLayoutsStructurallyDifferent(ROOM, first, sameWall)).toBe(false);
        expect(areLayoutsStructurallyDifferent(ROOM, first, otherWall)).toBe(true);
    });

    it("discloses the provisional curtain-buffer approximation in successful results", () => {
        const room: Room = {
            ...ROOM,
            windows: [{ id: "window", wall: "top", offset: 2000, width: 1200 }],
        };
        const result = solveRoom(room, [instance("bookcase-1", "bookcase")]);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(result.notes.join(" ")).toContain("150 мм");
        expect(result.notes.join(" ")).toContain("подтвердить у дизайнера");
    });

    it("discloses the connected-access target and proof envelope", () => {
        const room: Room = {
            ...ROOM,
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 2550,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
        };
        const result = solveRoom(room, [instance("bookcase-1", "bookcase")]);

        expect(result.status).toBe("success");
        if (result.status !== "success") throw new Error(result.message);
        expect(result.notes.join(" ")).toContain("700 мм");
        expect(result.notes.join(" ")).toContain("50 мм");
        expect(validateLayout(room, result.placements)).toEqual({ valid: true, issues: [] });
    });

    it("keeps a 600 mm door value but refuses to certify a 700 mm trusted passage", () => {
        const room: Room = {
            ...ROOM,
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 2700,
                    width: 600,
                    clearanceDepth: 600,
                    hinge: "start",
                },
            ],
        };
        const result = solveRoom(room, [instance("bookcase-1", "bookcase")]);

        expect(result).toEqual(
            expect.objectContaining({
                status: "failure",
                reason: "access-unverified",
                exploredNodes: 0,
            }),
        );
        if (result.status !== "failure") throw new Error("Expected a trusted-access failure");
        expect(result.message).toContain("600 мм");
        expect(result.message).toContain("700 мм");
        expect(result.message).toContain("не подтверждён");
    });

    it("streams the maximum 10x10 m center grid within the search budget and stays deterministic", () => {
        const room: Room = {
            width: 10_000,
            depth: 10_000,
            doors: [],
            windows: [],
            radiators: [],
        };
        const instances = [instance("desk-1", "desk")];
        const startedAt = Date.now();
        const first = solveRoom(room, instances);
        const second = solveRoom(room, instances);
        const elapsed = Date.now() - startedAt;

        expect(first.status).toBe("success");
        expect(second).toEqual(first);
        expect(first.exploredNodes).toBeLessThanOrEqual(45_000);
        if (first.status !== "success") throw new Error(first.message);
        expect(first.notes.join(" ")).toContain("глобальный оптимум");
        // CI runners are several times slower than a developer machine.
        expect(elapsed).toBeLessThan(process.env.CI ? 20_000 : 5000);
    });

    it("proves impossibility only after the finite MVP candidate search is complete", () => {
        const room: Room = { ...ROOM, width: 2400, depth: 2400 };
        const result = solveRoom(room, [instance("double-bed-1", "double-bed")]);

        expect(result).toEqual(
            expect.objectContaining({
                status: "failure",
                reason: "proven-impossible",
            }),
        );
    });

    it("proposes removing optional furniture only after proven impossibility", () => {
        const room: Room = { ...ROOM, width: 2400, depth: 2400 };
        const optionalBed = instance("double-bed-1", "double-bed", false, "optional");
        const original = [optionalBed];
        const proposal = solveWithAutomaticRemoval(room, original);

        expect(proposal.result.status).toBe("success");
        expect(proposal.removedInstances.map((item) => item.instanceId)).toEqual(["double-bed-1"]);
        expect(original).toEqual([optionalBed]);
    });

    it("does not make a removal proposal when its combination proof budget is zero", () => {
        const room: Room = { ...ROOM, width: 2400, depth: 2400 };
        const proposal = solveWithAutomaticRemoval(
            room,
            [instance("double-bed-1", "double-bed", false, "optional")],
            {},
            { maxRemovalCombinationChecks: 0 },
        );

        expect(proposal.result).toEqual(
            expect.objectContaining({ status: "failure", reason: "search-exhausted" }),
        );
        expect(proposal.removedInstances).toEqual([]);
    });

    it("never proposes removing preferred or required furniture", () => {
        const room: Room = { ...ROOM, width: 2400, depth: 2400 };
        const preferred = solveWithAutomaticRemoval(room, [
            instance("double-bed-1", "double-bed", false, "preferred"),
        ]);
        const required = solveWithAutomaticRemoval(room, [
            instance("double-bed-1", "double-bed", true, "required"),
        ]);

        expect(preferred.result.status).toBe("failure");
        expect(preferred.removedInstances).toEqual([]);
        expect(required.result.status).toBe("failure");
        expect(required.removedInstances).toEqual([]);
    });

    it("minimizes removal count before catalog user-loss cost", () => {
        const room: Room = { ...ROOM, width: 2400, depth: 2400 };
        const instances = [
            instance("sofa-three-1", "sofa-three", false, "optional"),
            instance("sofa-four-left-1", "sofa-four-left", false, "optional"),
        ];
        const proposal = solveWithAutomaticRemoval(
            room,
            instances,
            {},
            {
                maxSearchNodes: 300_000,
            },
        );

        expect(proposal.result.status).toBe("success");
        expect(proposal.removedInstances.map((item) => item.definitionId)).toEqual(["sofa-three"]);
    });
});
