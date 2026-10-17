import React from "react";
import { isBetaBadgeEnabled } from "@/shared/config/runtime";
import styles from "./index.module.scss";

export interface BetaBadgeProps {
    enabled?: boolean;
}

const BetaBadge: React.FC<BetaBadgeProps> = ({ enabled = isBetaBadgeEnabled }) => {
    if (!enabled) return null;

    return (
        <span aria-label="Бета-версия сайта" className={styles.badge}>
            Бета
        </span>
    );
};

export default BetaBadge;
