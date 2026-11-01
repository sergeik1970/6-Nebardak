import { MAX_DRAWN_CONTOUR_MM } from "./draw-room-grid";
import {
    PROVISIONAL_CURTAIN_BUFFER_MM,
    getFurniture,
    getViewingDistanceRange,
    relationTargetsDefinition,
} from "./catalog";
import {
    DEFAULT_BODY_GAP,
    expandRect,
    getBounds,
    getRotatedGeometry,
    getWorldAlternativeClearanceRects,
    getWorldBodyRects,
    getWorldClearanceRects,
    getWorldHardClearanceRects,
    getWorldPreferredClearanceRects,
    rectInsideRoom,
    rectsIntersect,
    resolveRelationGapRange,
    toWorldRect,
} from "./geometry-shapes";
import {
    canonicalRoomGeometry,
    getRoomBoundarySegments,
    getRoomPartitionSegments,
    getRoomVertices,
    getRoomSegment,
    getSegmentSpanRect,
    pointInsideRoom,
    rectInsideRoomGeometry,
    rectTouchesRoomBoundary,
    validateOrthogonalRoomGeometry,
} from "./room-geometry";
export {
    DEFAULT_BODY_GAP,
    expandRect,
    getBounds,
    getRotatedGeometry,
    getWorldAlternativeClearanceRects,
    getWorldBodyRects,
    getWorldClearanceRects,
    getWorldHardClearanceRects,
    getWorldPreferredClearanceRects,
    rectInsideRoom,
    rectsIntersect,
    resolveRelationGapRange,
} from "./geometry-shapes";
import {
    ClearanceZone,
    DoorOpening,
    DoorKind,
    FurnitureBodyEdge,
    FurnitureDefinition,
    LayoutPreferences,
    Placement,
    RadiatorObstacle,
    Rect,
    RelationKind,
    RelationTemplate,
    Room,
    RoomBoundarySegment,
    RotatedGeometry,
    Rotation,
    ValidationIssue,
    ValidationResult,
    Wall,
    WindowOpening,
} from "./types";

export const GRID_SIZE = 50;
/** Keep the physical doorway clear even when the leaf opens outside the room. */
export const DOORWAY_KEEP_CLEAR_DEPTH = GRID_SIZE;
/** Designer clearances consistently use 700 mm as the minimum human passage. */
export const MIN_CONNECTED_PASSAGE_WIDTH = 700;
/**
 * The hard proof deliberately grants one 50 mm cell envelope of extra space.
 * A real 700 mm passage leaves a positive 50 mm configuration-space corridor
 * for the 650 mm proof agent, so the cell decomposition cannot erase it.
 * Therefore a rejection cannot be caused solely by discretising a real path.
 */
export const ACCESS_PATH_CELL_ENVELOPE = GRID_SIZE;
export const ACCESS_PATH_PROOF_WIDTH = MIN_CONNECTED_PASSAGE_WIDTH - ACCESS_PATH_CELL_ENVELOPE;

export const getTrustedAccessDoorError = (room: Room): string | null => {
    const undersizedDoor = room.doors.find(
        (door) => !door.partitionId && door.width < MIN_CONNECTED_PASSAGE_WIDTH,
    );
    if (!undersizedDoor) return null;

    return `Ширина двери ${undersizedDoor.width} мм допустима для описания комнаты, но она меньше целевого прохода ${MIN_CONNECTED_PASSAGE_WIDTH} мм. Доверенный проход ${MIN_CONNECTED_PASSAGE_WIDTH} мм не подтверждён; увеличьте проём для расчёта проверенного варианта.`;
};

const VALID_DOOR_KINDS = new Set<DoorKind>([
    "room",
    "balcony",
    "swing-double",
    "sliding-single",
    "sliding-double",
]);

/** Sliding apertures remain real cut-outs but have no hinge/swing reservation. */
export const isHingedDoor = (door: Pick<DoorOpening, "doorKind">): boolean =>
    (door.doorKind ?? "room") === "room" ||
    door.doorKind === "balcony" ||
    door.doorKind === "swing-double";

export const doorOpensIntoRoom = (door: DoorOpening): boolean =>
    isHingedDoor(door) && (door.swingDirection ?? "inward") === "inward";

/** Double doors have two half-width leaves, matching the drawn opening arcs. */
export const getDoorOpeningDepth = (door: DoorOpening): number =>
    Math.max(door.width, door.clearanceDepth) / (door.doorKind === "swing-double" ? 2 : 1);

export const getDoorObstacle = (door: DoorOpening, room: Room): Rect => {
    const clearanceDepth = doorOpensIntoRoom(door)
        ? getDoorOpeningDepth(door)
        : DOORWAY_KEEP_CLEAR_DEPTH;
    const segment = getRoomSegment(room, door);
    return segment
        ? getSegmentSpanRect(segment, door.offset, door.width, 0, clearanceDepth)
        : { x: 0, y: 0, width: 0, depth: 0 };
};

const openingAnchorId = (opening: { wall: Wall; segmentId?: string; partitionId?: string }) =>
    opening.partitionId ?? opening.segmentId ?? opening.wall;

const mergeIntervals = (intervals: Array<{ start: number; end: number }>) =>
    [...intervals]
        .sort((first, second) => first.start - second.start)
        .reduce<Array<{ start: number; end: number }>>((merged, interval) => {
            const previous = merged[merged.length - 1];
            if (previous && interval.start <= previous.end) {
                previous.end = Math.max(previous.end, interval.end);
                return merged;
            }
            merged.push({ ...interval });
            return merged;
        }, []);

/**
 * The drawn leaf is intentionally separate from the collision envelope: an
 * outward-opening door still keeps its doorway clear, but its leaf is outside
 * the room and must not consume interior furniture space.
 */
export const getDoorSwingObstacle = (door: DoorOpening, room: Room): Rect => {
    const segment = getRoomSegment(room, door);
    if (!segment) return { x: 0, y: 0, width: 0, depth: 0 };

    if (!isHingedDoor(door)) {
        return getSegmentSpanRect(segment, door.offset, door.width, 0, DOORWAY_KEEP_CLEAR_DEPTH);
    }

    const swingDepth = getDoorOpeningDepth(door);
    return getSegmentSpanRect(
        segment,
        door.offset,
        door.width,
        doorOpensIntoRoom(door) ? 0 : -swingDepth,
        swingDepth,
    );
};

const getSolidWallIntervals = (
    length: number,
    openings: Array<Pick<DoorOpening | WindowOpening, "offset" | "width">>,
) => {
    const cutouts = mergeIntervals(
        openings
            .map((opening) => ({
                start: Math.max(0, opening.offset),
                end: Math.min(length, opening.offset + opening.width),
            }))
            .filter((interval) => interval.end > interval.start),
    );

    return [...cutouts, { start: length, end: length }].reduce<
        Array<{ start: number; end: number }>
    >((solid, cutout, index) => {
        const start = index === 0 ? 0 : cutouts[index - 1].end;
        if (cutout.start > start) solid.push({ start, end: cutout.start });
        return solid;
    }, []);
};

/**
 * Physical exterior bands start at the clear room contour and run outward.
 * Missing `wallThickness` is a legacy 50 mm room, while DrawRoom scenes keep
 * their explicit 100 mm construction material.
 */
const getPerimeterMaterialObstacles = (room: Room): WallObstacle[] => {
    const wallThickness = room.wallThickness ?? GRID_SIZE;
    const exteriorOpenings = [...room.doors.filter((door) => !door.partitionId), ...room.windows];

    return getRoomBoundarySegments(room).flatMap((segment) => {
        const solidIntervals = getSolidWallIntervals(
            segment.length,
            exteriorOpenings.filter((opening) => getRoomSegment(room, opening)?.id === segment.id),
        );
        return solidIntervals.map((interval) => ({
            anchorId: `perimeter:${segment.id}`,
            rect: getSegmentSpanRect(
                segment,
                interval.start,
                interval.end - interval.start,
                -wallThickness,
                wallThickness,
            ),
        }));
    });
};

