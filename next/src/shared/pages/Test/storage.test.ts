import { describe, expect, it, vi } from "vitest";

import {
    answerVisualTest,
    createVisualTestSession,
    persistVisualTestSession,
    type SessionStorageLike,
} from "@/shared/lib/visual-preference";
import { restoreVisualTestForTab } from "./storage";

class MemoryStorage implements SessionStorageLike {
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

describe("visual-test storage recovery", () => {
    it("keeps a newer tab fallback when migrating it to the project still fails", () => {
        const fallbackStorage = new MemoryStorage();
        const projectSession = createVisualTestSession(101);
        const fallbackSession = answerVisualTest(createVisualTestSession(202), {
            kind: "choose",
            key: createVisualTestSession(202).slots[0].key,
        });
        persistVisualTestSession(fallbackStorage, fallbackSession);
        const saveProjectSession = vi.fn(() => ({ status: "unavailable" }));

        expect(
            restoreVisualTestForTab({
                projectSession,
                fallbackStorage,
                saveProjectSession,
            }),
        ).toEqual(fallbackSession);
        expect(saveProjectSession).toHaveBeenCalledWith(fallbackSession);
        expect(restoreVisualTestForTab({ fallbackStorage, saveProjectSession })).toEqual(
            fallbackSession,
        );
    });

    it("clears the fallback only after it is migrated successfully", () => {
        const fallbackStorage = new MemoryStorage();
        const fallbackSession = createVisualTestSession(303);
        persistVisualTestSession(fallbackStorage, fallbackSession);

        expect(
            restoreVisualTestForTab({
                fallbackStorage,
                saveProjectSession: () => ({ status: "success" }),
            }),
        ).toEqual(fallbackSession);
        expect(
            restoreVisualTestForTab({
                fallbackStorage,
                saveProjectSession: () => ({ status: "unavailable" }),
            }),
        ).toBeUndefined();
    });
});
