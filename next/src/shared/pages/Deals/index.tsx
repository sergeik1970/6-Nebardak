import React, { ReactElement, useRef, useEffect, useState } from "react";
import Button from "@/shared/components/Button";
import { useDispatch } from "@/shared/store/store";
import { getDeals, addDeal } from "@/shared/store/slices/deals/thunks";
import DealsList from "./components/DealsList";
import InputText from "@/shared/components/InputText";
import styles from "./index.module.scss";

const Deals = (): ReactElement => {
    const dispatch = useDispatch();
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const click = () => {
        if (value) {
            dispatch(addDeal({ name: value }));
        }
        if (inputRef.current) inputRef.current.value = "";
        setValue("");
    };

    const change = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value);
    };

    useEffect(() => {
        dispatch(getDeals());
    }, []);

    return (
        <div>
            <div className={styles["wrap"]}>
                <InputText className={styles["input"]} ref={inputRef} onChange={change} />
                <Button onClick={click}>add deal</Button>
            </div>
            <DealsList />
        </div>
    );
};

export default Deals;
