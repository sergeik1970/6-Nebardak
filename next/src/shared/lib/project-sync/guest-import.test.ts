import { describe, expect, it, vi } from "vitest";
import { saveProjectDraft } from "@/shared/lib/furniture-planner/project-draft";
import { DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY } from "@/shared/lib/project-scope/storage";
import {
    MemoryStorage,
    createFixtureDraft,
    fixtureDrawing,
} from "@/shared/lib/project-scope/test-fixtures";
import { GUEST_IMPORT_ID_KEY, importGuestDraft, readGuestDocument } from "./guest-import";

const seededGuest = () => {
    const storage = new MemoryStorage();
    saveProjectDraft(createFixtureDraft(), { storage });
    storage.setItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(fixtureDrawing));
    return storage;
};

describe("guest draft import", () => {
    it("creates one project with the whole document, then clears the guest copy", async () => {
        const storage = seededGuest();
        const create = vi.fn(async () => ({ id: "new-project", name: "Проект 1" }) as never);

        await expect(importGuestDraft({ create }, storage)).resolves.toMatchObject({
            id: "new-project",
        });

        const [input] = create.mock.calls[0] as unknown as [Record<string, unknown>];
        expect(input).toMatchObject({
            document: { version: 5, drawing: { segments: expect.any(Array) } },
            summary: { stage: "room", styleLabel: "Прованс" },
            clientImportId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/),
        });
        expect(readGuestDocument(storage)).toBeNull();
        expect(storage.getItem(DRAW_ROOM_EDITOR_SESSION_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(GUEST_IMPORT_ID_KEY)).toBeNull();
    });

    it("retries with the same idempotency key and keeps the draft after a failure", async () => {
        const storage = seededGuest();
        const create = vi
            .fn()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce({ id: "new-project", name: "Проект 1" });

        await expect(importGuestDraft({ create }, storage)).rejects.toThrow("network");
        expect(readGuestDocument(storage)).not.toBeNull();
        await importGuestDraft({ create }, storage);

        expect(create.mock.calls[0][0].clientImportId).toBe(create.mock.calls[1][0].clientImportId);
    });

    it("does nothing when the guest has not entered anything", async () => {
        const create = vi.fn();

        await expect(importGuestDraft({ create }, new MemoryStorage())).resolves.toBeNull();
        expect(create).not.toHaveBeenCalled();
    });
});
