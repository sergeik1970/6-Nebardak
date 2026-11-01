import React from "react";
import styles from "./index.module.scss";

export interface ResultRoom {
    signature: string;
    name: string;
    areaSquareMillimeters: number;
    items: ResultItem[];
}

export interface ResultItem {
    id: string;
    label: string;
    width: number;
    depth: number;
    conflict: boolean;
}

const formatArea = (squareMillimeters: number) =>
    `${(squareMillimeters / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} м²`;

/** The «Итог» step: what stands in each room, and the plan as a file or on paper. */
export default function ResultPanel({
    rooms,
    unassigned,
    conflictCount,
    status,
    busy,
    onDownload,
    onPrint,
}: {
    rooms: ResultRoom[];
    /** Pieces outside every room, e.g. left behind by a redrawn wall. */
    unassigned: ResultItem[];
    conflictCount: number;
    status: string;
    busy: boolean;
    onDownload: () => void;
    onPrint: () => void;
}) {
    const total = rooms.reduce((sum, room) => sum + room.items.length, unassigned.length);
    const renderItems = (items: ResultItem[]) => (
        <ul className={styles.resultItems}>
            {items.map((item) => (
                <li
                    key={item.id}
                    data-draw-room-result-item={item.id}
                    data-conflict={item.conflict}
                >
                    <span>{item.label}</span>
                    <small>
                        {Math.round(item.width)} × {Math.round(item.depth)} мм
                    </small>
                </li>
            ))}
        </ul>
    );
    return (
        <aside
            className={styles.roomInspector}
            aria-label="Итог"
            data-draw-room-result="true"
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className={styles.roomInspectorHeading}>
                <b>Итог</b>
                <small>{`Помещений: ${rooms.length} · предметов: ${total}`}</small>
            </div>
            {conflictCount > 0 && (
                <p className={styles.resultWarning} role="alert">
                    {conflictCount === 1
                        ? "Один предмет конфликтует со стенами, проходами или другой мебелью."
                        : `Предметов с конфликтом: ${conflictCount}.`}{" "}
                    Они отмечены красным; в файле плана проверки не будут заявлены.
                </p>
            )}
            {rooms.map((room) => (
                <section
                    key={room.signature}
                    className={styles.resultRoom}
                    data-draw-room-result-room={room.signature}
                >
                    <h3>
                        {room.name}
                        <small>{formatArea(room.areaSquareMillimeters)}</small>
                    </h3>
                    {room.items.length ? (
                        renderItems(room.items)
                    ) : (
                        <p className={styles.resultEmpty}>Мебели пока нет.</p>
                    )}
                </section>
            ))}
            {unassigned.length > 0 && (
                <section className={styles.resultRoom}>
                    <h3>Вне помещений</h3>
                    {renderItems(unassigned)}
                </section>
            )}
            <div className={styles.resultActions}>
                <button
                    type="button"
                    data-draw-room-result-download="true"
                    disabled={busy}
                    onClick={onDownload}
                >
                    Скачать чертежи (PDF)
                </button>
                <button
                    type="button"
                    data-draw-room-result-print="true"
                    disabled={busy}
                    onClick={onPrint}
                >
                    Печать
                </button>
            </div>
            <p className={styles.resultStatus} role="status">
                {status}
            </p>
        </aside>
    );
}
