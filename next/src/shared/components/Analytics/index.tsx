import { useRouter } from "next/router";
import React, { useEffect, useRef, useState } from "react";
import {
    readAnalyticsConsent,
    subscribeAnalyticsConsent,
    writeAnalyticsConsent,
    type AnalyticsConsent,
} from "@/shared/lib/analytics/consent";
import { forgetMetrika, loadMetrika, sendMetrikaHit } from "@/shared/lib/analytics/metrika";
import ConsentBanner from "./ConsentBanner";

export interface AnalyticsProps {
    counterId: number;
}

/** Asks for consent and, once given, runs Yandex Metrika with a page view per route. */
const Analytics: React.FC<AnalyticsProps> = ({ counterId }) => {
    const router = useRouter();
    // `undefined` until the stored choice is read: the server render shows no banner.
    const [consent, setConsent] = useState<AnalyticsConsent | null | undefined>(undefined);

    useEffect(() => {
        setConsent(readAnalyticsConsent());
        return subscribeAnalyticsConsent(setConsent);
    }, []);

    const wasGranted = useRef(false);

    useEffect(() => {
        if (consent !== "granted") {
            // A running counter cannot be stopped: drop its identifiers and start clean.
            if (wasGranted.current) {
                forgetMetrika();
                window.location.reload();
            }
            return;
        }
        wasGranted.current = true;

        let previousUrl = window.location.href;
        if (loadMetrika(counterId)) sendMetrikaHit(previousUrl, document.referrer);

        // Query-only changes (project id, hand-off tokens) stay within the same page view.
        const handleRouteChange = () => {
            const nextUrl = window.location.href;
            if (new URL(nextUrl).pathname === new URL(previousUrl).pathname) return;
            sendMetrikaHit(nextUrl, previousUrl);
            previousUrl = nextUrl;
        };
        router.events.on("routeChangeComplete", handleRouteChange);
        return () => router.events.off("routeChangeComplete", handleRouteChange);
    }, [consent, counterId, router.events]);

    return consent === null ? <ConsentBanner onChoice={writeAnalyticsConsent} /> : null;
};

export default Analytics;
