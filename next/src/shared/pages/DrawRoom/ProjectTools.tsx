import React, { useEffect, useRef, useState } from "react";
import {
    parseDrawingProject,
    serializeDrawingProject,
    type DrawingProjectScene,
} from "./project-file";
import { trackGoal } from "@/shared/lib/analytics";
import styles from "./project-tools.module.scss";

export type DrawingLayers = {
    dimensions: boolean;
    rooms: boolean;
    furniture: boolean;
    grid: boolean;
};
export const DEFAULT_DRAWING_LAYERS: DrawingLayers = {
    dimensions: true,
    rooms: true,
    furniture: true,
    grid: true,
};
export default function ProjectTools({
    scene,
    onLoad,
    status,
    layers,
    onLayers,
    measuring,
    onMeasure,
    steps,
}: {
    measuring: boolean;
    onMeasure: () => void;
    scene: DrawingProjectScene;
    onLoad: (scene: DrawingProjectScene) => void;
    status: "loading" | "saved" | "error";
    layers: DrawingLayers;
    onLayers: (layers: DrawingLayers) => void;
    /** The drawing's step tabs share this row so the canvas keeps its height. */
    steps?: React.ReactNode;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const toolbar = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent | KeyboardEvent) => {
            if (
                event instanceof KeyboardEvent
                    ? event.key !== "Escape"
                    : toolbar.current?.contains(event.target as Node)
            )
                return;
            toolbar.current
                ?.querySelectorAll("details[open]")
                .forEach((menu) => menu.removeAttribute("open"));
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", close);
        };
    }, []);

    const [message, setMessage] = useState("");
    const [incoming, setIncoming] = useState<{ scene: DrawingProjectScene; name: string } | null>(
        null,
    );
    const exportFile = () => {
        const url = URL.createObjectURL(
            new Blob([serializeDrawingProject(scene)], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `чертёж-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Файл чертежа подготовлен для скачивания.");
        trackGoal("drawing_file_save");
    };
    return (
        <div className={styles.bar} ref={toolbar}>
            <details
                className={styles.menu}
                onToggle={(event) => {
                    if (event.currentTarget.open)
                        toolbar.current?.querySelectorAll("details").forEach((menu) => {
                            if (menu !== event.currentTarget) menu.removeAttribute("open");
                        });
                }}
            >
                <summary>Проект</summary>
                <div className={styles.popup}>
                    <button type="button" onClick={exportFile}>
                        Скачать чертёж
                    </button>
                    <button type="button" onClick={() => fileInput.current?.click()}>
                        Открыть файл чертежа
                    </button>
                    <small>Файл содержит стены, проёмы, мебель и названия помещений.</small>
                    {message && <p role="status">{message}</p>}
                    {incoming && (
                        <section aria-label="Открытие чертежа">
                            <b>{incoming.name}</b>
                            <p>
                                Заменить текущий чертёж? После открытия можно вернуть его кнопкой
                                «Отменить».
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    onLoad(incoming.scene);
                                    setIncoming(null);
                                    setMessage(
                                        "Чертёж открыт. Предыдущий доступен через отмену действия.",
                                    );
                                }}
                            >
                                Открыть чертёж
                            </button>
                            <button type="button" onClick={() => setIncoming(null)}>
                                Отмена
                            </button>
                        </section>
                    )}
                </div>
            </details>
            <details
                className={styles.menu}
                onToggle={(event) => {
                    if (event.currentTarget.open)
                        toolbar.current?.querySelectorAll("details").forEach((menu) => {
                            if (menu !== event.currentTarget) menu.removeAttribute("open");
                        });
                }}
            >
                <summary>Вид</summary>
                <div className={styles.popup}>
                    {(
                        Object.entries({
                            dimensions: "Размеры",
                            rooms: "Подписи помещений",
                            furniture: "Мебель",
                            grid: "Сетка",
                        }) as [keyof DrawingLayers, string][]
                    ).map(([key, label]) => (
                        <label key={key}>
                            <input
                                type="checkbox"
                                checked={layers[key]}
                                onChange={(event) =>
                                    onLayers({ ...layers, [key]: event.target.checked })
                                }
                            />
                            {label}
                        </label>
                    ))}
                    <small>
                        Скрытие объектов не удаляет их и не отключает проверку пересечений.
                    </small>
                </div>
            </details>
            <button
                type="button"
                className={styles.measureButton}
                aria-pressed={measuring}
                onClick={onMeasure}
            >
                Линейка
            </button>
            {steps}
            <span role="status" className={styles.status} data-drawing-save-status={status}>
                {status === "saved"
                    ? "Сохранено в этом браузере"
                    : status === "error"
                      ? "Не удалось сохранить — скачайте чертёж"
                      : "Загрузка чертежа…"}
            </span>
            <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                aria-label="Файл чертежа"
                hidden
                onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    setIncoming(null);
                    setMessage("");
                    if (!file) return;
                    try {
                        if (file.size > 5 * 1024 * 1024)
                            throw new Error("Файл слишком большой. Максимум — 5 МБ.");
                        setIncoming({
                            scene: parseDrawingProject(await file.text()),
                            name: file.name,
                        });
                    } catch (error) {
                        setMessage(
                            error instanceof Error ? error.message : "Не удалось открыть файл.",
                        );
                    }
                }}
            />
        </div>
    );
}
