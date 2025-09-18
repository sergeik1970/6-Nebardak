import { IDeal } from "@/shared/types/deals";
import React, { ReactElement } from "react";
import DealsListItem from "../DealsListItem";
import { useSelector } from "@/shared/store/store";
import { selectDeals } from "@/shared/store/slices/deals";
import styles from "./index.module.scss";

const DealsList = (): ReactElement => {
    const deals = useSelector(selectDeals);

    // Логирование для отладки
    console.log(
        "DealsList - deals from selector:",
        deals,
        "type:",
        typeof deals,
        "isArray:",
        Array.isArray(deals),
    );

    // Если deals не является массивом, не рендерим ничего
    if (!Array.isArray(deals)) {
        console.warn("DealsList - deals is not an array, rendering empty list");
        return <ul className={styles["list"]}></ul>;
    }

    return (
        <ul className={styles["list"]}>
            {deals.map((el) => (
                <DealsListItem item={el} key={el.id} />
            ))}
        </ul>
    );
};

export default DealsList;
