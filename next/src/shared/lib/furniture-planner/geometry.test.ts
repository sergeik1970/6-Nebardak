import { describe, expect, it } from "vitest";

import {
    ACCESS_PATH_CELL_ENVELOPE,
    ACCESS_PATH_PROOF_WIDTH,
    DOORWAY_KEEP_CLEAR_DEPTH,
    MIN_CONNECTED_PASSAGE_WIDTH,
    analyzeConnectedAccess,
    getDoorMaterialCollisionError,
    getDoorObstacle,
    getPartitionObstacleRects,
    getRotatedGeometry,
    getPreferredClearanceSummary,
    getWindowCurtainObstacle,
    getWindowCurtainSideObstacles,
    placementTouchesAllowedWall,
    resolveRelationGapRange,
    tvFacesTarget,
    validateLayout,
    validatePlacement,
    validateRoomGeometry,
    wallForBodyEdge,
} from "./geometry";
import { FURNITURE_CATALOG, getFurniture } from "./catalog";
import { FurnitureBodyEdge, Placement, Room, Rotation, Wall } from "./types";
import { applyRoomGeometry, createLRoomGeometry } from "./room-geometry";

const EMPTY_ROOM: Room = {
    width: 6000,
    depth: 4000,
    doors: [],
    windows: [],
    radiators: [],
};

const placement = (
    instanceId: string,
    definitionId: string,
    x: number,
    y: number,
    rotation: Rotation = 0,
): Placement => ({ instanceId, definitionId, x, y, rotation });

const placementAtWall = (
    definitionId: string,
    rotation: Rotation,
    edge: FurnitureBodyEdge,
    room: Room,
): Placement => {
    const geometry = getRotatedGeometry(getFurniture(definitionId), rotation);
    const wall = wallForBodyEdge(rotation, edge);
    const base = placement(
        `${definitionId}-${rotation}-${edge}`,
        definitionId,
        1000,
        1000,
        rotation,
    );

    switch (wall) {
        case "top":
            return { ...base, y: 0 };
        case "right":
            return { ...base, x: room.width - geometry.width };
        case "bottom":
            return { ...base, y: room.depth - geometry.depth };
        case "left":
            return { ...base, x: 0 };
    }
};

describe("rotated composite geometry", () => {
    it("rotates the corner-sofa L shape with its seats' front passage", () => {
        const geometry = getRotatedGeometry(getFurniture("sofa-four-left"), 90);

        expect(geometry.width).toBe(1500);
        expect(geometry.depth).toBe(2200);
        expect(geometry.bodyRects).toEqual([
            { x: 550, y: 0, width: 950, depth: 2200 },
            { x: 0, y: 0, width: 550, depth: 730 },
        ]);
        // In front of the seats beside the chaise, now facing left.
        expect(geometry.clearanceRects).toEqual([
            expect.objectContaining({ x: -150, y: 730, width: 700, depth: 1470 }),
        ]);
    });

    it("lets a coffee table into the inside corner, but not a wardrobe", () => {
        const result = validateLayout(EMPTY_ROOM, [
            placement("sofa", "sofa-four-left", 0, 0),
            placement("coffee", "coffee-table", 1000, 1000),
        ]);

        expect(result).toEqual({ valid: true, issues: [] });
        const blocked = validateLayout(EMPTY_ROOM, [
            placement("sofa", "sofa-four-left", 0, 0),
            placement("wardrobe", "wardrobe-small", 1000, 1000),
        ]);
        expect(blocked.issues.map((issue) => issue.code)).toContain("clearance-blocked");
    });

    it("keeps a sofa's front passage for a coffee table or a pouf only", () => {
        const sofa = placement("sofa", "sofa-two", 0, 0);
        const inFront = (id: string, definitionId: string) =>
            validateLayout(EMPTY_ROOM, [sofa, placement(id, definitionId, 550, 1350)]);

        expect(inFront("pouf", "pouf").valid).toBe(true);
        expect(inFront("table", "coffee-table").valid).toBe(true);
        expect(inFront("dresser", "dresser").issues.map((issue) => issue.code)).toContain(
            "clearance-blocked",
        );
    });
});

