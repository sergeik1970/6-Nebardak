export type AnalyticsConsent = "granted" | "denied";

export const ANALYTICS_CONSENT_KEY = "stylefinder:analytics-consent:v1";

const CHANGE_EVENT = "stylefinder:analytics-consent-change";

type ConsentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Private windows and blocked site data throw on access; the choice then lives for the page only. */
const browserStorage = (): ConsentStorage | null => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const parseConsent = (raw: string | null): AnalyticsConsent | null => {
    if (!raw) return null;
    try {
        const choice = (JSON.parse(raw) as { choice?: unknown }).choice;
        return choice === "granted" || choice === "denied" ? choice : null;
    } catch {
        return null;
    }
};

export const readAnalyticsConsent = (
    storage: ConsentStorage | null = browserStorage(),
): AnalyticsConsent | null => {
    try {
        return parseConsent(storage?.getItem(ANALYTICS_CONSENT_KEY) ?? null);
    } catch {
        return null;
    }
};

const announce = (choice: AnalyticsConsent | null) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: choice }));
};

export const writeAnalyticsConsent = (
    choice: AnalyticsConsent,
    storage: ConsentStorage | null = browserStorage(),
): void => {
    try {
        storage?.setItem(
            ANALYTICS_CONSENT_KEY,
            JSON.stringify({ choice, at: new Date().toISOString() }),
        );
    } catch {
        // Not persisted: the banner returns on the next visit, which is the safe side.
    }
    announce(choice);
};

export const clearAnalyticsConsent = (storage: ConsentStorage | null = browserStorage()): void => {
    try {
        storage?.removeItem(ANALYTICS_CONSENT_KEY);
    } catch {
        // Nothing stored to clear.
    }
    announce(null);
};

/** Follows the choice made in this tab and in other tabs of the same browser. */
export const subscribeAnalyticsConsent = (
    listener: (choice: AnalyticsConsent | null) => void,
): (() => void) => {
    const handleChange = (event: Event) =>
        listener((event as CustomEvent<AnalyticsConsent | null>).detail);
    const handleStorage = (event: StorageEvent) => {
        if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) {
            listener(parseConsent(event.newValue));
        }
    };

    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
        window.removeEventListener(CHANGE_EVENT, handleChange);
        window.removeEventListener("storage", handleStorage);
    };
};
