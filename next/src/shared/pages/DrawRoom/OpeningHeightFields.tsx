import { useEffect, useState } from "react";

import {
    DOOR_HEIGHT_RANGE_MM,
    getDoorHeight,
    getDoorHeightError,
    getWindowHeight,
    getWindowHeightError,
    getWindowSillHeight,
    WINDOW_HEIGHT_RANGE_MM,
    WINDOW_SILL_RANGE_MM,
} from "@/shared/lib/furniture-planner/opening-heights";
import type { DoorOpening, WindowOpening } from "@/shared/lib/furniture-planner/types";

import styles from "./index.module.scss";

type HeightPatch = Pick<WindowOpening, "height" | "sillHeight">;

interface HeightInputProps {
    label: string;
    value: number;
    minimum: number;
    maximum: number;
    step: number;
    /** Returns false when the value is refused; the field then shows the current one. */
    onCommit: (value: number) => boolean;
}

/**
 * Typing 2100 passes through 2, 21 and 210, none of them a real height. The
 * value is kept as a draft and applied on Enter or when the field is left,
 * so the person can type it out instead of fighting a rejected keystroke.
 */
const HeightInput = ({ label, value, minimum, maximum, step, onCommit }: HeightInputProps) => {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(value)), [value]);
    const commit = () => {
        const next = Number(draft);
        if (draft.trim() === "" || next === value) {
            setDraft(String(value));
            return;
        }
        if (!onCommit(next)) setDraft(String(value));
    };
    return (
        <label className={styles.openingControl}>
            <span>{label}</span>
            <input
                type="number"
                inputMode="numeric"
                aria-label={label}
                min={minimum}
                max={maximum}
                step={step}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                    }
                }}
            />
        </label>
    );
};

interface OpeningHeightFieldsProps {
    kind: "door" | "window";
    item: DoorOpening | WindowOpening;
    step: number;
    onChange: (patch: HeightPatch) => void;
    onReject: (message: string) => void;
}

export const OpeningHeightFields = ({
    kind,
    item,
    step,
    onChange,
    onReject,
}: OpeningHeightFieldsProps) => {
    if (kind === "door") {
        const height = getDoorHeight(item as DoorOpening);
        return (
            <HeightInput
                label="Высота, мм"
                value={height}
                minimum={DOOR_HEIGHT_RANGE_MM.minimum}
                maximum={DOOR_HEIGHT_RANGE_MM.maximum}
                step={step}
                onCommit={(next) => {
                    const error = getDoorHeightError(next);
                    if (error) onReject(error);
                    else onChange({ height: next });
                    return !error;
                }}
            />
        );
    }
    const window = item as WindowOpening;
    const height = getWindowHeight(window);
    const sillHeight = getWindowSillHeight(window);
    const apply = (patch: HeightPatch) => {
        const error = getWindowHeightError(patch.height ?? height, patch.sillHeight ?? sillHeight);
        if (error) onReject(error);
        else onChange(patch);
        return !error;
    };
    return (
        <>
            <HeightInput
                label="Высота, мм"
                value={height}
                minimum={WINDOW_HEIGHT_RANGE_MM.minimum}
                maximum={WINDOW_HEIGHT_RANGE_MM.maximum}
                step={step}
                onCommit={(next) => apply({ height: next })}
            />
            {window.windowKind !== "floor-to-ceiling" && (
                <HeightInput
                    label="Высота подоконника, мм"
                    value={sillHeight}
                    minimum={WINDOW_SILL_RANGE_MM.minimum}
                    maximum={WINDOW_SILL_RANGE_MM.maximum}
                    step={step}
                    onCommit={(next) => apply({ sillHeight: next })}
                />
            )}
        </>
    );
};
