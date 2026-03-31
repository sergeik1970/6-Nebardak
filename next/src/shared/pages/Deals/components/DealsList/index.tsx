import React, { ReactElement } from "react";
import DealsListItem from "../DealsListItem";
import { useSelector } from "@/shared/store/store";
import { selectDeals } from "@/shared/store/slices/deals";
import styles from "./index.module.scss";

const DealsList = (): ReactElement => {
    const deals = useSelector(selectDeals);

    return (
        <ul className={styles["list"]}>
            {deals.map((el) => (
                <DealsListItem item={el} key={el.id} />
            ))}
        </ul>
    );
};

export default DealsList;