describe("orthogonal room hard geometry", () => {
    const room = applyRoomGeometry(
        {
            width: 6000,
            depth: 4600,
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 500,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
            windows: [{ id: "window", wall: "top", offset: 2100, width: 1800 }],
            radiators: [],
        },
        createLRoomGeometry(6000, 4600, "right"),
    );

    it("keeps segment openings valid and rejects furniture in the cutout", () => {
        expect(validateRoomGeometry(room)).toBeNull();
        expect(room.doors[0].segmentId).toBe("segment-v5");
        expect(room.windows[0].segmentId).toBe("segment-v1");

        const invalid = validatePlacement(placement("coffee", "coffee-table", 4500, 200), room, []);
        expect(invalid.issues.some((issue) => issue.code === "outside-room")).toBe(true);
    });

    it("keeps a valid body in the occupied arm", () => {
        const valid = validatePlacement(placement("coffee", "coffee-table", 300, 2300), room, []);
        expect(valid.issues.some((issue) => issue.code === "outside-room")).toBe(false);
    });

    it("proves connected access only through cells contained by the L contour", () => {
        const access = analyzeConnectedAccess(room, []);

        expect(access.applicable).toBe(true);
        expect(access.connected).toBe(true);
        expect(access.usableCellCount).toBeGreaterThan(0);
        expect(access.reachableUsableCellCount).toBe(access.usableCellCount);
    });
});

