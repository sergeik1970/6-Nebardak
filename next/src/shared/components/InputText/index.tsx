import React, { ReactElement, forwardRef } from "react";
import styles from "./index.module.scss";
import clsx from "clsx";

interface IInputText extends React.HTMLAttributes<HTMLInputElement> {
    a?: boolean;
}

export type Ref = HTMLInputElement;

const InputText = React.forwardRef<Ref, IInputText>((props: IInputText, realRef): ReactElement => {
    const { className = "", ...rest } = props;
    return (
        <input {...rest} ref={realRef} className={clsx(styles["input"], className)} type="text" />
    );
});

export default InputText;
