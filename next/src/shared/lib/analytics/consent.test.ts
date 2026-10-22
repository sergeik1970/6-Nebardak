import { describe, expect, it } from "vitest";
import {
    ANALYTICS_CONSENT_KEY,
    clearAnalyticsConsent,
    readAnalyticsConsent,
    writeAnalyticsConsent,
} from "./consent";

const memoryStorage = () => {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
    };
};

describe("analytics consent", () => {
    it("has no choice until the visitor makes one", () => {
        expect(readAnalyticsConsent(memoryStorage())).toBeNull();
        expect(readAnalyticsConsent(null)).toBeNull();
    });

    it("remembers a choice and forgets it on reset", () => {
        const storage = memoryStorage();

        writeAnalyticsConsent("granted", storage);
        expect(readAnalyticsConsent(storage)).toBe("granted");

        writeAnalyticsConsent("denied", storage);
        expect(readAnalyticsConsent(storage)).toBe("denied");

        clearAnalyticsConsent(storage);
        expect(readAnalyticsConsent(storage)).toBeNull();
    });

    it("treats a damaged or unknown record as no choice", () => {
        const storage = memoryStorage();

        storage.setItem(ANALYTICS_CONSENT_KEY, "{oops");
        expect(readAnalyticsConsent(storage)).toBeNull();

        storage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({ choice: "maybe" }));
        expect(readAnalyticsConsent(storage)).toBeNull();
    });

    it("survives storage that throws", () => {
        const broken = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
            removeItem: () => {
                throw new Error("blocked");
            },
        };

        expect(readAnalyticsConsent(broken)).toBeNull();
        expect(() => writeAnalyticsConsent("granted", broken)).not.toThrow();
        expect(() => clearAnalyticsConsent(broken)).not.toThrow();
    });
});
