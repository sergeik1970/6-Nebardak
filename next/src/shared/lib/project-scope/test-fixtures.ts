import { createProjectDraft } from "@/shared/lib/furniture-planner/project-draft";
import type { KeyValueStorage } from "./storage";

export class MemoryStorage implements KeyValueStorage {
    readonly values = new Map<string, string>();

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }

    removeItem(key: string) {
        this.values.delete(key);
    }
}

export const createFixtureDraft = () =>
    createProjectDraft(
        {
            items: [
                { definitionId: "double-bed", count: 1, priority: "required" },
                { definitionId: "dresser", count: 1, priority: "optional" },
            ],
            meta: { styleKey: "provence", styleLabel: "Прованс" },
        },
        {
            room: {
                width: 6000,
                depth: 4500,
                doors: [
                    {
                        id: "door-main",
                        wall: "bottom",
                        offset: 500,
                        width: 900,
                        clearanceDepth: 900,
                        hinge: "start",
                    },
                ],
                windows: [],
                radiators: [],
            },
            selection: { "double-bed": 1, dresser: 1 },
            priorities: { "double-bed": "required", dresser: "optional" },
        },
        1_750_000_000_000,
    );

export const fixtureDrawing = {
    segments: [
        { id: "w0", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
        { id: "w1", start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } },
        { id: "w2", start: { x: 4000, y: 3000 }, end: { x: 0, y: 3000 } },
        { id: "w3", start: { x: 0, y: 3000 }, end: { x: 0, y: 0 } },
    ],
    doors: [],
    windows: [],
    wallThickness: 100 as const,
    regions: { version: 1 as const, items: [{ signature: "r1", name: "Спальня" }] },
};
