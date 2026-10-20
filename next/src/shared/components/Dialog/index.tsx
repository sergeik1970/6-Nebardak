import React, { ReactNode, useEffect, useId, useRef } from "react";
import styles from "./index.module.scss";

interface DialogProps {
    open: boolean;
    title: string;
    children: ReactNode;
    actions: ReactNode;
    /** Escape or the browser's cancel gesture; omit to make the choice mandatory. */
    onCancel?: () => void;
}

/**
 * A modal built on the native `<dialog>`: the browser supplies the focus
 * trap, the inert background and Escape handling.
 */
const Dialog: React.FC<DialogProps> = ({ open, title, children, actions, onCancel }) => {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            aria-labelledby={titleId}
            className={styles.dialog}
            onCancel={(event) => {
                event.preventDefault();
                onCancel?.();
            }}
            ref={ref}
        >
            <h2 className={styles.title} id={titleId}>
                {title}
            </h2>
            <div className={styles.body}>{children}</div>
            <div className={styles.actions}>{actions}</div>
        </dialog>
    );
};

export default Dialog;
