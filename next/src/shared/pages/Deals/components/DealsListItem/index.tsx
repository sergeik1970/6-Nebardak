import { IDeal } from "@/shared/types/deals";
import React, { ReactElement, useEffect, useState } from "react";
import styles from "./index.module.scss";
import Button from "@/shared/components/Button";
import { useDispatch } from "@/shared/store/store";
import { changeDeal, deleteDeal } from "@/shared/store/slices/deals/thunks";
import InputText from "@/shared/components/InputText";
import useDebounce from "@/shared/hooks/useDebounce";
import Checkbox from "@/shared/components/Checkbox";

const DealsListItem = ({ item }: { item: IDeal }): ReactElement => {
    const dispatch = useDispatch();
    const [currentItem, setItem] = useState(item);
    const deleteClick = () => {
        dispatch(deleteDeal({ id: String(item.id) }));
    };

    const changeItem = useDebounce((newItem) => {
        dispatch(changeDeal({ id: String(item.id), element: newItem }));
    }, 300);

    const changeName = (e: any) => {
        if (e.target.value.trim() !== currentItem.name) {
            setItem({
                ...currentItem,
                name: e.target.value || "",
            });
        }
    };

    const changeDone = (e: any) => {
        setItem({
            ...currentItem,
            done: e.target.checked,
        });
    };

    useEffect(() => {
        if (currentItem && currentItem !== item) {
            changeItem(currentItem);
        }
    }, [currentItem]);

    return (
        <li className={styles["item"]}>
            <div className={styles["item-wrap"]}>
                <InputText
                    className={styles["input"]}
                    defaultValue={item.name}
                    onChange={changeName}
                />
                <Checkbox defaultChecked={item.done} onChange={changeDone} />
            </div>
            <Button onClick={deleteClick}>delete</Button>
        </li>
    );
};

export default DealsListItem;