const getPartitionMaterialObstacles = (room: Room): WallObstacle[] =>
    (room.partitions ?? []).flatMap((partition) => {
        const segment = getRoomPartitionSegments(room).find(
            (candidate) => candidate.id === partition.id,
        );
        if (!segment) return [];
        const solidIntervals = getSolidWallIntervals(
            segment.length,
            room.doors.filter((door) => door.partitionId === partition.id),
        );

        return solidIntervals.map((interval) => ({
            anchorId: `partition:${partition.id}`,
            rect: getSegmentSpanRect(
                segment,
                interval.start,
                interval.end - interval.start,
                -partition.thickness / 2,
                partition.thickness,
            ),
        }));
    });

const pointsMatch = (
    first: Pick<RoomBoundarySegment, "start">["start"],
    second: Pick<RoomBoundarySegment, "start">["start"],
) => first.x === second.x && first.y === second.y;

/**
 * A legacy exterior aperture may begin at a perimeter corner. Its inward
 * envelope then only meets the adjoining perimeter band at its own jamb. Keep
 * that exact shared join legal, while retaining the contact tolerance for
 * every other non-host exterior/partition band.
 */
const isOwnPerimeterJambJoin = (
    door: DoorOpening,
    hostSegment: RoomBoundarySegment,
    obstacle: WallObstacle,
    room: Room,
) => {
    if (door.partitionId || !obstacle.anchorId.startsWith("perimeter:")) return false;
    const obstacleSegment = getRoomBoundarySegments(room).find(
        (segment) => obstacle.anchorId === `perimeter:${segment.id}`,
    );
    if (!obstacleSegment) return false;
    const atHostStart = door.offset <= DOOR_MATERIAL_CONTACT_TOLERANCE_MM;
    const atHostEnd =
        door.offset + door.width >= hostSegment.length - DOOR_MATERIAL_CONTACT_TOLERANCE_MM;
    return (
        (atHostStart &&
            (pointsMatch(hostSegment.start, obstacleSegment.start) ||
                pointsMatch(hostSegment.start, obstacleSegment.end))) ||
        (atHostEnd &&
            (pointsMatch(hostSegment.end, obstacleSegment.start) ||
                pointsMatch(hostSegment.end, obstacleSegment.end)))
    );
};

/** Bodies of pinned pieces: other furniture stays clear of them like a wall. */
export const getFixedFurnitureBodies = (room: Room): Rect[] => room.fixedFurniture?.bodies ?? [];

/** Solid portions of internal walls after subtracting their door cut-outs. */
export const getPartitionObstacleRects = (room: Room): Rect[] =>
    getPartitionMaterialObstacles(room).map((obstacle) => obstacle.rect);

/** The same material, each piece knowing whether its partition bears load. */
export const getPartitionMaterial = (room: Room): { rect: Rect; loadBearing: boolean }[] =>
    getPartitionMaterialObstacles(room).map(({ rect, anchorId }) => ({
        rect,
        loadBearing: Boolean(
            room.partitions?.find((partition) => `partition:${partition.id}` === anchorId)
                ?.loadBearing,
        ),
    }));

/** Full closed-to-open travel, using the same 35 mm leaf and 25 mm gap as the drawing. */
export const getSlidingDoorTravel = (door: DoorOpening, room: Room): Rect[] => {
    const host = getRoomSegment(room, door);
    if (!host || isHingedDoor(door)) return [];
    const thickness = door.partitionId
        ? room.partitions?.find((p) => p.id === door.partitionId)?.thickness ?? 50
        : room.wallThickness ?? GRID_SIZE;
    const inside = door.partitionId ? thickness / 2 : 0;
    const mount = door.slidingMount ?? "inward";
    const depthStart =
        mount === "pocket"
            ? inside - thickness / 2 - 17.5
            : mount === "outward"
              ? inside - thickness - 60
              : inside + 25;
    const leaf = door.doorKind === "sliding-double" ? door.width / 2 : door.width;
    const start =
        door.offset -
        (door.doorKind === "sliding-double" || door.slidingDirection !== "end" ? leaf : 0);
    const end =
        door.offset +
        door.width +
        (door.doorKind === "sliding-double" || door.slidingDirection === "end" ? leaf : 0);
    return [getSegmentSpanRect(host, start, end - start, depthStart, 35)];
};

const getSlidingDoorCollisionError = (door: DoorOpening, room: Room): string | null => {
    const host = getRoomSegment(room, door);
    if (!host || isHingedDoor(door)) return null;
    const leaf = door.doorKind === "sliding-double" ? door.width / 2 : door.width;
    const pockets = [
        ...(door.doorKind === "sliding-double" || door.slidingDirection !== "end"
            ? [{ start: door.offset - leaf, end: door.offset }]
            : []),
        ...(door.doorKind === "sliding-double" || door.slidingDirection === "end"
            ? [{ start: door.offset + door.width, end: door.offset + door.width + leaf }]
            : []),
    ];
    if (pockets.some((p) => p.start < 0 || p.end > host.length))
        return "Раздвижная дверь не сможет открыться полностью: вдоль стены не хватает места для полотна. Измените положение, ширину или направление сдвига.";
    if (door.slidingMount === "pocket") {
        const thickness = door.partitionId
            ? room.partitions?.find((p) => p.id === door.partitionId)?.thickness ?? 50
            : room.wallThickness ?? GRID_SIZE;
        if (thickness < 55)
            return "Для пенала недостаточно толщины стены: полотно 35 мм и зазоры требуют не менее 55 мм.";
        const openings = [...room.doors.filter((d) => d.id !== door.id), ...room.windows];
        if (
            openings.some(
                (o) =>
                    getRoomSegment(room, o)?.id === host.id &&
                    pockets.some((p) => p.start < o.offset + o.width && p.end > o.offset),
            )
        )
            return "Пенал раздвижной двери пересекает другой проём.";
    }
    const anchor = door.partitionId ? `partition:${door.partitionId}` : `perimeter:${host.id}`;
    const materials = [
        ...getPerimeterMaterialObstacles(room),
        ...getPartitionMaterialObstacles(room),
    ].filter((o) => o.anchorId !== anchor);
    if (
        getSlidingDoorTravel(door, room).some((travel) =>
            materials.some((o) => rectsIntersect(expandRect(travel, 1), o.rect)),
        )
    )
        return "Полотно раздвижной двери при открывании упирается в стену. Измените сторону монтажа, направление или положение двери.";
    return null;
};

/** One millimetre catches an endpoint or T-contact without widening a valid bay. */
const DOOR_MATERIAL_CONTACT_TOLERANCE_MM = 1;

/** Keep the doorway, swing and sliding-leaf travel free of furniture. */
export const getDoorFurnitureObstacles = (door: DoorOpening, room: Room): Rect[] => {
    const segment = getRoomSegment(room, door);
    const accessDepth = getDoorOpeningDepth(door);
    return [
        getDoorObstacle(door, room),
        getDoorSwingObstacle(door, room),
        ...getSlidingDoorTravel(door, room),
        ...(segment
            ? [getSegmentSpanRect(segment, door.offset, door.width, -accessDepth, accessDepth * 2)]
            : []),
    ];
};

