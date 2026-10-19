import React, { useEffect, useRef } from "react";

interface RemovalConfirmationDialogProps {
    open: boolean;
    itemName: string;
    fallbackFocusRef?: React.RefObject<HTMLElement>;
    onCancel: () => void;
    onConfirm: () => void;
    backdropClassName?: string;
    dialogClassName?: string;
}

const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

const RemovalConfirmationDialog: React.FC<RemovalConfirmationDialogProps> = ({
    open,
    itemName,
    fallbackFocusRef,
    onCancel,
    onConfirm,
    backdropClassName,
    dialogClassName,
}) => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!open) return;

        returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const fallbackFocus = fallbackFocusRef?.current ?? null;
        cancelButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
                return;
            }
            if (event.key !== "Tab" || !dialogRef.current) return;

            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
            );
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!first || !last) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            const previous = returnFocusRef.current;
            if (previous?.isConnected) previous.focus();
            else fallbackFocus?.focus();
        };
    }, [fallbackFocusRef, onCancel, open]);

    if (!open) return null;

    return (
        <div
            className={backdropClassName}
            onClick={(event) => {
                if (event.currentTarget === event.target) onCancel();
            }}
        >
            <div
                ref={dialogRef}
                className={dialogClassName}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manual-removal-title"
                aria-describedby="manual-removal-description"
                tabIndex={-1}
            >
                <span aria-hidden="true">!</span>
                <h2 id="manual-removal-title">Убрать предмет из планировки?</h2>
                <p id="manual-removal-description">
                    «{itemName}» исчезнет из текущего комплекта. Действие можно отменить кнопкой
                    «Отменить» над планом или сочетанием Ctrl/Cmd + Z.
                </p>
                <div>
                    <button ref={cancelButtonRef} type="button" onClick={onCancel}>
                        Отмена
                    </button>
                    <button type="button" onClick={onConfirm}>
                        Убрать предмет
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RemovalConfirmationDialog;
