import React from "react";
import styles from "./index.module.scss";

interface RadioChoiceProps<T extends string> {
    id: string;
    name: string;
    value: T;
    checked: boolean;
    label: string;
    onChange: (value: T) => void;
}

const RadioChoice = <T extends string>({
    id,
    name,
    value,
    checked,
    label,
    onChange,
}: RadioChoiceProps<T>) => (
    <label className={styles.radioChoice} htmlFor={id}>
        <input
            id={id}
            type="radio"
            name={name}
            value={value}
            checked={checked}
            onChange={() => onChange(value)}
        />
        <span aria-hidden="true" className={styles.radioIndicator} />
        <strong>{label}</strong>
        <span aria-hidden="true" className={styles.selectedMarker}>
            ✓
        </span>
    </label>
);

export default RadioChoice;
