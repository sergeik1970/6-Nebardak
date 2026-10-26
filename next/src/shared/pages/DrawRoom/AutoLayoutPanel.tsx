import React, { useState } from "react";
import type { PlannerObservationVerdict } from "@/services/plannerObservationService";
import { FURNITURE_CATALOG } from "@/shared/lib/furniture-planner";
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
 * «Авторасстановка» for the selected room: it takes the pieces already placed
 * there and looks for better spots for them. Applying a variant replaces the
 * room's furniture; undo brings the previous one back.
 */
export default function AutoLayoutPanel({
    set,
    resized = false,
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
    /** The room's pieces by kind, as counted on the plan. */
    set: Record<string, number>;
    /** Some piece has a size of its own; the solver uses catalogue sizes. */
    resized?: boolean;
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
    const [verdict, setVerdict] = useState<PlannerObservationVerdict>("good");
    const [comment, setComment] = useState("");
    const ids = Object.keys(set).filter((id) => set[id] > 0);
    const label = (id: string) => FURNITURE_CATALOG.find((item) => item.id === id)?.label ?? id;

    return (
        <section className={styles.autoLayout} data-draw-room-auto-layout="true">
            {blockedReason ? (
                <p role="status">{blockedReason}</p>
            ) : ids.length === 0 ? (
                <p role="status">
                    Поставьте в комнату мебель из каталога — расстановка подберёт для неё лучшие
                    места.
                </p>
            ) : (
                <>
                    <p>Переставим то, что уже стоит в комнате:</p>
                    <ul aria-label="Что расставим">
                        {ids.map((id) => (
                            <li key={id} data-auto-layout-item={id}>
                                <span>{label(id)}</span>
                                <b>× {set[id]}</b>
                            </li>
                        ))}
                    </ul>
                    {resized && (
                        <p>Предметы с изменёнными размерами встанут в размере из каталога.</p>
                    )}
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
                                                event.target.value as PlannerObservationVerdict,
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
        </section>
    );
}
