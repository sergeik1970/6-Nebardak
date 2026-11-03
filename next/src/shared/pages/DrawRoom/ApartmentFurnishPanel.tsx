import React from "react";
import type { RoomOutcome } from "./furnish-apartment";
import styles from "./furniture.module.scss";

const STATUS_LABEL: Record<RoomOutcome["status"], string> = {
    furnished: "Готово",
    partial: "Частично",
    skipped: "Пропущена",
};

/**
 * «Обставить квартиру»: one action for every room. Pinned pieces stay; the
 * person chooses whether rooms with furniture are left alone. The whole result
 * is one step, so «Отменить» takes it all back.
 */
export default function ApartmentFurnishPanel({
    running,
    progress,
    keepFurnishedRooms,
    onKeepFurnishedRoomsChange,
    onRun,
    onCancel,
    outcomes,
    status,
    briefSummary,
    onEditBrief,
}: {
    running: boolean;
    progress: { done: number; total: number; roomName: string } | null;
    keepFurnishedRooms: boolean;
    onKeepFurnishedRoomsChange: (keep: boolean) => void;
    onRun: () => void;
    onCancel: () => void;
    outcomes: RoomOutcome[];
    status: string;
    /** Who the furniture is chosen for, from the family's answers. */
    briefSummary: string;
    onEditBrief: () => void;
}) {
    return (
        <section className={styles.apartmentFurnish} data-apartment-furnish="true">
            <b>Вся квартира</b>
            <p>
                Подберём мебель для каждой жилой комнаты и расставим её. Закреплённые предметы
                останутся на месте.
            </p>
            <p className={styles.apartmentFurnishBrief} data-apartment-brief-summary>
                <span>{briefSummary}</span>
                <button type="button" disabled={running} onClick={onEditBrief}>
                    Изменить
                </button>
            </p>
            <label className={styles.apartmentFurnishOption}>
                <input
                    type="checkbox"
                    checked={keepFurnishedRooms}
                    disabled={running}
                    onChange={(event) => onKeepFurnishedRoomsChange(event.target.checked)}
                />
                Не трогать комнаты, где уже есть мебель
            </label>
            {running ? (
                <div className={styles.apartmentFurnishProgress}>
                    <progress
                        max={progress?.total || 1}
                        value={progress?.done ?? 0}
                        aria-label="Ход расстановки"
                    />
                    <span role="status">
                        {progress && progress.roomName
                            ? `Обставляем: ${progress.roomName} (${progress.done + 1} из ${progress.total})`
                            : "Обставляем…"}
                    </span>
                    <button type="button" onClick={onCancel}>
                        Прервать
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className={styles.autoLayoutSolve}
                    data-apartment-furnish-run
                    onClick={onRun}
                >
                    Обставить квартиру
                </button>
            )}
            {status && !running && <p role="status">{status}</p>}
            {outcomes.length > 0 && !running && (
                <ul aria-label="Итог по комнатам" className={styles.apartmentFurnishOutcomes}>
                    {outcomes.map((outcome) => (
                        <li key={outcome.signature} data-apartment-furnish-outcome={outcome.status}>
                            <span>
                                <b>{outcome.name}</b> · {STATUS_LABEL[outcome.status]}
                            </span>
                            <small>{outcome.message}</small>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
