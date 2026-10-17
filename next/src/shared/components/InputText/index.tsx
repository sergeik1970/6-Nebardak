import clsx from "clsx";
import React, { forwardRef } from "react";
import styles from "./index.module.scss";

export interface InputTextProps extends React.InputHTMLAttributes<HTMLInputElement> {
    invalid?: boolean;
}

const InputText = forwardRef<HTMLInputElement, InputTextProps>(function InputText(
    { className, invalid, type = "text", ...props },
    ref,
) {
    return (
        <input
            {...props}
            ref={ref}
            aria-invalid={invalid || props["aria-invalid"] || undefined}
            className={clsx(styles.input, invalid && styles.invalid, className)}
            type={type}
        />
    );
});

export default InputText;
