import { describe, expect, it } from "vitest";
import {
    STYLE_PROFILES,
    VISUAL_TEST_MAX_PRELOAD_URLS,
    VISUAL_TEST_SESSION_KEY,
    VISUAL_TEST_TOTAL_STEPS,
    answerVisualTest,
    clearVisualTestSession,
    createVisualTestSession,
    getReachableNextImageUrls,
    normalizeVisualTestSession,
    parseVisualTestSession,
    persistVisualTestSession,
    restoreVisualTestSession,
    serializeVisualTestSession,
    undoVisualTest,
    type SessionStorageLike,
    type VisualTestSession,
} from ".";

class MemoryStorage implements SessionStorageLike {
    readonly values = new Map<string, string>();

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

function answerFirst(session: VisualTestSession): VisualTestSession {
    return answerVisualTest(session, { kind: "choose", key: session.slots[0].key });
}

function reachFinalNode(seed = 20260717): VisualTestSession {
    let session = createVisualTestSession(seed);
    while (session.answers.length < 12) session = answerFirst(session);
    return session;
}

function finish(session: VisualTestSession): VisualTestSession {
    let current = session;
    while (current.phase === "playing") current = answerFirst(current);
    return current;
}

describe("visual preference engine", () => {
    it("creates the same first screen for the same seed", () => {
        expect(createVisualTestSession(42)).toEqual(createVisualTestSession(42));
    });

    it("balances left and right exposure in every four-round binary comparison", () => {
        let session = createVisualTestSession(73);
        const leftKeys: string[] = [];
        const allKeys = new Set<string>();

        for (let round = 0; round < 4; round += 1) {
            leftKeys.push(session.slots[0].key);
            session.slots.forEach((slot) => allKeys.add(slot.key));
            session = answerVisualTest(session, { kind: "both" });
        }

        for (const key of Array.from(allKeys)) {
            expect(leftKeys.filter((leftKey) => leftKey === key)).toHaveLength(2);
        }
    });

    it("shows each final pair twice and reverses its sides", () => {
        let session = reachFinalNode();
        const pairOrders = new Map<string, string[]>();

        for (let round = 0; round < 6; round += 1) {
            const order = session.slots.map((slot) => slot.key).join(":");
            const pair = session.slots
                .map((slot) => slot.key)
                .sort()
                .join(":");
            pairOrders.set(pair, [...(pairOrders.get(pair) ?? []), order]);
            session = answerVisualTest(session, { kind: "both" });
        }

        expect(pairOrders.size).toBe(3);
        for (const orders of Array.from(pairOrders.values())) {
            expect(orders).toHaveLength(2);
            expect(orders[0]).not.toBe(orders[1]);
        }
    });

    it("scores both and neither without favouring a slot", () => {
        const initial = createVisualTestSession(14);
        const both = answerVisualTest(initial, { kind: "both" });
        const neither = answerVisualTest(initial, { kind: "neither" });

        expect(both.scores[initial.slots[0].key]).toBe(0.5);
        expect(both.scores[initial.slots[1].key]).toBe(0.5);
        expect(neither.scores).toEqual({});
    });

    it("scores category identity rather than its left or right position", () => {
        const sessions = Array.from({ length: 100 }, (_, index) =>
            createVisualTestSession(index + 1),
        );
        const leftSession = sessions.find((session) => session.slots[0].key === "techno");
        const rightSession = sessions.find((session) => session.slots[1].key === "techno");

        expect(leftSession).toBeDefined();
        expect(rightSession).toBeDefined();
        expect(
            answerVisualTest(leftSession!, { kind: "choose", key: "techno" }).scores.techno,
        ).toBe(1);
        expect(
            answerVisualTest(rightSession!, { kind: "choose", key: "techno" }).scores.techno,
        ).toBe(1);
    });

    it("undoes to the exact preceding screen", () => {
        const initial = createVisualTestSession(81);
        const answered = answerVisualTest(initial, { kind: "neither" });

        expect(undoVisualTest(answered)).toEqual(initial);
    });

    it("round-trips a versioned in-progress session through storage", () => {
        const storage = new MemoryStorage();
        let session = createVisualTestSession(910);
        session = answerVisualTest(session, { kind: "both" });
        session = answerVisualTest(session, { kind: "neither" });
        session = answerFirst(session);

        expect(persistVisualTestSession(storage, session)).toBe(true);
        expect(restoreVisualTestSession(storage)).toEqual(session);
    });

    it("clears persisted progress for a confirmed restart", () => {
        const storage = new MemoryStorage();
        persistVisualTestSession(storage, createVisualTestSession(911));

        clearVisualTestSession(storage);

        expect(storage.getItem(VISUAL_TEST_SESSION_KEY)).toBeNull();
    });

    it("rejects corrupt, unsupported and tampered sessions safely", () => {
        const storage = new MemoryStorage();
        storage.setItem(VISUAL_TEST_SESSION_KEY, "{broken");
        expect(restoreVisualTestSession(storage)).toBeNull();
        expect(storage.getItem(VISUAL_TEST_SESSION_KEY)).toBeNull();

        const valid = createVisualTestSession(77);
        expect(
            parseVisualTestSession(JSON.stringify({ ...valid, version: valid.version + 1 })),
        ).toBeNull();
        expect(parseVisualTestSession(JSON.stringify({ ...valid, round: 3 }))).toBeNull();
    });

    it("normalizes an in-memory session to a detached replay-validated value", () => {
        const session = answerFirst(createVisualTestSession(912));
        const normalized = normalizeVisualTestSession(session);

        expect(normalized).toEqual(session);
        expect(normalized).not.toBe(session);
        expect(normalizeVisualTestSession({ ...session, slots: [] })).toBeNull();
    });

    it("persists a complete honest result with three ranked styles", () => {
        const resultSession = finish(createVisualTestSession(808));
        const restored = parseVisualTestSession(serializeVisualTestSession(resultSession));

        expect(resultSession.answers).toHaveLength(VISUAL_TEST_TOTAL_STEPS);
        expect(resultSession.phase).toBe("results");
        expect(resultSession.result).toBeDefined();
        expect(resultSession.result?.nearbyKeys).toHaveLength(2);
        expect(resultSession.result?.confidenceScore).toBeGreaterThanOrEqual(18);
        expect(resultSession.result?.confidenceScore).toBeLessThanOrEqual(88);
        expect(STYLE_PROFILES[resultSession.result!.primaryKey]).toBeDefined();
        expect(restored).toEqual(resultSession);
    });

    it("preloads only the bounded set of reachable next images", () => {
        let session = createVisualTestSession(119);

        for (let step = 0; step < VISUAL_TEST_TOTAL_STEPS; step += 1) {
            const urls = getReachableNextImageUrls(session);
            expect(urls.length).toBeLessThanOrEqual(VISUAL_TEST_MAX_PRELOAD_URLS);
            expect(new Set(urls).size).toBe(urls.length);
            expect(urls.every((url) => url.endsWith(".webp"))).toBe(true);
            session = answerFirst(session);
            if (session.phase === "results") break;
        }
    });
});
