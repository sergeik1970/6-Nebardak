import React, { useState } from "react";
import type { PlannerObservationVerdict } from "@/services/plannerObservationService";
import { FURNITURE_CATALOG, getMaximumFurnitureCount } from "@/shared/lib/furniture-planner";
import styles from "./furniture.module.scss";

const VERDICTS: { value: PlannerObservationVerdict; label: string }[] = [
    { value: "good", label: "Хорошо" },
    { value: "questionable", label: "Спорно" },
    { value: "needs-fix", label: "Нужно исправить" },
];

export interface AutoLayoutVariantSummary {
    label: string;
    count: number;
}

/**
 * «Подобрать расстановку» for the selected room: the set to place, prefilled
 * from the room kind, and the solved variants. Applying a variant replaces
 * the room's unlocked furniture; undo brings the previous one back.
 */
export default function AutoLayoutPanel({
    set,
    onSetChange,
    onSolve,
    solving,
    status,
    variants,
    appliedIndex,
    onApply,
    blockedReason,
    reviewable = false,
    reviewHint = null,
    reviewStatus = "",
    onReview,
}: {
    set: Record<string, number>;
    onSetChange: (set: Record<string, number>) => void;
    onSolve: () => void;
    solving: boolean;
    status: string;
    variants: AutoLayoutVariantSummary[];
    appliedIndex: number | null;
    onApply: (index: number) => void;
    /** Why solving is not possible for this room, if it is not. */
    blockedReason: string | null;
    /** The applied variant can go to the designer review queue. */
    reviewable?: boolean;
    /** Why a review cannot be sent, e.g. signed out. */
    reviewHint?: string | null;
    reviewStatus?: string;
    onReview?: (review: { verdict: PlannerObservationVerdict; comment: string }) => void;
}) {
    const [open, setOpen] = useState(false);
    const [verdict, setVerdict] = useState<PlannerObservationVerdict>("good");
    const [comment, setComment] = useState("");
    const ids = Object.keys(set).filter((id) => set[id] > 0);
    const addable = FURNITURE_CATALOG.filter(
        (definition) => definition.mounting !== "upper" && !ids.includes(definition.id),
    );
    const setCount = (id: string, count: number) =>
        onSetChange({
            ...set,
            [id]: Math.max(0, Math.min(getMaximumFurnitureCount(id), count)),
        });
    const label = (id: string) => FURNITURE_CATALOG.find((item) => item.id === id)?.label ?? id;

    return (
        <section className={styles.autoLayout} data-draw-room-auto-layout="true">
            <button
                type="button"
                className={styles.autoLayoutToggle}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                Подобрать расстановку
            </button>
            {open && (
                <div className={styles.autoLayoutBody}>
                    {blockedReason ? (
                        <p role="status">{blockedReason}</p>
                    ) : (
                        <>
                            <ul aria-label="Что поставить в комнату">
                                {ids.map((id) => (
                                    <li key={id} data-auto-layout-item={id}>
                                        <span>{label(id)}</span>
                                        <button
                                            type="button"
                                            aria-label={`Меньше: ${label(id)}`}
                                            onClick={() => setCount(id, set[id] - 1)}
                                        >
                                            −
                                        </button>
                                        <b>{set[id]}</b>
                                        <button
                                            type="button"
                                            aria-label={`Больше: ${label(id)}`}
                                            disabled={set[id] >= getMaximumFurnitureCount(id)}
                                            onClick={() => setCount(id, set[id] + 1)}
                                        >
                                            +
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <select
                                aria-label="Добавить предмет в подбор"
                                value=""
                                onChange={(event) => {
                                    if (event.target.value) setCount(event.target.value, 1);
                                }}
                            >
                                <option value="">+ Добавить предмет</option>
                                {addable.map((definition) => (
                                    <option key={definition.id} value={definition.id}>
                                        {definition.label}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className={styles.autoLayoutSolve}
                                disabled={solving || ids.length === 0}
                                onClick={onSolve}
                            >
                                {solving ? "Подбираем…" : "Подобрать"}
                            </button>
                            {variants.length > 0 && (
                                <div className={styles.autoLayoutVariants} aria-label="Варианты">
                                    {variants.map((variant, index) => (
                                        <button
                                            key={index}
                                            type="button"
                                            data-auto-layout-variant={index}
                                            aria-pressed={appliedIndex === index}
                                            onClick={() => onApply(index)}
                                        >
                                            Вариант {index + 1}
                                            <small>
                                                {variant.label} · {variant.count} шт.
                                            </small>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p role="status">{status}</p>
                            {reviewable && (
                                <form
                                    className={styles.autoLayoutReview}
                                    data-auto-layout-review="true"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        // The review API takes one line: no control characters.
                                        const text = comment.replace(/\s+/g, " ").trim();
                                        if (text) onReview?.({ verdict, comment: text });
                                    }}
                                >
                                    <b>Оценить вариант для разбора</b>
                                    {reviewHint ? (
                                        <p>{reviewHint}</p>
                                    ) : (
                                        <>
                                            <select
                                                aria-label="Оценка варианта"
                                                value={verdict}
                                                onChange={(event) =>
                                                    setVerdict(
                                                        event.target
                                                            .value as PlannerObservationVerdict,
                                                    )
                                                }
                                            >
                                                {VERDICTS.map((item) => (
                                                    <option key={item.value} value={item.value}>
                                                        {item.label}
                                                    </option>
                                                ))}
                                            </select>
                                            <textarea
                                                aria-label="Что не так или что удалось"
                                                placeholder="Что не так или что удалось"
                                                maxLength={1200}
                                                value={comment}
                                                onChange={(event) => setComment(event.target.value)}
                                            />
                                            <button type="submit" disabled={!comment.trim()}>
                                                Отправить на разбор
                                            </button>
                                            {reviewStatus && <p>{reviewStatus}</p>}
                                        </>
                                    )}
                                </form>
                            )}
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
