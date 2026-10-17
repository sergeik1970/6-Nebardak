import { describe, expect, it } from "vitest";

import {
    createLRoomGeometry,
    buildOrthogonalRoomFromDraft,
    getRoomArea,
    getRoomBoundarySegments,
    getRoomCentroid,
    getLRoomNotch,
    getRoomSegment,
    getSegmentSpanRect,
    moveOrthogonalRoomVertex,
    pointInsideRoom,
    resizeOrthogonalRoomGeometry,
    splitOrthogonalRoomSegment,
    moveLRoomNotch,
    rectInsideRoomGeometry,
    validateOrthogonalRoomGeometry,
} from "./room-geometry";
import { Room } from "./types";

const rectangularRoom: Room = {
    width: 6000,
    depth: 4600,
    doors: [],
    windows: [],
    radiators: [],
};

const lRoom = (side: "left" | "right" = "right"): Room => ({
    ...rectangularRoom,
    geometry: createLRoomGeometry(rectangularRoom.width, rectangularRoom.depth, side),
});

describe("room boundary adapter", () => {
    it("keeps stable legacy segment ids and rectangular metrics", () => {
        expect(getRoomBoundarySegments(rectangularRoom).map((segment) => segment.id)).toEqual([
            "rect-top",
            "rect-right",
            "rect-bottom",
            "rect-left",
        ]);
        expect(getRoomArea(rectangularRoom)).toBe(27_600_000);
        expect(getRoomCentroid(rectangularRoom)).toEqual({ x: 3000, y: 2300 });
    });

    it("creates a valid clockwise L contour with stable segment ids", () => {
        const room = lRoom();

        expect(validateOrthogonalRoomGeometry(room)).toBeNull();
        expect(getRoomBoundarySegments(room).map((segment) => segment.id)).toEqual([
            "segment-v1",
            "segment-v2",
            "segment-v3",
            "segment-v4",
            "segment-v5",
            "segment-v6",
        ]);
        expect(getRoomArea(room)).toBeLessThan(room.width * room.depth);
    });
});

describe("orthogonal containment", () => {
    it("rejects points and rectangles inside the concave cutout", () => {
        const room = lRoom();

        expect(pointInsideRoom(room, { x: 1000, y: 1000 })).toBe(true);
        expect(pointInsideRoom(room, { x: 5000, y: 500 })).toBe(false);
        expect(rectInsideRoomGeometry({ x: 4300, y: 200, width: 800, depth: 600 }, room)).toBe(
            false,
        );
        expect(rectInsideRoomGeometry({ x: 200, y: 200, width: 800, depth: 600 }, room)).toBe(true);
    });

    it("rejects a rectangle that bridges across the inner wall", () => {
        const room = lRoom();

        expect(rectInsideRoomGeometry({ x: 3300, y: 1200, width: 1800, depth: 1200 }, room)).toBe(
            false,
        );
    });
});

describe("segment anchors", () => {
    it("builds an inward obstacle on the concave vertical segment", () => {
        const room = lRoom();
        const segment = getRoomSegment(room, {
            wall: "right",
            segmentId: "segment-v2",
        });

        expect(segment).not.toBeNull();
        expect(segment?.wall).toBe("right");
        expect(getSegmentSpanRect(segment!, 200, 900, 0, 900)).toEqual({
            x: 2700,
            y: 200,
            width: 900,
            depth: 900,
        });
    });
});

describe("L-room notch editing", () => {
    it("moves the concave corner on the 50 mm grid without changing segment ids", () => {
        const room = lRoom();
        const beforeIds = getRoomBoundarySegments(room).map((segment) => segment.id);

        const moved = moveLRoomNotch(room, 3476, 1624);

        expect(getLRoomNotch(moved)).toEqual({ x: 3500, y: 1600 });
        expect(getRoomBoundarySegments(moved).map((segment) => segment.id)).toEqual(beforeIds);
        expect(validateOrthogonalRoomGeometry(moved)).toBeNull();
    });
});

