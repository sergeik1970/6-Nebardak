import { describe, expect, it } from "vitest";
import {
    VISUAL_TEST_TOTAL_STEPS,
    answerVisualTest,
    createVisualTestSession,
    type VisualTestSession,
} from "../visual-preference";
import { buildFurnitureInstances } from "./catalog";
import { solveRoom } from "./solver";
import {
    STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY,
    STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
    STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY,
    STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY,
    clearProjectDraftVisualTest,
    createProjectDraft,
    normalizeProjectDraft,
    readProjectDraft,
    resetProjectDraft,
    saveProjectDraft,
    updateProjectDraftVisualTest,
    validateProjectDraftLayout,
    type ProjectDraftStorage,
} from "./project-draft";

class MemoryStorage implements ProjectDraftStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    removeItem(key: string) {
        this.values.delete(key);
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }
}

const TEST_DOOR = {
    id: "door-main",
    wall: "bottom" as const,
    offset: 500,
    width: 900,
    clearanceDepth: 900,
    hinge: "start" as const,
};

const createValidDraft = () =>
    createProjectDraft(
        {
            items: [
                { definitionId: "double-bed", count: 1, priority: "required" },
                { definitionId: "dresser", count: 1, priority: "optional" },
            ],
            preferences: { tvTargetCategory: "sleep" },
            meta: { styleKey: "provence", styleLabel: "Прованс" },
        },
        {
            room: {
                width: 6000,
                depth: 4600,
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
                windows: [{ id: "window-main", wall: "top", offset: 2100, width: 1800 }],
                radiators: [],
            },
            selection: { "double-bed": 1, dresser: 1 },
            priorities: { "double-bed": "required", dresser: "optional" },
            preferences: { tvTargetCategory: "sleep" },
        },
        1_750_000_000_000,
    );

const createDraftWithLayout = () => {
    const room = {
        width: 6000,
        depth: 4600,
        doors: [{ ...TEST_DOOR }],
        windows: [],
        radiators: [],
    };
    const selection = { dresser: 1 };
    const priorities = { dresser: "preferred" as const };
    const result = solveRoom(
        room,
        buildFurnitureInstances({
            dresser: { count: 1, required: false, priority: "preferred" },
        }),
    );
    if (result.status !== "success") throw new Error("Expected the test layout to be solvable.");

    return createProjectDraft(
        { items: [{ definitionId: "dresser", count: 1, priority: "preferred" }] },
        {
            room,
            selection,
            priorities,
            layout: {
                variants: [],
                activeVariantId: null,
                editedVariantIds: [],
                placements: result.placements,
                history: {
                    past: [result.placements.map((placement) => ({ ...placement }))],
                    present: result.placements,
                    future: [],
                },
                exploredNodes: result.exploredNodes,
                score: result.score,
                notes: result.notes,
                generatedAt: "2026-07-17T07:00:00.000Z",
            },
        },
        1_750_000_000_000,
    );
};

const answerFirst = (session: VisualTestSession) =>
    answerVisualTest(session, { kind: "choose", key: session.slots[0].key });

const createVisualProgress = () => answerFirst(answerFirst(createVisualTestSession(20260718)));

const createVisualResult = () => {
    let session = createVisualTestSession(20260718);
    while (session.phase === "playing") session = answerFirst(session);
    if (session.answers.length < VISUAL_TEST_TOTAL_STEPS) {
        throw new Error("Expected a complete visual-test fixture.");
    }
    return session;
};

