import Link from "next/link";
import React from "react";
import type { AnalyticsConsent } from "@/shared/lib/analytics/consent";
import styles from "./index.module.scss";

export interface ConsentBannerProps {
    onChoice: (choice: AnalyticsConsent) => void;
}

/** Non-modal on purpose: the site works the same whatever the visitor picks, or if they ignore it. */
const ConsentBanner: React.FC<ConsentBannerProps> = ({ onChoice }) => (
    <section className={styles.banner} aria-label="Согласие на веб-аналитику" data-consent-banner>
        <p className={styles.text}>
            Можно включить Яндекс Метрику? Она использует cookie и помогает понять, где сервисом
            неудобно пользоваться. Без вашего согласия она не загружается.{" "}
            <Link href="/privacy#cookies">Подробнее</Link>
        </p>
        <div className={styles.actions}>
            <button
                className={`${styles.action} ${styles.accept}`}
                type="button"
                onClick={() => onChoice("granted")}
            >
                Разрешить
            </button>
            <button className={styles.action} type="button" onClick={() => onChoice("denied")}>
                Отказаться
            </button>
        </div>
    </section>
);

export default ConsentBanner;
