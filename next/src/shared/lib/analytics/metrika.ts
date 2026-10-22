type Ym = ((counterId: number, method: string, ...args: unknown[]) => void) & {
    a?: IArguments[];
    l?: number;
};

declare global {
    interface Window {
        ym?: Ym;
    }
}

const TAG_URL = "https://mc.yandex.ru/metrika/tag.js";

let activeCounterId: number | null = null;

/**
 * Injects tag.js once. Calls made before it arrives are queued by Yandex's
 * own stub. Returns false when the counter was already running.
 */
export const loadMetrika = (counterId: number): boolean => {
    if (activeCounterId !== null) return false;
    activeCounterId = counterId;

    if (!window.ym) {
        const stub: Ym = function () {
            // tag.js replays the queue in this exact shape.
            (stub.a = stub.a || []).push(arguments);
        };
        stub.l = Date.now();
        window.ym = stub;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = `${TAG_URL}?id=${counterId}`;
    document.head.appendChild(script);

    // `defer`: page views are sent by hand, since Next.js changes pages without reloads.
    // Session replay (webvisor) stays off: it records what people type and is not in the policy.
    window.ym(counterId, "init", {
        defer: true,
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
        webvisor: false,
    });
    return true;
};

export const sendMetrikaHit = (url: string, referer?: string): void => {
    if (activeCounterId === null) return;
    window.ym?.(activeCounterId, "hit", url, referer ? { referer } : {});
};

export const reachMetrikaGoal = (goal: string, params?: Record<string, unknown>): void => {
    if (activeCounterId === null) return;
    window.ym?.(activeCounterId, "reachGoal", goal, params);
};

/** Removes the identifiers Metrika left in this browser after consent is withdrawn. */
export const forgetMetrika = (): void => {
    const host = window.location.hostname;
    for (const entry of document.cookie.split(";")) {
        const name = entry.split("=")[0]?.trim();
        if (!name?.startsWith("_ym")) continue;
        for (const domain of ["", `; domain=${host}`, `; domain=.${host}`]) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
        }
    }

    try {
        for (const key of Object.keys(window.localStorage)) {
            if (key.startsWith("_ym")) window.localStorage.removeItem(key);
        }
    } catch {
        // Storage blocked: Metrika could not have written there either.
    }
};