describe("internal partitions", () => {
    const partitionedRoom: Room = {
        width: 6000,
        depth: 4000,
        doors: [
            {
                id: "door-entry",
                wall: "bottom",
                offset: 500,
                width: 900,
                clearanceDepth: 900,
            },
        ],
        windows: [],
        radiators: [],
        partitions: [
            {
                id: "partition-main",
                start: { x: 3000, y: 0 },
                end: { x: 3000, y: 4000 },
                thickness: 50,
            },
        ],
    };

    it("treats a solid partition as a furniture obstacle and a barrier to access", () => {
        expect(validateRoomGeometry(partitionedRoom)).toBeNull();
        expect(getPartitionObstacleRects(partitionedRoom)).toEqual([
            { x: 2975, y: 0, width: 50, depth: 4000 },
        ]);

        const blocked = validatePlacement(
            placement("coffee", "coffee-table", 2800, 400),
            partitionedRoom,
            [],
        );
        expect(blocked.issues.some((issue) => issue.code === "partition-blocked")).toBe(true);

        const access = analyzeConnectedAccess(partitionedRoom, []);
        expect(access.applicable).toBe(true);
        expect(access.connected).toBe(false);
    });

    it("cuts a real door aperture through the partition and restores a connected route", () => {
        const roomWithInteriorDoor: Room = {
            ...partitionedRoom,
            doors: [
                ...partitionedRoom.doors,
                {
                    id: "door-partition",
                    wall: "right",
                    partitionId: "partition-main",
                    offset: 1500,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                    swingDirection: "inward",
                },
            ],
        };

        expect(validateRoomGeometry(roomWithInteriorDoor)).toBeNull();
        expect(getPartitionObstacleRects(roomWithInteriorDoor)).toEqual([
            { x: 2975, y: 0, width: 50, depth: 1500 },
            { x: 2975, y: 2400, width: 50, depth: 1600 },
        ]);
        expect(analyzeConnectedAccess(roomWithInteriorDoor, []).connected).toBe(true);
    });

    it("keeps a partition-hosted door valid when only its own aperture is cut out", () => {
        const roomWithInteriorDoor: Room = {
            ...partitionedRoom,
            doors: [
                ...partitionedRoom.doors,
                {
                    id: "door-partition",
                    wall: "right",
                    partitionId: "partition-main",
                    offset: 400,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                    swingDirection: "inward",
                },
            ],
        };

        expect(
            getDoorMaterialCollisionError(roomWithInteriorDoor.doors[1], roomWithInteriorDoor),
        ).toBeNull();
        expect(validateRoomGeometry(roomWithInteriorDoor)).toBeNull();
    });

    it("rejects a near-perimeter partition door when its outward leaf enters exterior material", () => {
        const nearPerimeterRoom: Room = {
            width: 4000,
            depth: 4000,
            wallThickness: 100,
            doors: [
                {
                    id: "door-near-top-wall",
                    wall: "top",
                    partitionId: "partition-near-top-wall",
                    offset: 1000,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                    swingDirection: "outward",
                },
            ],
            windows: [],
            radiators: [],
            partitions: [
                {
                    id: "partition-near-top-wall",
                    start: { x: 0, y: 500 },
                    end: { x: 4000, y: 500 },
                    thickness: 100,
                },
            ],
        };
        const allowedDirection: Room = {
            ...nearPerimeterRoom,
            doors: [{ ...nearPerimeterRoom.doors[0], swingDirection: "inward" }],
        };
        const endpointTouchRoom: Room = {
            ...nearPerimeterRoom,
            partitions: [
                {
                    ...nearPerimeterRoom.partitions![0],
                    start: { x: 0, y: 900 },
                    end: { x: 4000, y: 900 },
                },
            ],
        };

        expect(
            getDoorMaterialCollisionError(nearPerimeterRoom.doors[0], nearPerimeterRoom),
        ).toContain("пересекает другую стену");
        expect(validateRoomGeometry(nearPerimeterRoom)).toContain("пересекает другую стену");
        // Exact face contact is material contact too; this protects an
        // endpoint/corner case without permitting a 1 mm visual leak.
        expect(
            getDoorMaterialCollisionError(endpointTouchRoom.doors[0], endpointTouchRoom),
        ).toContain("пересекает другую стену");
        expect(
            getDoorMaterialCollisionError(allowedDirection.doors[0], allowedDirection),
        ).toBeNull();
        expect(validateRoomGeometry(allowedDirection)).toBeNull();
    });

    it("rejects a hinged exterior or partition door when its swing enters another partition", () => {
        const exteriorDoor: Room = {
            ...partitionedRoom,
            doors: [
                {
                    id: "door-exterior-collision",
                    wall: "bottom",
                    offset: 2550,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                    swingDirection: "inward",
                },
            ],
        };
        const partitionDoor: Room = {
            ...partitionedRoom,
            partitions: [
                ...partitionedRoom.partitions!,
                {
                    id: "partition-cross",
                    start: { x: 0, y: 2000 },
                    end: { x: 3000, y: 2000 },
                    thickness: 50,
                },
            ],
            doors: [
                ...partitionedRoom.doors,
                {
                    id: "door-partition-collision",
                    wall: "right",
                    partitionId: "partition-main",
                    offset: 1600,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                    swingDirection: "inward",
                },
            ],
        };

        for (const [door, room] of [
            [exteriorDoor.doors[0], exteriorDoor],
            [partitionDoor.doors[1], partitionDoor],
        ] as const) {
            expect(getDoorMaterialCollisionError(door, room)).toContain("пересекает другую стену");
            expect(validateRoomGeometry(room)).toContain("пересекает другую стену");
        }
    });

    it("does not invent a swing collision for a slider, but still reserves its doorway clearance", () => {
        const clearSlider: Room = {
            ...partitionedRoom,
            doors: [
                {
                    id: "door-slider-clear",
                    wall: "bottom",
                    offset: 1000,
                    width: 900,
                    clearanceDepth: 900,
                    doorKind: "sliding-single",
                },
            ],
        };
        const blockedSlider: Room = {
            ...clearSlider,
            doors: [{ ...clearSlider.doors[0], id: "door-slider-blocked", offset: 2500 }],
        };

        expect(getDoorMaterialCollisionError(clearSlider.doors[0], clearSlider)).toBeNull();
        expect(getDoorMaterialCollisionError(blockedSlider.doors[0], blockedSlider)).toContain(
            "пересекает другую стену",
        );
    });
});

describe("definition-specific relations", () => {
    it("accepts a cradle aligned beside a double bed", () => {
        const result = validateLayout(EMPTY_ROOM, [
            placement("double-bed-1", "double-bed", 1000, 0),
            placement("cradle-1", "cradle", 3550, 0),
        ]);

        expect(result).toEqual({ valid: true, issues: [] });
    });

    it("allows a cradle to stand safely away from the double bed", () => {
        const result = validateLayout(EMPTY_ROOM, [
            placement("single-bed-1", "single-bed", 1000, 0),
            placement("cradle-1", "cradle", 2650, 0),
        ]);

        expect(result).toEqual({ valid: true, issues: [] });
    });
});