/**
 * Returns a human-readable error when a door leaf or its mandatory clearance
 * would enter material that is not the door's own aperture host. Sliding
 * doors reserve the full lateral travel as well as doorway clearance; hinged
 * kinds also reserve the actual swing envelope. This is intentionally shared by the editor, draft
 * validation and Planner/solver validation via `validateRoomGeometry`.
 */
export const getDoorMaterialCollisionError = (door: DoorOpening, room: Room): string | null => {
    const hostSegment = getRoomSegment(room, door);
    if (!hostSegment) {
        return "Дверь должна быть привязана к существующей стене.";
    }
    // The material model includes every exterior and partition band, but each
    // actual opening is subtracted before comparison. Exclude its host band
    // as a whole so the normal jamb contact at the aperture edge is not a
    // false 1 mm collision; every non-host exterior or partition band remains
    // physical, including an exterior wall next to a partition.
    const hostAnchor = door.partitionId
        ? `partition:${door.partitionId}`
        : `perimeter:${hostSegment.id}`;
    const obstacles = [
        ...getPerimeterMaterialObstacles(room),
        ...getPartitionMaterialObstacles(room),
    ].filter((obstacle) => obstacle.anchorId !== hostAnchor);
    const envelopes = [getDoorObstacle(door, room)];
    if (isHingedDoor(door)) envelopes.push(getDoorSwingObstacle(door, room));

    const blocked = envelopes.some((envelope) =>
        obstacles.some((obstacle) => {
            // Only a host aperture's own perimeter jamb may share a corner
            // with a neighbouring exterior band. Every other material keeps
            // the 1 mm endpoint/T/corner-contact rule.
            const sharedExteriorJoin = isOwnPerimeterJambJoin(door, hostSegment, obstacle, room);
            return rectsIntersect(
                sharedExteriorJoin
                    ? envelope
                    : expandRect(envelope, DOOR_MATERIAL_CONTACT_TOLERANCE_MM),
                sharedExteriorJoin
                    ? obstacle.rect
                    : expandRect(obstacle.rect, DOOR_MATERIAL_CONTACT_TOLERANCE_MM),
            );
        }),
    );
    return blocked
        ? "Створка или обязательная зона двери пересекает другую стену. Переместите проём или измените сторону открывания."
        : getSlidingDoorCollisionError(door, room);
};

/**
 * Conservative provisional curtain envelope. The source gives 150 mm but not
 * its direction, so the MVP reserves that distance both along the wall at both
 * window ends and perpendicular into the room. This must be narrowed only
 * after designer confirmation.
 */
export const getWindowCurtainObstacle = (
    window: WindowOpening,
    room: Room,
    distance = PROVISIONAL_CURTAIN_BUFFER_MM,
): Rect => {
    const segment = getRoomSegment(room, window);
    if (!segment) return { x: 0, y: 0, width: 0, depth: 0 };
    const wallSpan = segment.length;
    const start = Math.max(0, window.offset - distance);
    const end = Math.min(wallSpan, window.offset + window.width + distance);
    return getSegmentSpanRect(segment, start, end - start, 0, distance);
};

/** Side pockets of the provisional curtain envelope. Window-approved objects
 * may project under the opening itself, but they still reserve these pockets. */
export const getWindowCurtainSideObstacles = (
    window: WindowOpening,
    room: Room,
    distance = PROVISIONAL_CURTAIN_BUFFER_MM,
): Rect[] => {
    const segment = getRoomSegment(room, window);
    if (!segment) return [];
    const start = Math.max(0, window.offset - distance);
    const end = Math.min(segment.length, window.offset + window.width + distance);
    const rightStart = window.offset + window.width;

    return [
        getSegmentSpanRect(segment, start, window.offset - start, 0, distance),
        getSegmentSpanRect(segment, rightStart, end - rightStart, 0, distance),
    ].filter((rect) => rect.width > 0 && rect.depth > 0);
};

export const getRadiatorBody = (radiator: RadiatorObstacle, room: Room): Rect => {
    const segment = getRoomSegment(room, radiator);
    return segment
        ? getSegmentSpanRect(segment, radiator.offset, radiator.width, 0, radiator.depth)
        : { x: 0, y: 0, width: 0, depth: 0 };
};

export const getRadiatorServiceObstacle = (radiator: RadiatorObstacle, room: Room): Rect => {
    const segment = getRoomSegment(room, radiator);
    return segment
        ? getSegmentSpanRect(
              segment,
              radiator.offset,
              radiator.width,
              radiator.depth,
              radiator.clearanceDepth,
          )
        : { x: 0, y: 0, width: 0, depth: 0 };
};

const wallLength = (room: Room, wall: Wall): number =>
    wall === "top" || wall === "bottom" ? room.width : room.depth;

const perpendicularRoomLength = (room: Room, wall: Wall): number =>
    wall === "top" || wall === "bottom" ? room.depth : room.width;

interface WallSegment {
    wall: Wall;
    segmentId?: string;
    partitionId?: string;
    offset: number;
    width: number;
}

const wallSegmentsOverlap = (first: WallSegment, second: WallSegment): boolean =>
    openingAnchorId(first) === openingAnchorId(second) &&
    first.offset < second.offset + second.width &&
    first.offset + first.width > second.offset;

const listHasWallOverlap = (segments: WallSegment[]): boolean =>
    segments.some((segment, index) =>
        segments.slice(index + 1).some((candidate) => wallSegmentsOverlap(segment, candidate)),
    );

const listsHaveWallOverlap = (first: WallSegment[], second: WallSegment[]): boolean =>
    first.some((segment) => second.some((candidate) => wallSegmentsOverlap(segment, candidate)));

interface WallObstacle {
    anchorId: string;
    rect: Rect;
}

const differentWallObstaclesOverlap = (
    first: WallObstacle[],
    second: WallObstacle[] = first,
): boolean =>
    first.some((obstacle, firstIndex) =>
        second.some((candidate, secondIndex) => {
            if (first === second && secondIndex <= firstIndex) return false;
            return (
                obstacle.anchorId !== candidate.anchorId &&
                rectsIntersect(obstacle.rect, candidate.rect)
            );
        }),
    );

const sameWallObstaclesOverlap = (first: WallObstacle[], second: WallObstacle[] = first): boolean =>
    first.some((obstacle, firstIndex) =>
        second.some((candidate, secondIndex) => {
            if (first === second && secondIndex <= firstIndex) return false;
            return (
                obstacle.anchorId === candidate.anchorId &&
                rectsIntersect(obstacle.rect, candidate.rect)
            );
        }),
    );

const getRadiatorEnvelope = (radiator: RadiatorObstacle, room: Room): Rect =>
    getBounds([getRadiatorBody(radiator, room), getRadiatorServiceObstacle(radiator, room)]);

