import React, { useEffect, useState } from "react";
import { yandexMetrikaCounterId } from "@/shared/config/runtime";
import {
    readAnalyticsConsent,
    subscribeAnalyticsConsent,
    writeAnalyticsConsent,
    type AnalyticsConsent,
} from "@/shared/lib/analytics/consent";
import styles from "./index.module.scss";

const STATUS_TEXT: Record<AnalyticsConsent | "none", string> = {
    granted: "Сейчас веб-аналитика разрешена.",
    denied: "Сейчас веб-аналитика отключена.",
    none: "Вы ещё не сделали выбор.",
};

/** Lets the visitor change or withdraw the analytics consent from the privacy policy. */
const AnalyticsChoice: React.FC = () => {
    const [consent, setConsent] = useState<AnalyticsConsent | null | undefined>(undefined);

    useEffect(() => {
        setConsent(readAnalyticsConsent());
        return subscribeAnalyticsConsent(setConsent);
    }, []);

    if (yandexMetrikaCounterId === null || consent === undefined) return null;

    return (
        <p className={styles.choice} aria-live="polite">
            {STATUS_TEXT[consent ?? "none"]}{" "}
            {consent === "granted" ? (
                <button type="button" onClick={() => writeAnalyticsConsent("denied")}>
                    Отозвать согласие
                </button>
            ) : (
                <button type="button" onClick={() => writeAnalyticsConsent("granted")}>
                    Разрешить аналитику
                </button>
            )}
        </p>
    );
};

export default AnalyticsChoice;