describe("explicit relation clearance exceptions", () => {
    it("allows only a declared dependent item to enter its target clearance", () => {
        const bed = placement("bed", "double-bed", 700, 0);
        const bedsideTable = placement("table", "bedside-table", 100, 400);
        const dresser = placement("dresser", "dresser", 1000, 2100);

        expect(
            validatePlacement(bedsideTable, EMPTY_ROOM, [bed]).issues.some(
                (issue) => issue.code === "clearance-blocked",
            ),
        ).toBe(false);
        expect(
            validatePlacement(dresser, EMPTY_ROOM, [bed]).issues.some(
                (issue) => issue.code === "clearance-blocked",
            ),
        ).toBe(true);
    });
});

describe("alternative bed access", () => {
    const room: Room = { width: 4200, depth: 3400, doors: [], windows: [], radiators: [] };
    const bed = placement("bed", "double-bed", 700, 0);

    it("accepts a double bed when one of its two side passages remains free", () => {
        const result = validateLayout(room, [
            bed,
            placement("left-coffee", "coffee-table", 100, 400),
        ]);

        expect(result).toEqual({ valid: true, issues: [] });
    });

    it("rejects a double bed only when both side passages are blocked", () => {
        const result = validateLayout(room, [
            bed,
            placement("left-coffee", "coffee-table", 100, 400),
            placement("right-coffee", "coffee-table", 2700, 400),
        ]);

        expect(result.valid).toBe(false);
        expect(result.issues).toContainEqual(
            expect.objectContaining({
                code: "alternative-clearance-blocked",
                instanceIds: ["bed"],
            }),
        );
    });
});

describe("shared relation gap defaults", () => {
    it.each([
        ["front-gap", undefined, undefined, 350, 450],
        ["front-gap", 400, undefined, 400, 450],
        ["front-gap", undefined, 425, 350, 425],
        ["front-gap", 375, 425, 375, 425],
        ["adjacent", undefined, undefined, 50, 100],
        ["adjacent", 75, undefined, 75, 100],
        ["adjacent", undefined, 80, 50, 80],
        ["adjacent", 60, 80, 60, 80],
        ["aligned-side", undefined, undefined, 50, 100],
        ["aligned-side", 75, undefined, 75, 100],
        ["aligned-side", undefined, 80, 50, 80],
        ["aligned-side", 60, 80, 60, 80],
    ] as const)(
        "resolves %s bounds min=%s max=%s once for generation and validation",
        (kind, minGap, maxGap, minimumGap, maximumGap) => {
            expect(resolveRelationGapRange({ kind, minGap, maxGap })).toEqual({
                minimumGap,
                maximumGap,
            });
        },
    );
});

describe("wall-contact edges", () => {
    it("recognises every declared non-dotted edge at every rotation", () => {
        const rotations: Rotation[] = [0, 90, 180, 270];

        for (const definition of FURNITURE_CATALOG) {
            for (const rotation of rotations) {
                for (const edge of definition.placement.allowedWallContactEdges) {
                    const candidate = placementAtWall(definition.id, rotation, edge, EMPTY_ROOM);
                    expect(
                        placementTouchesAllowedWall(candidate, EMPTY_ROOM),
                        `${definition.id} ${rotation} ${edge}`,
                    ).toBe(true);
                }
            }
        }
    });

    it("does not accept a dotted front edge as bookcase wall contact", () => {
        const geometry = getRotatedGeometry(getFurniture("bookcase"), 0);
        const candidate = placement(
            "bookcase-front",
            "bookcase",
            1000,
            EMPTY_ROOM.depth - geometry.depth,
        );

        expect(wallForBodyEdge(0, "front")).toBe<Wall>("bottom");
        expect(placementTouchesAllowedWall(candidate, EMPTY_ROOM)).toBe(false);
        expect(validateLayout(EMPTY_ROOM, [candidate]).issues).toContainEqual(
            expect.objectContaining({ code: "wall-contact" }),
        );
    });
});

