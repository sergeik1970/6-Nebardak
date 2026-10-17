import clsx from "clsx";
import React, { ButtonHTMLAttributes, forwardRef } from "react";
import styles from "./index.module.scss";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    types?: "primary" | "secondary";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { children, className, type = "button", types = "primary", ...props },
    ref,
) {
    return (
        <button
            {...props}
            ref={ref}
            className={clsx(styles.button, styles[`button-${types}`], className)}
            type={type}
        >
            {children}
        </button>
    );
});

export default Button;
