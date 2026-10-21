import { useRouter } from "next/router";
import { useEffect, useState } from "react";

/**
 * Reads `?token=` from an email link once, then removes it from the address
 * bar so it does not linger in history, bookmarks or screenshots.
 *
 * `undefined` while the router is not ready, `null` when the link had none.
 */
export function useOneTimeUrlToken(): string | null | undefined {
    const router = useRouter();
    const [token, setToken] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        if (!router.isReady || token !== undefined) return;

        const value = router.query.token;
        setToken(typeof value === "string" && value ? value : null);
        if (value !== undefined) {
            void router.replace({ pathname: router.pathname }, undefined, { shallow: true });
        }
    }, [router, token]);

    return token;
}