describe("direct orthogonal boundary editor", () => {
    it("resizes only the outer bounds and keeps custom topology and segment ids", () => {
        const room = lRoom();
        const beforeIds = getRoomBoundarySegments(room).map((segment) => segment.id);
        const result = resizeOrthogonalRoomGeometry(room, 7200, 5200);

        expect(result.status).toBe("success");
        if (result.status !== "success" || result.geometry.kind !== "orthogonal") return;
        const geometry = result.geometry;
        const resized: Room = { ...room, width: 7200, depth: 5200, geometry };
        expect(geometry.vertices.map((vertex) => vertex.id)).toEqual(
            room.geometry && room.geometry.kind === "orthogonal"
                ? room.geometry.vertices.map((vertex) => vertex.id)
                : [],
        );
        expect(geometry.vertices).toContainEqual({ id: "v2", x: 3600, y: 0 });
        expect(geometry.vertices).toContainEqual({ id: "v5", x: 7200, y: 5200 });
        expect(getRoomBoundarySegments(resized).map((segment) => segment.id)).toEqual(beforeIds);
        expect(validateOrthogonalRoomGeometry(resized)).toBeNull();
    });

    it("rejects a shrink that would cross an interior contour wall", () => {
        const result = resizeOrthogonalRoomGeometry(lRoom(), 3000, 4600);

        expect(result).toMatchObject({ status: "invalid" });
    });

    it("moves an editable corner on the grid without introducing diagonal walls", () => {
        const room = lRoom();
        const result = moveOrthogonalRoomVertex(room, "v3", { x: 3326, y: 1674 });

        expect(result.status).toBe("success");
        if (result.status !== "success" || result.geometry.kind !== "orthogonal") return;
        const edited = { ...room, geometry: result.geometry };
        expect(edited.geometry.vertices).toContainEqual({ id: "v2", x: 3350, y: 0 });
        expect(edited.geometry.vertices).toContainEqual({ id: "v3", x: 3350, y: 1650 });
        expect(edited.geometry.vertices).toContainEqual({ id: "v4", x: 6000, y: 1650 });
        expect(validateOrthogonalRoomGeometry(edited)).toBeNull();
    });

    it("splits a free wall into a safe orthogonal step and keeps prior segment ids", () => {
        const room = lRoom();
        const result = splitOrthogonalRoomSegment(room, "segment-v6", { x: 700, y: 3100 });

        expect(result.status).toBe("success");
        if (result.status !== "success" || result.geometry.kind !== "orthogonal") return;
        const edited = { ...room, geometry: result.geometry };
        expect(edited.geometry.vertices).toHaveLength(10);
        expect(getRoomBoundarySegments(edited).map((segment) => segment.id)).toContain(
            "segment-v1",
        );
        expect(getRoomBoundarySegments(edited).map((segment) => segment.id)).toContain(
            "segment-v6",
        );
        expect(validateOrthogonalRoomGeometry(edited)).toBeNull();
    });

    it("does not split a wall that has a stable opening anchor", () => {
        const room: Room = {
            ...lRoom(),
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    segmentId: "segment-v5",
                    offset: 300,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
        };

        expect(splitOrthogonalRoomSegment(room, "segment-v5", { x: 4200, y: 3900 })).toEqual({
            status: "invalid",
            message:
                "На этой стене есть дверь, окно или радиатор: сначала перенесите проём на другой сегмент.",
        });
    });
});

describe("user-drawn orthogonal contour", () => {
    it("closes and normalizes a five-point L polyline", () => {
        const result = buildOrthogonalRoomFromDraft([
            { x: 500, y: 500 },
            { x: 4100, y: 500 },
            { x: 4100, y: 2300 },
            { x: 6500, y: 2300 },
            { x: 6500, y: 5100 },
        ]);

        expect(result.status).toBe("success");
        if (result.status !== "success") return;
        expect(result).toMatchObject({ width: 6000, depth: 4600 });
        expect(result.geometry.kind).toBe("orthogonal");
        expect(result.geometry.kind === "orthogonal" ? result.geometry.vertices.length : 0).toBe(6);
    });

    it("rejects a drawing that is too small", () => {
        const result = buildOrthogonalRoomFromDraft([
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 500 },
            { x: 1500, y: 500 },
            { x: 1500, y: 1500 },
        ]);

        expect(result).toEqual({
            status: "invalid",
            message: "Габариты нарисованного контура должны быть от 2,4 до 10 м.",
        });
    });
});

describe("orthogonal contour validation", () => {
    it("rejects diagonal and counter-clockwise contours", () => {
        const originalGeometry = lRoom().geometry;
        if (!originalGeometry || originalGeometry.kind !== "orthogonal") {
            throw new Error("L-room fixture must be orthogonal");
        }
        const diagonal: Room = {
            ...lRoom(),
            geometry: {
                version: 1,
                kind: "orthogonal",
                vertices: [
                    { id: "a", x: 0, y: 0 },
                    { id: "b", x: 3600, y: 50 },
                    { id: "c", x: 3600, y: 1800 },
                    { id: "d", x: 6000, y: 1800 },
                    { id: "e", x: 6000, y: 4600 },
                    { id: "f", x: 0, y: 4600 },
                ],
            },
        };
        const reversed: Room = {
            ...lRoom(),
            geometry: {
                version: 1,
                kind: "orthogonal",
                vertices: [...originalGeometry.vertices].reverse(),
            },
        };

        expect(validateOrthogonalRoomGeometry(diagonal)).toContain("ортогональными");
        expect(validateOrthogonalRoomGeometry(reversed)).toContain("часовой стрелке");
    });
});