export const validateRoomGeometry = (room: Room): string | null => {
    if (
        !Number.isFinite(room.width) ||
        !Number.isFinite(room.depth) ||
        room.width < 2400 ||
        room.depth < 2400 ||
        room.width > MAX_DRAWN_CONTOUR_MM ||
        room.depth > MAX_DRAWN_CONTOUR_MM
    ) {
        return "Проверьте размеры комнаты: допустимый диапазон — от 2400 до 30 000 мм.";
    }

    const contourError = validateOrthogonalRoomGeometry(room);
    if (contourError) return contourError;

    const partitionIds = new Set<string>();
    const invalidPartition = (room.partitions ?? []).some((partition) => {
        const segment = getRoomPartitionSegments({ ...room, partitions: [partition] })[0];
        const validId =
            typeof partition.id === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(partition.id) &&
            !partitionIds.has(partition.id);
        if (validId) partitionIds.add(partition.id);
        return (
            !validId ||
            !segment ||
            !Number.isFinite(partition.thickness) ||
            partition.thickness <= 0 ||
            !pointInsideRoom(room, partition.start) ||
            !pointInsideRoom(room, partition.end)
        );
    });
    if (invalidPartition) {
        return "Проверьте перегородки: у каждой нужны уникальный идентификатор, ортогональная линия внутри комнаты и положительная толщина.";
    }

    const invalidDoor = room.doors.some((door) => {
        const segment = getRoomSegment(room, door);
        const obstacle = getDoorObstacle(door, room);
        return (
            !segment ||
            (!door.partitionId && segment.wall !== door.wall) ||
            (door.partitionId !== undefined && !partitionIds.has(door.partitionId)) ||
            !Number.isFinite(door.offset) ||
            !Number.isFinite(door.width) ||
            !Number.isFinite(door.clearanceDepth) ||
            door.offset < 0 ||
            door.width <= 0 ||
            door.offset + door.width > segment.length ||
            door.clearanceDepth <= 0 ||
            door.clearanceDepth >
                (door.partitionId
                    ? Math.max(room.width, room.depth)
                    : perpendicularRoomLength(room, door.wall)) ||
            (door.hinge !== undefined && door.hinge !== "start" && door.hinge !== "end") ||
            (door.swingDirection !== undefined &&
                door.swingDirection !== "inward" &&
                door.swingDirection !== "outward") ||
            (door.doorKind !== undefined && !VALID_DOOR_KINDS.has(door.doorKind)) ||
            (door.slidingMount !== undefined &&
                !["inward", "outward", "pocket"].includes(door.slidingMount)) ||
            (door.slidingDirection !== undefined &&
                !["start", "end"].includes(door.slidingDirection)) ||
            (!isHingedDoor(door) &&
                (door.hinge !== undefined || door.swingDirection !== undefined)) ||
            !rectInsideRoomGeometry(obstacle, room)
        );
    });

    if (invalidDoor) {
        return "Проверьте дверь: размеры, смещение и зона открывания должны находиться внутри комнаты.";
    }

    const doorMaterialCollision = room.doors
        .map((door) => getDoorMaterialCollisionError(door, room))
        .find((error): error is string => Boolean(error));
    if (doorMaterialCollision) return doorMaterialCollision;

    const invalidWindow = room.windows.some((window) => {
        const segment = getRoomSegment(room, window);
        return (
            !segment ||
            segment.wall !== window.wall ||
            !Number.isFinite(window.offset) ||
            !Number.isFinite(window.width) ||
            window.offset < 0 ||
            window.width <= 0 ||
            window.offset + window.width > segment.length ||
            (window.windowKind !== undefined &&
                window.windowKind !== "standard" &&
                window.windowKind !== "floor-to-ceiling") ||
            !rectInsideRoomGeometry(getWindowCurtainObstacle(window, room), room)
        );
    });

    if (invalidWindow) {
        return "Проверьте окно: ширина и смещение должны находиться в пределах выбранной стены.";
    }

    const invalidRadiator = (room.radiators ?? []).some((radiator) => {
        const segment = getRoomSegment(room, radiator);
        return (
            !segment ||
            segment.wall !== radiator.wall ||
            !Number.isFinite(radiator.offset) ||
            !Number.isFinite(radiator.width) ||
            !Number.isFinite(radiator.depth) ||
            !Number.isFinite(radiator.clearanceDepth) ||
            radiator.offset < 0 ||
            radiator.width <= 0 ||
            radiator.offset + radiator.width > segment.length ||
            radiator.depth <= 0 ||
            radiator.clearanceDepth < 0 ||
            !rectInsideRoomGeometry(getRadiatorBody(radiator, room), room) ||
            !rectInsideRoomGeometry(getRadiatorServiceObstacle(radiator, room), room)
        );
    });

    if (invalidRadiator) {
        return "Проверьте радиатор: корпус и сервисная зона должны находиться внутри комнаты.";
    }

    const radiators = room.radiators ?? [];

    if (listHasWallOverlap(room.doors)) {
        return "Двери на одной стене не должны пересекаться.";
    }

    if (listHasWallOverlap(radiators)) {
        return "Радиаторы на одной стене не должны пересекаться.";
    }

    if (listsHaveWallOverlap(room.doors, radiators)) {
        return "Дверь и радиатор не могут занимать один участок стены.";
    }

    const doorObstacles = room.doors.map((door) => ({
        anchorId: openingAnchorId(door),
        rect: getDoorObstacle(door, room),
    }));
    const windowObstacles = room.windows.map((window) => ({
        anchorId: openingAnchorId(window),
        rect: getWindowCurtainObstacle(window, room),
    }));
    const radiatorObstacles = radiators.map((radiator) => ({
        anchorId: openingAnchorId(radiator),
        rect: getRadiatorEnvelope(radiator, room),
    }));

    if (sameWallObstaclesOverlap(windowObstacles)) {
        return "Полные буферы окон на одной стене не должны пересекаться.";
    }

    if (sameWallObstaclesOverlap(doorObstacles, windowObstacles)) {
        return "Зона открывания двери не должна пересекать полный буфер окна.";
    }

    const hasInvalidWindowRadiatorOverlap = room.windows.some((window) =>
        radiators.some((radiator) => {
            if (openingAnchorId(window) !== openingAnchorId(radiator)) {
                return false;
            }

            const fullEnvelopesOverlap = rectsIntersect(
                getWindowCurtainObstacle(window, room),
                getRadiatorEnvelope(radiator, room),
            );
            if (!fullEnvelopesOverlap) return false;

            // The only approved exception is a radiator wholly below the
            // actual window opening. Merely touching the provisional 150 mm
            // curtain buffer beside a window is not this exception.
            const radiatorIsUnderWindow =
                radiator.offset >= window.offset &&
                radiator.offset + radiator.width <= window.offset + window.width;

            return !radiatorIsUnderWindow;
        }),
    );

    if (hasInvalidWindowRadiatorOverlap) {
        return "Радиатор может пересекать буфер окна только когда полностью расположен под самим окном.";
    }

    if (differentWallObstaclesOverlap(doorObstacles)) {
        return "Зоны открывания дверей на соседних стенах не должны пересекаться в углу.";
    }

    if (differentWallObstaclesOverlap(windowObstacles)) {
        return "Буферы окон на соседних стенах не должны пересекаться в углу.";
    }

    if (differentWallObstaclesOverlap(radiatorObstacles)) {
        return "Радиаторы и их сервисные зоны на соседних стенах не должны пересекаться в углу.";
    }

    if (differentWallObstaclesOverlap(doorObstacles, windowObstacles)) {
        return "Зона двери и буфер окна на соседних стенах не должны пересекаться в углу.";
    }

    if (differentWallObstaclesOverlap(doorObstacles, radiatorObstacles)) {
        return "Зона двери и радиатор на соседних стенах не должны пересекаться в углу.";
    }

    if (differentWallObstaclesOverlap(windowObstacles, radiatorObstacles)) {
        return "Буфер окна и радиатор на соседних стенах не должны пересекаться в углу.";
    }

    return null;
};

export const wallForBack = (rotation: Rotation): Wall => {
    switch (rotation) {
        case 90:
            return "right";
        case 180:
            return "bottom";
        case 270:
            return "left";
        default:
            return "top";
    }
};

const EDGE_ROTATION_OFFSET: Record<FurnitureBodyEdge, Rotation> = {
    back: 0,
    right: 90,
    front: 180,
    left: 270,
};

export const wallForBodyEdge = (rotation: Rotation, edge: FurnitureBodyEdge): Wall =>
    wallForBack(((rotation + EDGE_ROTATION_OFFSET[edge]) % 360) as Rotation);

