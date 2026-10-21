import { describe, expect, it } from "vitest";
import {
    STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
    saveProjectDraft,
} from "@/shared/lib/furniture-planner/project-draft";
import {
    isEmptyProjectDocument,
    normalizeProjectDocument,
    readProjectDocument,
    summarizeProjectDocument,
    writeProjectDocument,
} from "./document";
import { DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY } from "./storage";
import { MemoryStorage, createFixtureDraft, fixtureDrawing } from "./test-fixtures";

const seed = (storage: MemoryStorage, drawing: unknown = fixtureDrawing) => {
    expect(saveProjectDraft(createFixtureDraft(), { storage }).status).toBe("success");
    storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(drawing));
};

describe("project document v5", () => {
    it("assembles the draft and the room drawing into one document", () => {
        const storage = new MemoryStorage();
        seed(storage);

        const result = readProjectDocument(storage);

        expect(result.status).toBe("success");
        if (result.status !== "success") return;
        expect(result.value.version).toBe(5);
        expect(result.value.questionnaire.items).toHaveLength(2);
        expect(result.value.drawing?.segments).toHaveLength(4);
        expect(result.value.drawing?.regions?.items[0].name).toBe("Спальня");
    });

    it("round-trips through another store without loss", () => {
        const source = new MemoryStorage();
        seed(source);
        const document = readProjectDocument(source);
        if (document.status !== "success") throw new Error("seed failed");

        const target = new MemoryStorage();
        expect(
            writeProjectDocument(target, JSON.parse(JSON.stringify(document.value))).status,
        ).toBe("success");

        expect(readProjectDocument(target)).toEqual(document);
    });

    it("replaces exactly: sections missing from the document are cleared", () => {
        const storage = new MemoryStorage();
        seed(storage);
        storage.setItem(
            STYLEFINDER_PROJECT_DRAFT_STORAGE_KEY,
            JSON.stringify({
                ...createFixtureDraft(),
                visualTest: undefined,
            }),
        );
        const { drawing: _drawing, ...withoutDrawing } = {
            ...createFixtureDraft(),
            version: 5,
            drawing: fixtureDrawing,
        };

        expect(writeProjectDocument(storage, withoutDrawing).status).toBe("success");

        expect(storage.getItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY)).toBeNull();
    });

    it("upgrades an older draft and rejects a broken drawing", () => {
        const upgraded = normalizeProjectDocument({ ...createFixtureDraft(), version: 4 });
        expect(upgraded).toMatchObject({ status: "success", value: { version: 5 } });

        expect(
            normalizeProjectDocument({
                ...createFixtureDraft(),
                version: 5,
                drawing: { segments: "not-a-list" },
            }),
        ).toEqual({ status: "invalid", reason: "invalid-drawing" });
        expect(normalizeProjectDocument(null)).toEqual({
            status: "invalid",
            reason: "invalid-payload",
        });
    });

    it("reports an empty store and ignores a corrupt editor cache", () => {
        const storage = new MemoryStorage();
        expect(readProjectDocument(storage)).toEqual({ status: "empty" });

        storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, "{not json");
        expect(readProjectDocument(storage)).toEqual({ status: "empty" });
        expect(readProjectDocument(null)).toEqual({ status: "unavailable" });
    });

    it("keeps a drawing-only project (room drawn before any furniture)", () => {
        const storage = new MemoryStorage();
        storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(fixtureDrawing));

        const result = readProjectDocument(storage);

        expect(result).toMatchObject({
            status: "success",
            value: { questionnaire: { items: [] } },
        });
        if (result.status === "success") {
            expect(isEmptyProjectDocument(result.value)).toBe(false);
            expect(summarizeProjectDocument(result.value)).toEqual({ stage: "room" });
        }
    });

    it("summarises style, area, furniture and stage for the project list", () => {
        const document = normalizeProjectDocument(createFixtureDraft());
        if (document.status !== "success") throw new Error("fixture invalid");

        expect(summarizeProjectDocument(document.value)).toEqual({
            stage: "room",
            styleLabel: "Прованс",
            areaM2: 27,
            furnitureCount: 2,
        });
        expect(isEmptyProjectDocument(document.value)).toBe(false);
    });
});
