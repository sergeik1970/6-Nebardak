import clsx from "clsx";
import React, { InputHTMLAttributes, forwardRef, useId } from "react";
import styles from "./index.module.scss";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
    label?: React.ReactNode;
    description?: React.ReactNode;
    error?: React.ReactNode;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
    { className, description, error, id, label, ...props },
    ref,
) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [props["aria-describedby"], descriptionId, errorId]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={clsx(styles.checkbox, className)}>
            <label className={styles.control} htmlFor={inputId}>
                <input
                    {...props}
                    ref={ref}
                    aria-describedby={describedBy || undefined}
                    aria-invalid={Boolean(error) || props["aria-invalid"] || undefined}
                    className={styles.input}
                    id={inputId}
                    type="checkbox"
                />
                <span aria-hidden="true" className={styles.box} />
                {label ? <span className={styles.label}>{label}</span> : null}
            </label>
            {description ? (
                <span className={styles.description} id={descriptionId}>
                    {description}
                </span>
            ) : null}
            {error ? (
                <span className={styles.error} id={errorId} role="alert">
                    {error}
                </span>
            ) : null}
        </div>
    );
});

export default Checkbox;