const placementTouchesWall = (
    placement: Placement,
    geometry: RotatedGeometry,
    room: Room,
    wall: Wall,
): boolean => {
    return rectTouchesRoomBoundary(
        { x: placement.x, y: placement.y, width: geometry.width, depth: geometry.depth },
        room,
        wall,
    );
};

export const placementTouchesAllowedWall = (placement: Placement, room: Room): boolean => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation, placement);

    return definition.placement.allowedWallContactEdges.some((edge) =>
        placementTouchesWall(placement, geometry, room, wallForBodyEdge(placement.rotation, edge)),
    );
};

const placementBlocksWindow = (
    placement: Placement,
    geometry: RotatedGeometry,
    room: Room,
): boolean => {
    const definition = getFurniture(placement.definitionId);
    const bodyRects = geometry.bodyRects.map((rect) => toWorldRect(rect, placement));

    return room.windows.some((window) => {
        const distance = definition.placement.windowExclusionDistance;
        const segment = getRoomSegment(room, window);
        if (!segment) return true;
        const actualOpeningProjection = getSegmentSpanRect(
            segment,
            window.offset,
            window.width,
            0,
            distance,
        );
        if (window.windowKind === "floor-to-ceiling") {
            return bodyRects.some((body) =>
                rectsIntersect(body, getWindowCurtainObstacle(window, room, distance)),
            );
        }
        const bedProjectsUnderOpening =
            definition.category === "sleep" &&
            bodyRects.some((body) => rectsIntersect(body, actualOpeningProjection));

        // A bed may project under an opening only with its head/back edge
        // facing that wall. Feet-to-window layouts are rejected explicitly.
        if (
            bedProjectsUnderOpening &&
            wallForBodyEdge(placement.rotation, "back") !== segment.wall
        ) {
            return true;
        }

        const obstacles =
            definition.placement.windowPolicy === "forbidden"
                ? [getWindowCurtainObstacle(window, room, distance)]
                : getWindowCurtainSideObstacles(window, room, distance);

        return bodyRects.some((body) =>
            obstacles.some((obstacle) => rectsIntersect(body, obstacle)),
        );
    });
};