describe("window policy and provisional curtain buffer", () => {
    const roomWithWindow: Room = {
        ...EMPTY_ROOM,
        windows: [{ id: "window-1", wall: "top", offset: 1000, width: 1200 }],
    };

    it("builds a conservative 150 mm envelope along the wall and into the room", () => {
        expect(getWindowCurtainObstacle(roomWithWindow.windows[0], roomWithWindow)).toEqual({
            x: 850,
            y: 0,
            width: 1500,
            depth: 150,
        });
        expect(getWindowCurtainSideObstacles(roomWithWindow.windows[0], roomWithWindow)).toEqual([
            { x: 850, y: 0, width: 150, depth: 150 },
            { x: 2200, y: 0, width: 150, depth: 150 },
        ]);
    });

    it.each([
        ["single-bed", "allowed"],
        ["desk", "preferred"],
        ["bookcase", "forbidden"],
    ] as const)("applies the %s window policy (%s)", (definitionId, policy) => {
        const candidate = placement(`${definitionId}-1`, definitionId, 1000, 0);
        const result = validateLayout(roomWithWindow, [candidate]);
        const hasWindowIssue = result.issues.some((issue) => issue.code === "window-blocked");

        expect(getFurniture(definitionId).placement.windowPolicy).toBe(policy);
        expect(hasWindowIssue).toBe(policy === "forbidden");
    });

    it("does not treat forbidden furniture outside the inward buffer as window blocking", () => {
        const candidate = placement("sofa-1", "sofa-two", 1000, 150);

        expect(
            validateLayout(roomWithWindow, [candidate]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(false);
    });

    it("keeps a dresser outside a 600 mm exclusion zone around a window", () => {
        const tooClose = placement("dresser-close", "dresser", 1000, 400);
        const clearOfWindow = placement("dresser-clear", "dresser", 1000, 650);

        expect(
            validateLayout(roomWithWindow, [tooClose]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(true);
        expect(
            validateLayout(roomWithWindow, [clearOfWindow]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(false);
    });

    it("lets approved furniture project under the opening but preserves both curtain side pockets", () => {
        const underOpening = placement("bed-under-window", "single-bed", 1000, 0);
        const inCurtainPocket = placement("bed-in-curtain-pocket", "single-bed", 900, 0);

        expect(
            validateLayout(roomWithWindow, [underOpening]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(false);
        expect(
            validateLayout(roomWithWindow, [inCurtainPocket]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(true);
    });

    it("keeps the whole span clear for a floor-to-ceiling window", () => {
        const standardRoom: Room = {
            ...EMPTY_ROOM,
            windows: [{ id: "window", wall: "top", offset: 1800, width: 1800 }],
        };
        const panoramicRoom: Room = {
            ...standardRoom,
            windows: [
                {
                    ...standardRoom.windows[0],
                    windowKind: "floor-to-ceiling",
                },
            ],
        };
        const tableUnderOpening = placement("coffee", "coffee-table", 2450, 0);

        expect(
            validatePlacement(tableUnderOpening, standardRoom, []).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(false);
        expect(
            validatePlacement(tableUnderOpening, panoramicRoom, []).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(true);
    });

    it("allows a bed under a window only when its head/back edge faces that wall", () => {
        const headToWindow = placement("bed-head-window", "single-bed", 1000, 0, 0);
        const feetToWindow = placement("bed-feet-window", "single-bed", 1000, 0, 180);

        expect(
            validateLayout(roomWithWindow, [headToWindow]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(false);
        expect(
            validateLayout(roomWithWindow, [feetToWindow]).issues.some(
                (issue) => issue.code === "window-blocked",
            ),
        ).toBe(true);
    });
});

describe("TV viewing distance", () => {
    const sofa = placement("sofa", "sofa-two", 1000, 6000, 180);

    it("accepts a practical viewing range instead of a single fixed distance", () => {
        expect(tvFacesTarget(placement("tv-min", "tv", 1200, 4500, 0), sofa, "living")).toBe(true);
        expect(tvFacesTarget(placement("tv-wide", "tv", 1200, 2900, 0), sofa, "living")).toBe(true);
    });

    it("rejects a TV that is too close or implausibly far away", () => {
        expect(tvFacesTarget(placement("tv-close", "tv", 1200, 4550, 0), sofa, "living")).toBe(
            false,
        );
        expect(tvFacesTarget(placement("tv-far", "tv", 1200, 1000, 0), sofa, "living")).toBe(false);
    });
});

describe("hard and preferred clearance", () => {
    const compactRoom: Room = {
        width: 2400,
        depth: 2400,
        doors: [],
        windows: [],
        radiators: [],
    };

    it("keeps a compromised preferred extension valid and reports it only as quality", () => {
        const fullyPreferred = placement("dresser-full", "dresser", 0, 0);
        const preferredOutside = placement("dresser-tight", "dresser", 0, 1300);

        expect(validateLayout(compactRoom, [fullyPreferred])).toEqual({ valid: true, issues: [] });
        expect(validateLayout(compactRoom, [preferredOutside])).toEqual({
            valid: true,
            issues: [],
        });
        expect(getPreferredClearanceSummary(compactRoom, [fullyPreferred])).toEqual({
            totalZones: 1,
            satisfiedZones: 1,
        });
        expect(getPreferredClearanceSummary(compactRoom, [preferredOutside])).toEqual({
            totalZones: 1,
            satisfiedZones: 0,
        });
    });
});

describe("connected 700 mm access from the door", () => {
    const roomWithBottomDoor = (width: number, offset: number, doorWidth = 900): Room => ({
        width,
        depth: 4000,
        doors: [
            {
                id: "door",
                wall: "bottom",
                offset,
                width: doorWidth,
                clearanceDepth: 900,
                hinge: "start",
            },
        ],
        windows: [],
        radiators: [],
    });

    it("rejects the audited sofa barrier with only 100 mm left at both walls", () => {
        const room = roomWithBottomDoor(2400, 1000);
        const sofaBarrier = placement("sofa-three-1", "sofa-three", 100, 1400);
        const analysis = analyzeConnectedAccess(room, [sofaBarrier]);
        const result = validateLayout(room, [sofaBarrier]);

        expect(analysis).toEqual(
            expect.objectContaining({
                applicable: true,
                connected: false,
                minimumPassageWidth: 700,
                proofWidth: 650,
                cellEnvelope: 50,
            }),
        );
        expect(result.issues).toContainEqual(
            expect.objectContaining({
                code: "access-path-blocked",
                instanceIds: ["sofa-three-1"],
            }),
        );
    });

    it.each([
        [599, false],
        [600, false],
        [649, false],
        [650, false],
        [699, false],
        [700, true],
        [701, true],
    ] as const)(
        "requires the physical door opening %i mm to meet the full 700 mm target: %s",
        (doorWidth, trusted) => {
            const room = roomWithBottomDoor(3600, 1350, doorWidth);
            const analysis = analyzeConnectedAccess(room, []);
            const result = validateLayout(room, []);
            const narrowDoorIssue = result.issues.find(
                (issue) => issue.code === "access-door-too-narrow",
            );

            expect(analysis.applicable).toBe(trusted);
            expect(analysis.connected).toBe(trusted);
            expect(narrowDoorIssue !== undefined).toBe(!trusted);
            if (!trusted) {
                expect(narrowDoorIssue?.message).toContain(`${doorWidth} мм`);
                expect(narrowDoorIssue?.message).toContain("700 мм");
            }
        },
    );

    it.each(["top", "right", "bottom", "left"] as const)(
        "anchors an exact 700 mm trusted seed to the physical %s opening",
        (wall) => {
            const room: Room = {
                width: 4000,
                depth: 4000,
                doors: [
                    {
                        id: `door-${wall}`,
                        wall,
                        offset: 1650,
                        width: 700,
                        clearanceDepth: 900,
                        hinge: "start",
                    },
                ],
                windows: [],
                radiators: [],
            };

            expect(analyzeConnectedAccess(room, [])).toEqual(
                expect.objectContaining({
                    applicable: true,
                    connected: true,
                }),
            );
            expect(validateLayout(room, [])).toEqual({ valid: true, issues: [] });
        },
    );

    it("accepts an exact 700 mm side passage at the documented boundary", () => {
        const room = roomWithBottomDoor(3600, 1350);
        const sofa = placement("sofa-three-1", "sofa-three", 700, 1400);

        expect(MIN_CONNECTED_PASSAGE_WIDTH).toBe(700);
        expect(ACCESS_PATH_CELL_ENVELOPE).toBe(50);
        expect(ACCESS_PATH_PROOF_WIDTH).toBe(650);
        expect(analyzeConnectedAccess(room, [sofa]).connected).toBe(true);
        expect(validateLayout(room, [sofa])).toEqual({ valid: true, issues: [] });
    });

    it("rejects the exact 650 mm lower proof boundary", () => {
        const room = roomWithBottomDoor(3500, 1300);
        const sofa = placement("sofa-three-1", "sofa-three", 650, 1400);

        expect(analyzeConnectedAccess(room, [sofa]).connected).toBe(false);
    });

    it("rejects immediately below the 650 mm proof-envelope boundary", () => {
        const room = roomWithBottomDoor(3498, 1299);
        const sofa = placement("sofa-three-1", "sofa-three", 649, 1400);

        expect(analyzeConnectedAccess(room, [sofa]).connected).toBe(false);
    });

    it("proves a 600 mm side passage blocked even with the 50 mm proof envelope", () => {
        const room = roomWithBottomDoor(3400, 1250);
        const sofa = placement("sofa-three-1", "sofa-three", 600, 1400);

        expect(analyzeConnectedAccess(room, [sofa]).connected).toBe(false);
        expect(
            validateLayout(room, [sofa]).issues.some(
                (issue) => issue.code === "access-path-blocked",
            ),
        ).toBe(true);
    });

    it("keeps the radiator body physical while allowing access through its empty service zone", () => {
        const room: Room = {
            width: 3000,
            depth: 4000,
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 1050,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
            windows: [],
            radiators: [
                {
                    id: "radiator",
                    wall: "left",
                    offset: 1400,
                    width: 950,
                    depth: 100,
                    clearanceDepth: 700,
                },
            ],
        };
        const sofa = placement("sofa-three-1", "sofa-three", 800, 1400);
        const serviceZoneBlocked = placement("sofa-three-2", "sofa-three", 700, 1400);

        expect(analyzeConnectedAccess(room, [sofa]).connected).toBe(true);
        expect(validateLayout(room, [sofa])).toEqual({ valid: true, issues: [] });
        expect(
            validateLayout(room, [serviceZoneBlocked]).issues.some(
                (issue) => issue.code === "radiator-blocked",
            ),
        ).toBe(true);
    });
});

describe("door opening direction", () => {
    const room: Room = {
        width: 4000,
        depth: 4000,
        doors: [
            {
                id: "door",
                wall: "bottom",
                offset: 500,
                width: 900,
                clearanceDepth: 900,
                hinge: "start",
            },
        ],
        windows: [],
        radiators: [],
    };

    it("reserves the swing inside the room by default, but only the physical doorway outside", () => {
        const inwardDoor = room.doors[0];
        const outwardDoor = { ...inwardDoor, swingDirection: "outward" as const };

        expect(getDoorObstacle(inwardDoor, room).depth).toBe(900);
        expect(getDoorObstacle(outwardDoor, { ...room, doors: [outwardDoor] }).depth).toBe(
            DOORWAY_KEEP_CLEAR_DEPTH,
        );
    });

    it("keeps the interior doorway approach clear even when the door opens outside", () => {
        const furnitureAtSwing = placement("coffee", "coffee-table", 650, 3300);
        const inwardIssues = validatePlacement(furnitureAtSwing, room, []).issues;
        const outwardRoom: Room = {
            ...room,
            doors: [{ ...room.doors[0], swingDirection: "outward" }],
        };
        const outwardIssues = validatePlacement(furnitureAtSwing, outwardRoom, []).issues;

        expect(inwardIssues.some((issue) => issue.code === "door-blocked")).toBe(true);
        expect(outwardIssues.some((issue) => issue.code === "door-blocked")).toBe(true);
    });
});

describe("room openings and adjacent corners", () => {
    it.each([
        [
            "door",
            {
                doors: [
                    {
                        id: "door",
                        wall: "top" as const,
                        offset: 5600,
                        width: 500,
                        clearanceDepth: 900,
                    },
                ],
            },
        ],
        [
            "window",
            {
                windows: [{ id: "window", wall: "top" as const, offset: 5900, width: 200 }],
            },
        ],
        [
            "radiator",
            {
                radiators: [
                    {
                        id: "radiator",
                        wall: "top" as const,
                        offset: 5700,
                        width: 400,
                        depth: 100,
                        clearanceDepth: 300,
                    },
                ],
            },
        ],
    ])("rejects a %s that exceeds its wall", (_label, patch) => {
        expect(validateRoomGeometry({ ...EMPTY_ROOM, ...patch })).not.toBeNull();
    });

    it.each([
        [
            "two windows",
            {
                windows: [
                    { id: "window-1", wall: "top" as const, offset: 1000, width: 1200 },
                    { id: "window-2", wall: "top" as const, offset: 2000, width: 1200 },
                ],
            },
        ],
        [
            "door and window",
            {
                doors: [
                    {
                        id: "door",
                        wall: "top" as const,
                        offset: 1000,
                        width: 900,
                        clearanceDepth: 900,
                    },
                ],
                windows: [{ id: "window", wall: "top" as const, offset: 1800, width: 1200 }],
            },
        ],
        [
            "door and radiator",
            {
                doors: [
                    {
                        id: "door",
                        wall: "top" as const,
                        offset: 1000,
                        width: 900,
                        clearanceDepth: 900,
                    },
                ],
                radiators: [
                    {
                        id: "radiator",
                        wall: "top" as const,
                        offset: 1800,
                        width: 1000,
                        depth: 100,
                        clearanceDepth: 300,
                    },
                ],
            },
        ],
        [
            "two radiators",
            {
                radiators: [
                    {
                        id: "radiator-1",
                        wall: "top" as const,
                        offset: 1000,
                        width: 1000,
                        depth: 100,
                        clearanceDepth: 300,
                    },
                    {
                        id: "radiator-2",
                        wall: "top" as const,
                        offset: 1900,
                        width: 1000,
                        depth: 100,
                        clearanceDepth: 300,
                    },
                ],
            },
        ],
    ])("rejects same-wall overlap: %s", (_label, patch) => {
        expect(validateRoomGeometry({ ...EMPTY_ROOM, ...patch })).not.toBeNull();
    });

    it("uses full same-wall curtain envelopes even when the physical openings do not overlap", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            windows: [
                { id: "window-1", wall: "top", offset: 1000, width: 1000 },
                { id: "window-2", wall: "top", offset: 2200, width: 1000 },
            ],
        };

        expect(validateRoomGeometry(room)).toContain("Полные буферы окон");
    });

    it("rejects a same-wall door entering only the 150 mm curtain buffer", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            doors: [
                {
                    id: "door",
                    wall: "top",
                    offset: 0,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
            windows: [{ id: "window", wall: "top", offset: 1000, width: 1000 }],
        };

        expect(validateRoomGeometry(room)).toContain("полный буфер окна");
    });

    it("allows a radiator below a window on the same wall", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            windows: [{ id: "window", wall: "top", offset: 1000, width: 1200 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "top",
                    offset: 1100,
                    width: 1000,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        };

        expect(validateRoomGeometry(room)).toBeNull();
    });

    it("allows only a radiator wholly under the actual window, not beside it in the curtain buffer", () => {
        const partlyOutside: Room = {
            ...EMPTY_ROOM,
            windows: [{ id: "window", wall: "top", offset: 1000, width: 1200 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "top",
                    offset: 900,
                    width: 400,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        };
        const besideInBuffer: Room = {
            ...EMPTY_ROOM,
            windows: [{ id: "window", wall: "top", offset: 1000, width: 1200 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "top",
                    offset: 2250,
                    width: 500,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        };

        expect(validateRoomGeometry(partlyOutside)).toContain("полностью расположен под");
        expect(validateRoomGeometry(besideInBuffer)).toContain("полностью расположен под");
    });

    it("rejects a door swing and window buffer that overlap across a corner", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            doors: [
                {
                    id: "door",
                    wall: "top",
                    offset: 5100,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
            windows: [{ id: "window", wall: "right", offset: 0, width: 1000 }],
        };

        expect(validateRoomGeometry(room)).toContain("соседних стенах");
    });

    it("rejects a window buffer and radiator service zone across a corner", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            windows: [{ id: "window", wall: "top", offset: 0, width: 1000 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "left",
                    offset: 0,
                    width: 900,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        };

        expect(validateRoomGeometry(room)).toContain("соседних стенах");
    });

    it("rejects a door swing and radiator service zone across a corner", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            doors: [
                {
                    id: "door",
                    wall: "top",
                    offset: 0,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
            radiators: [
                {
                    id: "radiator",
                    wall: "left",
                    offset: 0,
                    width: 900,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        };

        expect(validateRoomGeometry(room)).toContain("соседних стенах");
    });

    it("accepts the same adjacent-wall objects when their 2D zones are separated", () => {
        const room: Room = {
            ...EMPTY_ROOM,
            doors: [
                {
                    id: "door",
                    wall: "top",
                    offset: 0,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
            windows: [{ id: "window", wall: "right", offset: 1500, width: 1000 }],
        };

        expect(validateRoomGeometry(room)).toBeNull();
    });
});
