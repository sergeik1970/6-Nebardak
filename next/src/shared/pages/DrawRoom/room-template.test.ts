import { describe, expect, it } from "vitest";
import type { Room } from "@/shared/lib/furniture-planner";
import { deriveDrawWallGraphRoom } from "@/shared/lib/furniture-planner/draw-room-wall-graph";
import {
    createLRoomGeometry,
    getRoomBoundarySegments,
} from "@/shared/lib/furniture-planner/room-geometry";
import { parseDrawingProject, serializeDrawingProject } from "./project-file";
import { createRectTemplateRoom, roomToDrawingScene } from "./room-template";

const door = {
    id: "door-main",
    wall: "bottom" as const,
    offset: 500,
    width: 900,
    clearanceDepth: 900,
    hinge: "start" as const,
};

describe("room template", () => {
    it.each([undefined, 50, 100] as const)(
        "builds four walls that derive the requested clear room (wall %p)",
        (wallThickness) => {
            const scene = roomToDrawingScene(createRectTemplateRoom(3600, 4200, wallThickness));
            expect(scene?.segments).toHaveLength(4);
            // The starter entrance door and window come along.
            expect(scene?.doors.map((door) => door.id)).toEqual(["door-main"]);
            expect(scene?.windows.map((window) => window.id)).toEqual(["window-main"]);
            const derived = deriveDrawWallGraphRoom(scene!.segments, scene!.wallThickness ?? 50);
            expect(derived?.room).toMatchObject({
                width: 3600,
                depth: 4200,
                geometry: { kind: "rect" },
            });
            // The editor accepts it as a regular drawing file.
            expect(parseDrawingProject(serializeDrawingProject(scene!)).segments).toHaveLength(4);
        },
    );

    it("keeps a rectangular room's openings where they were", () => {
        const room: Room = {
            width: 6000,
            depth: 4500,
            wallThickness: 100,
            doors: [{ ...door, drawingHostId: "old-wall" }],
            windows: [{ id: "window-1", wall: "top", offset: 1200, width: 1500 } as never],
            radiators: [],
        };
        const scene = roomToDrawingScene(room)!;
        expect(scene.wallThickness).toBe(100);
        expect(scene.doors).toEqual([door]);
        expect(scene.windows).toHaveLength(1);
    });

    it("re-links an L-shaped room's openings to the editor's segments", () => {
        const geometry = createLRoomGeometry(5000, 4000, "left");
        const room: Room = {
            width: 5000,
            depth: 4000,
            geometry,
            doors: [],
            windows: [],
            radiators: [],
        };
        const source = getRoomBoundarySegments(room).find(
            (segment) => segment.orientation === "horizontal" && segment.start.y === 4000,
        )!;
        const withDoor: Room = {
            ...room,
            doors: [{ ...door, wall: source.wall, segmentId: source.id }],
        };

        const scene = roomToDrawingScene(withDoor)!;
        const derived = deriveDrawWallGraphRoom(scene.segments, 50)!;
        expect(derived.room.geometry).toMatchObject({ kind: "orthogonal" });
        expect(derived.room.width).toBe(5000);

        const [moved] = scene.doors;
        const target = getRoomBoundarySegments(derived.room).find(
            (segment) => segment.id === moved.segmentId,
        )!;
        expect(target).toBeDefined();
        // The same physical stretch of wall, measured from whichever end it starts.
        const startOnSource =
            source.start.x + Math.sign(source.end.x - source.start.x) * door.offset;
        const startOnTarget =
            target.start.x + Math.sign(target.end.x - target.start.x) * moved.offset;
        const span = (start: number, sign: number) =>
            [start, start + sign * door.width].sort((a, b) => a - b);
        expect(span(startOnTarget, Math.sign(target.end.x - target.start.x))).toEqual(
            span(startOnSource, Math.sign(source.end.x - source.start.x)),
        );
    });
});