const roomIssues = (placement: Placement, room: Room): ValidationIssue[] => {
    const definition = getFurniture(placement.definitionId);
    const geometry = getRotatedGeometry(definition, placement.rotation, placement);
    const bodyRects = geometry.bodyRects.map((rect) => toWorldRect(rect, placement));
    const clearanceRects = geometry.hardClearanceRects.map((rect) => toWorldRect(rect, placement));
    const issues: ValidationIssue[] = [];

    if (bodyRects.some((rect) => !rectInsideRoom(rect, room))) {
        issues.push({
            code: "outside-room",
            message: `${definition.shortLabel}: корпус выходит за границы комнаты.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (clearanceRects.some((rect) => !rectInsideRoom(rect, room))) {
        issues.push({
            code: "clearance-outside-room",
            message: `${definition.shortLabel}: не хватает места для прохода или использования.`,
            instanceIds: [placement.instanceId],
        });
    }

    const doorObstacles = room.doors.flatMap((door) => getDoorFurnitureObstacles(door, room));
    const partitionObstacles = getPartitionObstacleRects(room);

    // A pinned piece stays put: nothing may stand on it or in its passages,
    // and a new piece's own passage may not run into it.
    const fixedBodies = getFixedFurnitureBodies(room);
    const fixedPassages = room.fixedFurniture?.passages ?? [];
    if (
        bodyRects.some((rect) =>
            [...fixedBodies, ...fixedPassages].some((obstacle) => rectsIntersect(rect, obstacle)),
        ) ||
        clearanceRects.some((rect) => fixedBodies.some((body) => rectsIntersect(rect, body)))
    ) {
        issues.push({
            code: "fixed-furniture-blocked",
            message: `${definition.shortLabel}: мешает закреплённой мебели или её проходу.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (
        [...bodyRects, ...clearanceRects].some((rect) =>
            partitionObstacles.some((obstacle) => rectsIntersect(rect, obstacle)),
        )
    ) {
        issues.push({
            code: "partition-blocked",
            message: `${definition.shortLabel}: предмет или его зона пересекает перегородку.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (
        [...bodyRects, ...clearanceRects].some((rect) =>
            doorObstacles.some((obstacle) => rectsIntersect(rect, obstacle)),
        )
    ) {
        issues.push({
            code: "door-blocked",
            message: `${definition.shortLabel}: предмет или его зона перекрывает дверь.`,
            instanceIds: [placement.instanceId],
        });
    }

    const radiatorBodies = (room.radiators ?? []).map((radiator) =>
        getRadiatorBody(radiator, room),
    );
    const radiatorServiceObstacles = (room.radiators ?? []).map((radiator) =>
        getRadiatorServiceObstacle(radiator, room),
    );
    const bodyBlocksRadiator = bodyRects.some((rect) =>
        [...radiatorBodies, ...radiatorServiceObstacles].some((obstacle) =>
            rectsIntersect(rect, obstacle),
        ),
    );
    const clearanceBlocksRadiatorBody = clearanceRects.some((rect) =>
        radiatorBodies.some((body) => rectsIntersect(rect, body)),
    );

    if (bodyBlocksRadiator || clearanceBlocksRadiatorBody) {
        issues.push({
            code: "radiator-blocked",
            message: `${definition.shortLabel}: корпус или рабочая зона перекрывает радиатор.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (definition.placement.requiredWallContact && !placementTouchesAllowedWall(placement, room)) {
        issues.push({
            code: "wall-contact",
            message: `${definition.shortLabel}: одна из разрешённых сторон без служебной зоны должна прилегать к стене.`,
            instanceIds: [placement.instanceId],
        });
    }

    if (placementBlocksWindow(placement, geometry, room)) {
        issues.push({
            code: "window-blocked",
            message: `${definition.shortLabel}: эта мебель не должна перекрывать окно.`,
            instanceIds: [placement.instanceId],
        });
    }

    return issues;
};

/**
 * Some furniture can be used from either of two sides. In this case the
 * designer requirement is an OR: blocking one side is fine as long as the
 * other alternative remains free of room obstacles and other furniture.
 */
const alternativeClearanceIssues = (
    placement: Placement,
    room: Room,
    allPlacements: Placement[],
): ValidationIssue[] => {
    const alternatives = getWorldAlternativeClearanceRects(placement);
    if (alternatives.length === 0) return [];

    const fixedObstacles = [
        ...room.doors.map((door) => getDoorObstacle(door, room)),
        ...getPartitionObstacleRects(room),
        ...getFixedFurnitureBodies(room),
        ...(room.radiators ?? []).map((radiator) => getRadiatorBody(radiator, room)),
    ];
    const otherBodies = allPlacements
        .filter((candidate) => candidate.instanceId !== placement.instanceId)
        .flatMap(getWorldBodyRects);
    const hasFreeAlternative = alternatives.some(
        (alternative) =>
            rectInsideRoom(alternative, room) &&
            !fixedObstacles.some((obstacle) => rectsIntersect(alternative, obstacle)) &&
            !otherBodies.some((body) => rectsIntersect(alternative, body)),
    );

    if (hasFreeAlternative) return [];

    const definition = getFurniture(placement.definitionId);
    return [
        {
            code: "alternative-clearance-blocked",
            message: `${definition.shortLabel}: освободите хотя бы один боковой проход 700 мм.`,
            instanceIds: [placement.instanceId],
        },
    ];
};

const pairIssues = (first: Placement, second: Placement): ValidationIssue[] => {
    const firstDefinition = getFurniture(first.definitionId);
    const secondDefinition = getFurniture(second.definitionId);
    const firstBodies = getWorldBodyRects(first);
    const secondBodies = getWorldBodyRects(second);
    const issues: ValidationIssue[] = [];

    if (
        firstBodies.some((firstRect) =>
            secondBodies.some((secondRect) =>
                rectsIntersect(expandRect(firstRect, DEFAULT_BODY_GAP), secondRect),
            ),
        )
    ) {
        issues.push({
            code: "body-overlap",
            message: `${firstDefinition.shortLabel} и ${secondDefinition.shortLabel}: нужен зазор не менее 50 мм.`,
            instanceIds: [first.instanceId, second.instanceId],
        });
        return issues;
    }

    const firstClearances = getWorldHardClearanceRects(first);
    const secondClearances = getWorldHardClearanceRects(second);
    const firstMayEnterSecondClearance = firstDefinition.relations.some(
        (relation) =>
            relation.clearanceOverlapException === "target-clearance" &&
            relationTargetsDefinition(relation, secondDefinition),
    );
    const secondMayEnterFirstClearance = secondDefinition.relations.some(
        (relation) =>
            relation.clearanceOverlapException === "target-clearance" &&
            relationTargetsDefinition(relation, firstDefinition),
    );
    // A zone may name the pieces that belong in it, e.g. a coffee table before a sofa.
    const blocks = (bodies: Rect[], definitionId: string, clearances: ClearanceZone[]) =>
        bodies.some((body) =>
            clearances.some(
                (clearance) =>
                    !clearance.allows?.includes(definitionId) && rectsIntersect(body, clearance),
            ),
        );
    const accessBlocked =
        (!firstMayEnterSecondClearance &&
            blocks(firstBodies, first.definitionId, secondClearances)) ||
        (!secondMayEnterFirstClearance &&
            blocks(secondBodies, second.definitionId, firstClearances));

    if (accessBlocked) {
        issues.push({
            code: "clearance-blocked",
            message: `${firstDefinition.shortLabel} и ${secondDefinition.shortLabel}: один предмет перекрывает рабочую зону другого.`,
            instanceIds: [first.instanceId, second.instanceId],
        });
    }

    return issues;
};

interface AxisCell {
    start: number;
    end: number;
}

interface AccessCell {
    rect: Rect;
    xIndex: number;
    yIndex: number;
    navigable: boolean;
    usableAtRequiredWidth: boolean;
}

export interface ConnectedAccessAnalysis {
    applicable: boolean;
    connected: boolean;
    minimumPassageWidth: number;
    proofWidth: number;
    cellEnvelope: number;
    usableCellCount: number;
    reachableUsableCellCount: number;
}

const rectContainsRect = (container: Rect, candidate: Rect): boolean =>
    candidate.x >= container.x &&
    candidate.y >= container.y &&
    candidate.x + candidate.width <= container.x + container.width &&
    candidate.y + candidate.depth <= container.y + container.depth;

const axisCells = (coordinates: number[]): AxisCell[] =>
    coordinates
        .slice(0, -1)
        .map((start, index) => ({ start, end: coordinates[index + 1] }))
        .filter((cell) => cell.end > cell.start);

const configurationDomain = (room: Room, passageWidth: number): Rect => {
    const radius = passageWidth / 2;

    return {
        x: radius,
        y: radius,
        width: Math.max(0, room.width - passageWidth),
        depth: Math.max(0, room.depth - passageWidth),
    };
};

const accessObstacleRects = (room: Room, placements: Placement[]): Rect[] => [
    ...placements.flatMap(getWorldBodyRects),
    ...getPartitionObstacleRects(room),
    ...getFixedFurnitureBodies(room),
    ...(room.radiators ?? []).map((radiator) => getRadiatorBody(radiator, room)),
];

const expandedAccessObstacles = (obstacles: Rect[], passageWidth: number): Rect[] =>
    obstacles.map((obstacle) => expandRect(obstacle, passageWidth / 2));

const ACCESS_SEED_THICKNESS = 1;

const getDoorAccessSeed = (door: DoorOpening, room: Room, passageWidth: number): Rect | null => {
    const radius = passageWidth / 2;
    const parallelLength = door.width - passageWidth;
    if (parallelLength <= 0) return null;
    const segment = getRoomSegment(room, door);
    if (!segment) return null;
    return getSegmentSpanRect(
        segment,
        door.offset + radius,
        parallelLength,
        radius,
        ACCESS_SEED_THICKNESS,
    );
};

const accessSeedRects = (room: Room, passageWidth: number): Rect[] =>
    room.doors
        .filter((door) => !door.partitionId)
        .map((door) => getDoorAccessSeed(door, room, passageWidth))
        .filter((seed): seed is Rect => seed !== null);

const compressedAxisCoordinates = (
    domainStart: number,
    domainEnd: number,
    requiredDomainStart: number,
    requiredDomainEnd: number,
    rects: Rect[],
    axis: "x" | "y",
): number[] => {
    const values = [domainStart, domainEnd, requiredDomainStart, requiredDomainEnd];

    rects.forEach((rect) => {
        values.push(
            axis === "x" ? rect.x : rect.y,
            axis === "x" ? rect.x + rect.width : rect.y + rect.depth,
        );
    });

    return Array.from(
        new Set(values.filter((value) => value >= domainStart && value <= domainEnd)),
    ).sort((first, second) => first - second);
};

/**
 * Conservative, deterministic connected-access proof.
 *
 * The room is converted to square-agent configuration space. Furniture and
 * radiator bodies are expanded by 325 mm (a 650 mm proof agent), then
 * decomposed exactly at every obstacle edge. The door seed is constrained to
 * centre positions that physically fit through its opening, and the opening
 * itself must be at least the full 700 mm target. Eight-neighbour cell
 * traversal remains an over-approximation that permits corner transitions.
 * Targets are only cells wholly usable by the full 700 mm agent.
 * Consequently this check can miss a passage wider than 650 but narrower than
 * 700 mm, while a real 700 mm path always retains a positive-width proof cell.
 */
export const analyzeConnectedAccess = (
    room: Room,
    placements: Placement[],
): ConnectedAccessAnalysis => {
    const base = {
        minimumPassageWidth: MIN_CONNECTED_PASSAGE_WIDTH,
        proofWidth: ACCESS_PATH_PROOF_WIDTH,
        cellEnvelope: ACCESS_PATH_CELL_ENVELOPE,
    };

    if (room.doors.every((door) => door.partitionId) || validateRoomGeometry(room) !== null) {
        return {
            ...base,
            applicable: false,
            connected: true,
            usableCellCount: 0,
            reachableUsableCellCount: 0,
        };
    }

    if (getTrustedAccessDoorError(room) !== null) {
        return {
            ...base,
            applicable: false,
            connected: false,
            usableCellCount: 0,
            reachableUsableCellCount: 0,
        };
    }

    const proofDomain = configurationDomain(room, ACCESS_PATH_PROOF_WIDTH);
    const requiredDomain = configurationDomain(room, MIN_CONNECTED_PASSAGE_WIDTH);
    if (proofDomain.width <= 0 || proofDomain.depth <= 0) {
        return {
            ...base,
            applicable: true,
            connected: true,
            usableCellCount: 0,
            reachableUsableCellCount: 0,
        };
    }

    const obstacles = accessObstacleRects(room, placements);
    const proofObstacles = expandedAccessObstacles(obstacles, ACCESS_PATH_PROOF_WIDTH);
    const requiredObstacles = expandedAccessObstacles(obstacles, MIN_CONNECTED_PASSAGE_WIDTH);
    const seeds = accessSeedRects(room, ACCESS_PATH_PROOF_WIDTH);
    const contourCoordinates =
        canonicalRoomGeometry(room).kind === "orthogonal"
            ? getRoomVertices(room).flatMap((vertex) =>
                  [ACCESS_PATH_PROOF_WIDTH / 2, MIN_CONNECTED_PASSAGE_WIDTH / 2].flatMap((radius) =>
                      [-radius, radius].map((direction) => ({
                          x: vertex.x + direction,
                          y: vertex.y + direction,
                          width: 0,
                          depth: 0,
                      })),
                  ),
              )
            : [];
    const coordinateRects = [
        ...proofObstacles,
        ...requiredObstacles,
        ...seeds,
        ...contourCoordinates,
    ];
    const xCoordinates = compressedAxisCoordinates(
        proofDomain.x,
        proofDomain.x + proofDomain.width,
        requiredDomain.x,
        requiredDomain.x + requiredDomain.width,
        coordinateRects,
        "x",
    );
    const yCoordinates = compressedAxisCoordinates(
        proofDomain.y,
        proofDomain.y + proofDomain.depth,
        requiredDomain.y,
        requiredDomain.y + requiredDomain.depth,
        coordinateRects,
        "y",
    );
    const xCells = axisCells(xCoordinates);
    const yCells = axisCells(yCoordinates);
    const cells: AccessCell[][] = yCells.map((yCell, yIndex) =>
        xCells.map((xCell, xIndex) => {
            const rect: Rect = {
                x: xCell.start,
                y: yCell.start,
                width: xCell.end - xCell.start,
                depth: yCell.end - yCell.start,
            };

            return {
                rect,
                xIndex,
                yIndex,
                navigable:
                    (canonicalRoomGeometry(room).kind === "rect" ||
                        rectInsideRoomGeometry(
                            expandRect(rect, ACCESS_PATH_PROOF_WIDTH / 2),
                            room,
                        )) &&
                    !proofObstacles.some((obstacle) => rectContainsRect(obstacle, rect)),
                usableAtRequiredWidth:
                    rectContainsRect(requiredDomain, rect) &&
                    (canonicalRoomGeometry(room).kind === "rect" ||
                        rectInsideRoomGeometry(
                            expandRect(rect, MIN_CONNECTED_PASSAGE_WIDTH / 2),
                            room,
                        )) &&
                    !requiredObstacles.some((obstacle) => rectsIntersect(obstacle, rect)),
            };
        }),
    );
    const seedCells = cells
        .flat()
        .filter((cell) => cell.navigable && seeds.some((seed) => rectsIntersect(cell.rect, seed)));

    // A missing aperture-constrained seed means the proof cannot start at the
    // physical door safely. It remains inconclusive rather than rejecting a plan.
    if (seedCells.length === 0) {
        return {
            ...base,
            applicable: false,
            connected: true,
            usableCellCount: cells.flat().filter((cell) => cell.usableAtRequiredWidth).length,
            reachableUsableCellCount: 0,
        };
    }

    const visited = new Set<string>();
    const queue = [...seedCells];
    seedCells.forEach((cell) => visited.add(`${cell.xIndex}:${cell.yIndex}`));
    const neighbours = [-1, 0, 1];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const cell = queue[cursor];
        neighbours.forEach((xOffset) =>
            neighbours.forEach((yOffset) => {
                if (xOffset === 0 && yOffset === 0) return;
                const candidate = cells[cell.yIndex + yOffset]?.[cell.xIndex + xOffset];
                if (!candidate?.navigable) return;
                const key = `${candidate.xIndex}:${candidate.yIndex}`;
                if (visited.has(key)) return;
                visited.add(key);
                queue.push(candidate);
            }),
        );
    }

    const usableCells = cells.flat().filter((cell) => cell.usableAtRequiredWidth);
    const reachableUsableCellCount = usableCells.filter((cell) =>
        visited.has(`${cell.xIndex}:${cell.yIndex}`),
    ).length;

    return {
        ...base,
        applicable: true,
        connected: reachableUsableCellCount === usableCells.length,
        usableCellCount: usableCells.length,
        reachableUsableCellCount,
    };
};

const connectedAccessIssues = (room: Room, placements: Placement[]): ValidationIssue[] => {
    const doorError = getTrustedAccessDoorError(room);
    if (doorError) {
        return [
            {
                code: "access-door-too-narrow",
                message: doorError,
                instanceIds: [],
            },
        ];
    }

    const analysis = analyzeConnectedAccess(room, placements);
    if (!analysis.applicable || analysis.connected) return [];

    return [
        {
            code: "access-path-blocked",
            message: `Мебель разрывает связный проход от двери шириной ${MIN_CONNECTED_PASSAGE_WIDTH} мм (консервативная проверка с допуском ${ACCESS_PATH_CELL_ENVELOPE} мм).`,
            instanceIds: placements.map((placement) => placement.instanceId),
        },
    ];
};

const intervalOverlapLength = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) => Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart);

const gapBetweenIntervals = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) => Math.max(secondStart - firstEnd, firstStart - secondEnd, 0);

export const relationSatisfied = (
    placement: Placement,
    target: Placement,
    kind: "front-gap" | "adjacent" | "aligned-side",
    minGap = 0,
    maxGap = 100,
): boolean => {
    const placementBounds = getBounds(getWorldBodyRects(placement));
    const targetBounds = getBounds(getWorldBodyRects(target));
    const horizontalGap = gapBetweenIntervals(
        placementBounds.x,
        placementBounds.x + placementBounds.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalGap = gapBetweenIntervals(
        placementBounds.y,
        placementBounds.y + placementBounds.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );
    const horizontalOverlap = intervalOverlapLength(
        placementBounds.x,
        placementBounds.x + placementBounds.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalOverlap = intervalOverlapLength(
        placementBounds.y,
        placementBounds.y + placementBounds.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );

    if (kind === "adjacent" || kind === "aligned-side") {
        const horizontalSide =
            verticalOverlap > 0 && horizontalGap >= minGap && horizontalGap <= maxGap;
        const verticalSide =
            horizontalOverlap > 0 && verticalGap >= minGap && verticalGap <= maxGap;

        if (kind === "adjacent") return horizontalSide || verticalSide;

        const horizontallyAligned =
            horizontalSide &&
            (Math.abs(placementBounds.y - targetBounds.y) <= GRID_SIZE ||
                Math.abs(
                    placementBounds.y +
                        placementBounds.depth -
                        (targetBounds.y + targetBounds.depth),
                ) <= GRID_SIZE);
        const verticallyAligned =
            verticalSide &&
            (Math.abs(placementBounds.x - targetBounds.x) <= GRID_SIZE ||
                Math.abs(
                    placementBounds.x +
                        placementBounds.width -
                        (targetBounds.x + targetBounds.width),
                ) <= GRID_SIZE);

        return horizontallyAligned || verticallyAligned;
    }

    switch (target.rotation) {
        case 90:
            return (
                verticalOverlap > 0 &&
                targetBounds.x - (placementBounds.x + placementBounds.width) >= minGap &&
                targetBounds.x - (placementBounds.x + placementBounds.width) <= maxGap
            );
        case 180:
            return (
                horizontalOverlap > 0 &&
                targetBounds.y - (placementBounds.y + placementBounds.depth) >= minGap &&
                targetBounds.y - (placementBounds.y + placementBounds.depth) <= maxGap
            );
        case 270:
            return (
                verticalOverlap > 0 &&
                placementBounds.x - (targetBounds.x + targetBounds.width) >= minGap &&
                placementBounds.x - (targetBounds.x + targetBounds.width) <= maxGap
            );
        default:
            return (
                horizontalOverlap > 0 &&
                placementBounds.y - (targetBounds.y + targetBounds.depth) >= minGap &&
                placementBounds.y - (targetBounds.y + targetBounds.depth) <= maxGap
            );
    }
};

const relationIssues = (placements: Placement[]): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];

    placements.forEach((placement) => {
        const definition = getFurniture(placement.definitionId);

        definition.relations.forEach((relation) => {
            if (!relation.required || relation.kind === "faces") return;

            const targets = placements.filter(
                (candidate) =>
                    candidate.instanceId !== placement.instanceId &&
                    relationTargetsDefinition(relation, getFurniture(candidate.definitionId)),
            );
            const supportedKind = relation.kind as "front-gap" | "adjacent" | "aligned-side";
            const { minimumGap, maximumGap } = resolveRelationGapRange({
                ...relation,
                kind: supportedKind,
            });
            const matched = targets.some((target) =>
                relationSatisfied(placement, target, supportedKind, minimumGap, maximumGap),
            );

            if (!matched) {
                issues.push({
                    code: "relation-broken",
                    message: `${definition.shortLabel}: положение не соответствует связанному предмету.`,
                    instanceIds: [placement.instanceId],
                });
            }
        });
    });

    return issues;
};

const oppositeRotation = (rotation: Rotation): Rotation => ((rotation + 180) % 360) as Rotation;

const tvTargetCategory = (
    placements: Placement[],
    preferences: LayoutPreferences,
): "sleep" | "living" | null => {
    if (preferences.tvTargetCategory) return preferences.tvTargetCategory;

    if (
        placements.some((placement) => {
            const definition = getFurniture(placement.definitionId);
            return definition.category === "living" && definition.id !== "coffee-table";
        })
    ) {
        return "living";
    }

    return placements.some((placement) => getFurniture(placement.definitionId).category === "sleep")
        ? "sleep"
        : null;
};

export const tvFacesTarget = (
    tv: Placement,
    target: Placement,
    targetCategory: "sleep" | "living",
): boolean => {
    if (tv.rotation !== oppositeRotation(target.rotation)) return false;

    const tvBounds = getBounds(getWorldBodyRects(tv));
    const targetBounds = getBounds(getWorldBodyRects(target));
    const horizontalOverlap = intervalOverlapLength(
        tvBounds.x,
        tvBounds.x + tvBounds.width,
        targetBounds.x,
        targetBounds.x + targetBounds.width,
    );
    const verticalOverlap = intervalOverlapLength(
        tvBounds.y,
        tvBounds.y + tvBounds.depth,
        targetBounds.y,
        targetBounds.y + targetBounds.depth,
    );
    let aligned = false;
    let gap = 0;

    switch (tv.rotation) {
        case 90:
            aligned = verticalOverlap > 0;
            gap = tvBounds.x - (targetBounds.x + targetBounds.width);
            break;
        case 180:
            aligned = horizontalOverlap > 0;
            gap = tvBounds.y - (targetBounds.y + targetBounds.depth);
            break;
        case 270:
            aligned = verticalOverlap > 0;
            gap = targetBounds.x - (tvBounds.x + tvBounds.width);
            break;
        default:
            aligned = horizontalOverlap > 0;
            gap = targetBounds.y - (tvBounds.y + tvBounds.depth);
    }

    if (!aligned || gap < 0) return false;
    const viewingDistance = getViewingDistanceRange(getFurniture(tv.definitionId), targetCategory);

    return gap >= viewingDistance.minimum && gap <= viewingDistance.maximum;
};

const tvRelationIssues = (
    placements: Placement[],
    preferences: LayoutPreferences,
): ValidationIssue[] => {
    const televisions = placements.filter(
        (placement) => getFurniture(placement.definitionId).category === "media",
    );
    if (televisions.length === 0) return [];

    const category = tvTargetCategory(placements, preferences);

    return televisions.flatMap((television): ValidationIssue[] => {
        const targets = category
            ? placements.filter((placement) => {
                  const definition = getFurniture(placement.definitionId);
                  return (
                      placement.instanceId !== television.instanceId &&
                      definition.category === category &&
                      (category !== "living" || definition.id !== "coffee-table")
                  );
              })
            : [];

        if (!category || targets.length === 0) {
            return [
                {
                    code: "relation-broken",
                    message:
                        "ТВ: не найден выбранный диван или кровать, напротив которого его нужно поставить.",
                    instanceIds: [television.instanceId],
                },
            ];
        }

        if (targets.some((target) => tvFacesTarget(television, target, category))) return [];

        const viewingDistance = category
            ? getViewingDistanceRange(getFurniture(television.definitionId), category)
            : null;

        return [
            {
                code: "relation-broken",
                message:
                    category && viewingDistance
                        ? `ТВ должен стоять напротив выбранной зоны просмотра на расстоянии от ${viewingDistance.minimum} до ${viewingDistance.maximum} мм.`
                        : "ТВ должен стоять напротив выбранной зоны просмотра.",
                instanceIds: [television.instanceId, ...targets.map((target) => target.instanceId)],
            },
        ];
    });
};

export const validatePlacement = (
    placement: Placement,
    room: Room,
    existingPlacements: Placement[],
): ValidationResult => {
    const issues = [
        ...roomIssues(placement, room),
        ...existingPlacements.flatMap((existing) => pairIssues(placement, existing)),
        ...alternativeClearanceIssues(placement, room, [placement, ...existingPlacements]),
    ];

    return { valid: issues.length === 0, issues };
};

export const validateLayout = (
    room: Room,
    placements: Placement[],
    preferences: LayoutPreferences = {},
): ValidationResult => {
    const issues: ValidationIssue[] = placements.flatMap((placement) =>
        roomIssues(placement, room),
    );

    issues.push(
        ...placements.flatMap((placement) =>
            alternativeClearanceIssues(placement, room, placements),
        ),
    );

    for (let firstIndex = 0; firstIndex < placements.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex += 1) {
            issues.push(...pairIssues(placements[firstIndex], placements[secondIndex]));
        }
    }

    issues.push(...relationIssues(placements));
    issues.push(...tvRelationIssues(placements, preferences));
    issues.push(...connectedAccessIssues(room, placements));

    return { valid: issues.length === 0, issues };
};

export interface PreferredClearanceSummary {
    totalZones: number;
    satisfiedZones: number;
}

/**
 * Measures designer-recommended extra space independently from validity.
 * A compromised preferred zone lowers ranking and is disclosed in notes, but
 * can never produce `proven-impossible`.
 */
export const getPreferredClearanceSummary = (
    room: Room,
    placements: Placement[],
): PreferredClearanceSummary => {
    const fixedObstacles = [
        ...room.doors.map((door) => getDoorObstacle(door, room)),
        ...getPartitionObstacleRects(room),
        ...getFixedFurnitureBodies(room),
        ...room.windows.map((window) => getWindowCurtainObstacle(window, room)),
        ...(room.radiators ?? []).flatMap((radiator) => [
            getRadiatorBody(radiator, room),
            getRadiatorServiceObstacle(radiator, room),
        ]),
    ];
    let totalZones = 0;
    let satisfiedZones = 0;

    placements.forEach((placement) => {
        const otherBodies = placements
            .filter((candidate) => candidate.instanceId !== placement.instanceId)
            .flatMap(getWorldBodyRects);

        getWorldPreferredClearanceRects(placement).forEach((zone) => {
            totalZones += 1;
            if (
                rectInsideRoom(zone, room) &&
                !fixedObstacles.some((obstacle) => rectsIntersect(zone, obstacle)) &&
                !otherBodies.some((body) => rectsIntersect(zone, body))
            ) {
                satisfiedZones += 1;
            }
        });
    });

    return { totalZones, satisfiedZones };
};

export const snapToGrid = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE;