describe("StyleFinder project draft", () => {
    it("round-trips a versioned project with the selected validated layout", () => {
        const storage = new MemoryStorage();
        const draft = createDraftWithLayout();

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY)).toContain("placements");
        expect(validateProjectDraftLayout(draft.planner)).toEqual({ status: "valid" });
    });

    it("keeps the default fit-all variant when saving a generated layout", () => {
        const storage = new MemoryStorage();
        const base = createDraftWithLayout();
        if (!base.planner?.layout) throw new Error("Expected a layout fixture.");
        const layout = base.planner.layout;
        const fitAllVariant = {
            status: "success" as const,
            variantId: "fit-all-1",
            profile: {
                id: "fit-all" as const,
                label: "Уместить всё",
                windowPreferredItems: 0,
                perimeterItems: 1,
                centerClearance: 1200,
            },
            placements: layout.placements,
            exploredNodes: layout.exploredNodes,
            score: layout.score,
            notes: layout.notes,
        };
        const draft = {
            ...base,
            planner: {
                ...base.planner,
                layout: {
                    ...layout,
                    variants: [fitAllVariant],
                    activeVariantId: fitAllVariant.variantId,
                },
            },
        };

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
    });

    it("preserves balcony-door and floor-to-ceiling window semantics", () => {
        const storage = new MemoryStorage();
        const draft = createValidDraft();
        if (!draft.planner) throw new Error("Expected planner data.");

        draft.planner.room.doors[0].doorKind = "balcony";
        draft.planner.room.doors[0].swingDirection = "outward";
        draft.planner.room.windows[0].windowKind = "floor-to-ceiling";

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
    });

    it("preserves sliding mount and direction through project storage", () => {
        const storage = new MemoryStorage();
        const draft = createValidDraft();
        if (!draft.planner) throw new Error("Expected planner data.");
        const door = draft.planner.room.doors[0];
        door.doorKind = "sliding-single";
        delete door.hinge;
        delete door.swingDirection;
        door.slidingMount = "outward";
        door.slidingDirection = "end";
        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        const saved = readProjectDraft({ storage });
        expect(saved.status).toBe("success");
        if (saved.status === "success")
            expect(saved.value.planner?.room.doors[0]).toMatchObject({
                slidingMount: "outward",
                slidingDirection: "end",
            });
    });

    it("persists an internal partition and the door cut into it", () => {
        const storage = new MemoryStorage();
        const draft = createValidDraft();
        if (!draft.planner) throw new Error("Expected planner data.");

        draft.planner.room.wallThickness = 100;
        draft.planner.room.partitions = [
            {
                id: "partition-main",
                start: { x: 3000, y: 0 },
                end: { x: 3000, y: 4600 },
                thickness: 100,
            },
        ];
        draft.planner.room.doors.push({
            id: "door-partition",
            wall: "right",
            partitionId: "partition-main",
            offset: 1500,
            width: 900,
            clearanceDepth: 900,
            hinge: "start",
            swingDirection: "inward",
        });

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
    });

    it("retains bounded design-lab feedback without rejecting an older usable draft", () => {
        const storage = new MemoryStorage();
        const base = createValidDraft();
        if (!base.planner) throw new Error("Expected planner fixture.");
        const draft = {
            ...base,
            planner: {
                ...base.planner,
                designLab: {
                    manualScene: true,
                    feedback: [
                        {
                            id: "lab-1",
                            verdict: "needs-fix" as const,
                            note: "Проход к окну выглядит тесным.",
                            createdAt: "2026-07-26T09:30:00.000Z",
                        },
                    ],
                },
            },
        };

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });

        const damagedLab = normalizeProjectDraft({
            ...draft,
            planner: {
                ...draft.planner,
                designLab: { manualScene: true, feedback: [{ id: "bad", note: "" }] },
            },
        });
        expect(damagedLab.status).toBe("success");
        if (damagedLab.status !== "success") return;
        expect(damagedLab.value.planner?.designLab).toBeUndefined();
    });

    it("rejects unsupported opening counts and duplicate or unsafe opening ids", () => {
        const base = createValidDraft();
        if (!base.planner) throw new Error("Expected planner fixture.");
        const room = base.planner.room;
        const window = { id: "window-extra", wall: "top" as const, offset: 100, width: 500 };
        const radiator = {
            id: "radiator-extra",
            wall: "left" as const,
            offset: 100,
            width: 500,
            depth: 100,
            clearanceDepth: 300,
        };
        const invalidRooms = [
            { ...room, doors: [] },
            { ...room, doors: [{ ...TEST_DOOR }, { ...TEST_DOOR, id: "door-second" }] },
            {
                ...room,
                windows: [
                    { ...window, id: "window-1" },
                    { ...window, id: "window-2" },
                    { ...window, id: "window-3" },
                ],
            },
            {
                ...room,
                radiators: [
                    { ...radiator, id: "radiator-1" },
                    { ...radiator, id: "radiator-2" },
                    { ...radiator, id: "radiator-3" },
                ],
            },
            { ...room, windows: [{ ...window, id: TEST_DOOR.id }] },
            { ...room, windows: [{ ...window, id: "../../unsafe" }] },
        ];

        invalidRooms.forEach((invalidRoom) => {
            const storage = new MemoryStorage();
            storage.setItem(
                STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
                JSON.stringify({
                    ...base,
                    planner: { ...base.planner, room: invalidRoom },
                }),
            );
            expect(readProjectDraft({ storage })).toEqual({
                status: "invalid",
                reason: "invalid-room",
            });
        });
    });

    it("round-trips validated removal history independently from the active selection", () => {
        const storage = new MemoryStorage();
        const base = createValidDraft();
        const removedItems = [
            {
                instanceId: "dresser-1",
                definitionId: "dresser",
                method: "manual" as const,
                reason: "Пользователь подтвердил удаление предмета из текущей планировки.",
                removedAt: "2026-07-18T03:00:00.000Z",
            },
        ];
        const draft = {
            ...base,
            questionnaire: {
                ...base.questionnaire,
                items: base.questionnaire.items.filter((item) => item.definitionId !== "dresser"),
            },
            planner: base.planner
                ? {
                      ...base.planner,
                      selection: { ...base.planner.selection, dresser: 0 },
                      removedItems,
                      removalArchive: removedItems,
                  }
                : undefined,
        };

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
    });

    it("preserves ordinal gaps and removal-aware undo/redo snapshots", () => {
        const removedRecord = {
            instanceId: "bedside-table-1",
            definitionId: "bedside-table",
            method: "manual" as const,
            reason: "Пользователь подтвердил удаление предмета из текущей планировки.",
            removedAt: "2026-07-18T03:10:00.000Z",
        };
        const firstPlacement = {
            instanceId: "bedside-table-1",
            definitionId: "bedside-table",
            x: 400,
            y: 0,
            rotation: 0 as const,
        };
        const secondPlacement = {
            ...firstPlacement,
            instanceId: "bedside-table-2",
            x: 900,
        };
        const layoutBase = {
            variants: [],
            activeVariantId: null,
            editedVariantIds: [],
            exploredNodes: 12,
            score: 100,
            notes: [],
            generatedAt: "2026-07-18T03:10:00.000Z",
        };
        const room = {
            width: 6000,
            depth: 4600,
            doors: [{ ...TEST_DOOR }],
            windows: [],
            radiators: [],
        };
        const afterRemoval = createProjectDraft(
            {
                items: [{ definitionId: "bedside-table", count: 1, priority: "optional" }],
            },
            {
                room,
                selection: { "bedside-table": 1 },
                priorities: { "bedside-table": "optional" },
                removedItems: [removedRecord],
                removalArchive: [removedRecord],
                layout: {
                    ...layoutBase,
                    placements: [secondPlacement],
                    history: {
                        past: [[firstPlacement, secondPlacement]],
                        present: [secondPlacement],
                        future: [],
                    },
                },
            },
            1_750_000_000_000,
        );
        const afterUndo = createProjectDraft(
            {
                items: [{ definitionId: "bedside-table", count: 2, priority: "optional" }],
            },
            {
                room,
                selection: { "bedside-table": 2 },
                priorities: { "bedside-table": "optional" },
                removalArchive: [removedRecord],
                layout: {
                    ...layoutBase,
                    placements: [firstPlacement, secondPlacement],
                    history: {
                        past: [],
                        present: [firstPlacement, secondPlacement],
                        future: [[secondPlacement]],
                    },
                },
            },
            1_750_000_000_001,
        );

        for (const draft of [afterRemoval, afterUndo]) {
            const storage = new MemoryStorage();
            expect(saveProjectDraft(draft, { storage })).toEqual({
                status: "success",
                value: draft,
            });
            expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
        }
    });

    it("rejects malformed removal history and records that overlap the active layout", () => {
        const malformed = createValidDraft();
        const malformedResult = saveProjectDraft(
            {
                ...malformed,
                planner: malformed.planner
                    ? { ...malformed.planner, removedItems: [{ definitionId: "dresser" }] as never }
                    : undefined,
            },
            { storage: new MemoryStorage() },
        );
        expect(malformedResult).toEqual({
            status: "invalid",
            reason: "invalid-removed-items",
        });

        const active = createDraftWithLayout();
        const activeInstance = active.planner?.layout?.placements[0];
        if (!active.planner || !activeInstance) throw new Error("Expected active layout fixture.");
        const overlapping = {
            ...active,
            planner: {
                ...active.planner,
                removedItems: [
                    {
                        instanceId: activeInstance.instanceId,
                        definitionId: activeInstance.definitionId,
                        method: "automatic" as const,
                        reason: "Предмет был предложен к удалению и подтверждён пользователем.",
                        removedAt: "2026-07-18T03:05:00.000Z",
                    },
                ],
            },
        };

        expect(saveProjectDraft(overlapping, { storage: new MemoryStorage() })).toEqual({
            status: "invalid",
            reason: "invalid-removed-items",
        });

        const priorityRecord = {
            instanceId: "dresser-1",
            definitionId: "dresser",
            priority: "optional" as const,
            method: "manual" as const,
            reason: "Пользователь подтвердил удаление предмета из текущей планировки.",
            removedAt: "2026-07-18T03:06:00.000Z",
        };
        const priorityMismatch = {
            ...malformed,
            questionnaire: {
                ...malformed.questionnaire,
                items: malformed.questionnaire.items.filter(
                    (item) => item.definitionId !== "dresser",
                ),
            },
            planner: malformed.planner
                ? {
                      ...malformed.planner,
                      selection: { ...malformed.planner.selection, dresser: 0 },
                      removedItems: [priorityRecord],
                      removalArchive: [{ ...priorityRecord, priority: "preferred" as const }],
                  }
                : undefined,
        };

        expect(saveProjectDraft(priorityMismatch, { storage: new MemoryStorage() })).toEqual({
            status: "invalid",
            reason: "invalid-removed-items",
        });
    });

    it("round-trips validated visual-test progress in the unified v4 draft", () => {
        const storage = new MemoryStorage();
        const visualTest = createVisualProgress();
        const draft = { ...createValidDraft(), visualTest };

        expect(saveProjectDraft(draft, { storage })).toEqual({ status: "success", value: draft });
        expect(readProjectDraft({ storage })).toEqual({ status: "success", value: draft });
        expect(
            JSON.parse(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY) ?? "null"),
        ).toMatchObject({ version: 4, visualTest: { answers: [{}, {}] } });
    });

    it("round-trips the complete visual result instead of recomputing a different style", () => {
        const storage = new MemoryStorage();
        const visualTest = createVisualResult();
        const draft = { ...createValidDraft(), visualTest };

        saveProjectDraft(draft, { storage });
        const restored = readProjectDraft({ storage });

        expect(restored.status).toBe("success");
        if (restored.status === "success") {
            expect(restored.value.visualTest).toEqual(visualTest);
            expect(restored.value.visualTest?.phase).toBe("results");
            expect(restored.value.visualTest?.result).toEqual(visualTest.result);
        }
    });

    it("migrates a v2 draft with its layout intact and removes only legacy keys", () => {
        const storage = new MemoryStorage();
        const current = createDraftWithLayout();
        const legacyV2 = { ...current, version: 2 };
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY, JSON.stringify(legacyV2));

        const result = readProjectDraft({ storage });

        expect(result).toEqual({
            status: "success",
            value: current,
            migratedFromVersion: 2,
        });
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY)).toBe(
            JSON.stringify(current),
        );
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("migrates a v3 rectangular draft to v4 geometry and stable segment anchors", () => {
        const storage = new MemoryStorage();
        const current = createValidDraft();
        if (!current.planner) throw new Error("Expected planner fixture.");
        const { geometry: _geometry, ...legacyRoom } = current.planner.room;
        const withoutSegment = <T extends { segmentId?: string }>(value: T) => {
            const { segmentId: _segmentId, ...rest } = value;
            return rest;
        };
        const legacyV3 = {
            ...current,
            version: 3,
            planner: {
                ...current.planner,
                room: {
                    ...legacyRoom,
                    doors: legacyRoom.doors.map(withoutSegment),
                    windows: legacyRoom.windows.map(withoutSegment),
                    radiators: (legacyRoom.radiators ?? []).map(withoutSegment),
                },
            },
        };
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY, JSON.stringify(legacyV3));

        const result = readProjectDraft({ storage });

        expect(result.status).toBe("success");
        if (result.status !== "success") return;
        expect(result.migratedFromVersion).toBe(3);
        expect(result.value.version).toBe(4);
        expect(result.value.planner?.room.geometry).toEqual({ version: 1, kind: "rect" });
        expect(result.value.planner?.room.doors[0].segmentId).toBe("rect-bottom");
        expect(result.value.planner?.room.windows[0].segmentId).toBe("rect-top");
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY)).toBeNull();
    });

    it("migrates a legacy v1 key without losing questionnaire and room data", () => {
        const storage = new MemoryStorage();
        const current = createValidDraft();
        storage.setItem(
            STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY,
            JSON.stringify({ ...current, version: 1 }),
        );

        const result = readProjectDraft({ storage });

        expect(result).toEqual({
            status: "success",
            value: current,
            migratedFromVersion: 1,
        });
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY)).toBe(
            JSON.stringify(current),
        );
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("discards a structurally damaged layout while preserving project inputs", () => {
        const storage = new MemoryStorage();
        const draft = createDraftWithLayout();
        storage.setItem(
            STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
            JSON.stringify({
                ...draft,
                planner: {
                    ...draft.planner,
                    layout: {
                        ...draft.planner?.layout,
                        placements: [{ ...draft.planner?.layout?.placements[0], x: "broken" }],
                    },
                },
            }),
        );

        const result = readProjectDraft({ storage });

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.discardedLayout).toBe(true);
            expect(result.value.planner?.layout).toBeUndefined();
            expect(result.value.planner?.selection).toEqual({ dresser: 1 });
            expect(result.value.planner?.room).toEqual(draft.planner?.room);
        }
    });

    it("discards a corrupt visual session without losing questionnaire, room or layout", () => {
        const storage = new MemoryStorage();
        const draft = createDraftWithLayout();
        const damaged = {
            ...draft,
            visualTest: { ...createVisualProgress(), round: 999 },
        };
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY, JSON.stringify(damaged));

        const result = readProjectDraft({ storage });

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.discardedVisualTest).toBe(true);
            expect(result.value.visualTest).toBeUndefined();
            expect(result.value.questionnaire).toEqual(draft.questionnaire);
            expect(result.value.planner).toEqual(draft.planner);
        }
        expect(
            JSON.parse(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY) ?? "null"),
        ).not.toHaveProperty("visualTest");
    });

    it("updates visual progress without changing questionnaire or planner data", () => {
        const storage = new MemoryStorage();
        const draft = createDraftWithLayout();
        saveProjectDraft(draft, { storage });
        const visualTest = createVisualProgress();

        const result = updateProjectDraftVisualTest(visualTest, {
            storage,
            now: 1_760_000_000_000,
        });

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.value.updatedAt).toBe(1_760_000_000_000);
            expect(result.value.visualTest).toEqual(visualTest);
            expect(result.value.questionnaire).toEqual(draft.questionnaire);
            expect(result.value.planner).toEqual(draft.planner);
        }
    });

    it("creates a valid empty project when visual progress is the first saved step", () => {
        const storage = new MemoryStorage();
        const visualTest = createVisualProgress();

        const result = updateProjectDraftVisualTest(visualTest, {
            storage,
            now: 1_760_000_000_000,
        });

        expect(result).toEqual({
            status: "success",
            value: {
                version: 4,
                updatedAt: 1_760_000_000_000,
                visualTest,
                questionnaire: { items: [] },
            },
        });
    });

    it("clears only visual progress and keeps questionnaire, room and layout", () => {
        const storage = new MemoryStorage();
        const visualTest = createVisualProgress();
        const draft = { ...createDraftWithLayout(), visualTest };
        saveProjectDraft(draft, { storage });

        const result = clearProjectDraftVisualTest({
            storage,
            now: 1_760_000_000_001,
        });

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.value.updatedAt).toBe(1_760_000_000_001);
            expect(result.value.visualTest).toBeUndefined();
            expect(result.value.questionnaire).toEqual(draft.questionnaire);
            expect(result.value.planner).toEqual(draft.planner);
        }
    });

    it("does not create a phantom project when visual progress is cleared before it exists", () => {
        const storage = new MemoryStorage();

        expect(clearProjectDraftVisualTest({ storage })).toEqual({ status: "missing" });
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("preserves visual progress when questionnaire or planner performs a normal save", () => {
        const storage = new MemoryStorage();
        const visualTest = createVisualProgress();
        saveProjectDraft({ ...createValidDraft(), visualTest }, { storage });
        const plannerSave = createDraftWithLayout();

        const result = saveProjectDraft(plannerSave, { storage });

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.value.visualTest).toEqual(visualTest);
            expect(result.value.questionnaire).toEqual(plannerSave.questionnaire);
            expect(result.value.planner).toEqual(plannerSave.planner);
        }
    });

    it("rejects a tampered visual update without touching the stored project", () => {
        const storage = new MemoryStorage();
        const draft = createValidDraft();
        saveProjectDraft(draft, { storage });
        const before = storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY);

        expect(
            updateProjectDraftVisualTest(
                { ...createVisualProgress(), answers: [{ impossible: true }] },
                { storage },
            ),
        ).toEqual({ status: "invalid", reason: "invalid-visual-test" });
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY)).toBe(before);
    });

    it("rejects restored coordinates that no longer pass geometry validation", () => {
        const draft = createDraftWithLayout();
        if (!draft.planner?.layout) throw new Error("Expected a persisted layout.");
        const invalidPlanner = {
            ...draft.planner,
            layout: {
                ...draft.planner.layout,
                placements: draft.planner.layout.placements.map((placement) => ({
                    ...placement,
                    x: 9999,
                })),
            },
        };

        const result = validateProjectDraftLayout(invalidPlanner);

        expect(result.status).toBe("invalid");
    });

    it("reports malformed JSON without throwing", () => {
        const storage = new MemoryStorage();
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY, "{not-json");

        expect(readProjectDraft({ storage })).toEqual({
            status: "invalid",
            reason: "malformed-json",
        });
    });

    it("fails safely for an unsupported schema version", () => {
        const storage = new MemoryStorage();
        storage.setItem(
            STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
            JSON.stringify({ ...createValidDraft(), version: 7 }),
        );

        expect(readProjectDraft({ storage })).toEqual({
            status: "unsupported-version",
            version: 7,
        });
    });

    it("removes all v1, v2 and v3 project keys on reset", () => {
        const storage = new MemoryStorage();
        saveProjectDraft(createValidDraft(), { storage });
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY, "legacy-v3");
        storage.setItem(STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY, "legacy-v2");
        storage.setItem(STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY, "legacy-v1");

        expect(resetProjectDraft({ storage })).toEqual({ status: "success" });
        expect(readProjectDraft({ storage })).toEqual({ status: "missing" });
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_V3_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(STYLEFINDER_PROJECT_DRAFT_V2_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(STYLEFINDER_LEGACY_PROJECT_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("preserves all three user priorities", () => {
        const storage = new MemoryStorage();
        const draft = createProjectDraft(
            {
                items: [
                    { definitionId: "single-bed", count: 1, priority: "required" },
                    { definitionId: "bookcase", count: 1, priority: "preferred" },
                    { definitionId: "dresser", count: 1, priority: "optional" },
                ],
            },
            undefined,
            1_750_000_000_000,
        );

        saveProjectDraft(draft, { storage });
        const result = readProjectDraft({ storage });

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.value.questionnaire.items.map((item) => item.priority)).toEqual([
                "required",
                "preferred",
                "optional",
            ]);
        }
    });
});
