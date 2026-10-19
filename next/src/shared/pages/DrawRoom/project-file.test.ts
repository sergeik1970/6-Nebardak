import { describe, expect, it } from "vitest";
import {
    parseDrawingProject,
    serializeDrawingProject,
    type DrawingProjectScene,
} from "./project-file";
const scene: DrawingProjectScene = {
    segments: [{ id: "wall", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }],
    doors: [
        {
            id: "door",
            wall: "top",
            offset: 1000,
            width: 900,
            clearanceDepth: 900,
            drawingHostId: "wall",
        },
    ],
    windows: [{ id: "window", wall: "top", offset: 2500, width: 1000 }],
    wallThickness: 100,
    furniture: [
        {
            id: "bed",
            definitionId: "single-bed",
            x: 300,
            y: 1500,
            width: 900,
            depth: 2100,
            rotation: 90,
            locked: true,
        },
    ],
    regions: { version: 1, items: [{ signature: "room", name: "Спальня" }] },
};
describe("drawing project files", () => {
    it("round-trips furniture sizes, rotation, physical hosts and room names", () => {
        expect(parseDrawingProject(serializeDrawingProject(scene))).toEqual(scene);
    });
    it("keeps unfinished drawings valid", () => {
        expect(
            parseDrawingProject(
                serializeDrawingProject({ ...scene, segments: [], doors: [], windows: [] }),
            ).segments,
        ).toEqual([]);
    });
    it.each([
        { doors: [null] },
        { windows: [{ id: "bad", wall: "top", offset: 0, width: -1 }] },
        { segments: [{ id: "bad", start: { x: "0", y: 0 }, end: { x: 100, y: 0 } }] },
        { furniture: [{ id: "unknown", definitionId: "no-such-item" }] },
        { regions: { version: 1, items: [null] } },
        { wallThickness: 75 },
        { furniture: [{ ...scene.furniture![0], locked: "yes" }] },
        { segments: [scene.segments[0], scene.segments[0]] },
    ])("rejects damaged objects without dropping them: %j", (patch) => {
        expect(() =>
            parseDrawingProject(
                JSON.stringify({
                    format: "stylefinder-drawing",
                    version: 1,
                    scene: { ...scene, ...patch },
                }),
            ),
        ).toThrow();
    });
    it("rejects foreign files and future schema versions", () => {
        for (const text of [
            "{",
            "null",
            JSON.stringify(scene),
            JSON.stringify({ format: "stylefinder-drawing", version: 2, scene }),
        ]) {
            expect(() => parseDrawingProject(text)).toThrow();
        }
    });
});
