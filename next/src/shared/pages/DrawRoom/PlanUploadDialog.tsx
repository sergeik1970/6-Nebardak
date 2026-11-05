import React, { useEffect, useRef, useState } from "react";
import Dialog from "@/shared/components/Dialog";
import { useAuth } from "@/contexts/AuthContext";
import { apartmentFromModel } from "@/shared/lib/plan-recognition/apartment";
import { importPlanRoom, type ImportedPlanRoom } from "@/shared/lib/plan-recognition/to-room";
import { PlanImageError, preparePlanImage } from "@/shared/lib/plan-recognition/prepare-image";
import { readPlan } from "@/services/planRecognitionService";
import { ApiError } from "@/services/apiClient";
import { trackGoal } from "@/shared/lib/analytics";
import type { DrawingProjectScene } from "./project-file";
import { roomToDrawingScene } from "./room-template";
import styles from "./PlanUploadDialog.module.scss";

type Step =
    | { kind: "intro"; error?: string }
    | { kind: "reading" }
    | { kind: "rooms"; rooms: ImportedPlanRoom[]; error?: string };

const plural = (count: number, one: string, few: string, many: string) => {
    const tens = count % 100;
    const units = count % 10;
    return tens >= 11 && tens <= 14
        ? many
        : units === 1
          ? one
          : units >= 2 && units <= 4
            ? few
            : many;
};

const notesFor = (room: ImportedPlanRoom): string[] => [
    ...(room.estimated
        ? ["Часть размеров на плане не подписана — модель измерила их по чертежу. Проверьте стены."]
        : []),
    ...(room.simplified ? ["Скошенные стены или мелкие выступы заменены прямыми углами."] : []),
    ...(room.droppedOpenings
        ? [
              `${room.droppedOpenings} ${plural(room.droppedOpenings, "проём не поставлен", "проёма не поставлены", "проёмов не поставлены")} — добавьте ${room.droppedOpenings === 1 ? "его" : "их"} в редакторе.`,
          ]
        : []),
];

/**
 * "Загрузить план": a photo or scan of a floor plan is read by an AI model,
 * the person picks one room, and it opens in the editor like a drawing file.
 * The rooms stay listed, so another room can be opened without a new upload.
 */
export default function PlanUploadDialog({
    open,
    onClose,
    onOpenRoom,
}: {
    open: boolean;
    onClose: () => void;
    onOpenRoom: (scene: DrawingProjectScene, name: string) => void;
}) {
    const { isAuthenticated } = useAuth();
    const [step, setStep] = useState<Step>({ kind: "intro" });
    const [consent, setConsent] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const reading = useRef<AbortController | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (step.kind !== "reading") return;
        const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
        return () => window.clearInterval(timer);
    }, [step.kind]);
    useEffect(() => () => reading.current?.abort(), []);

    const upload = async (file: File) => {
        reading.current?.abort();
        const controller = new AbortController();
        reading.current = controller;
        setStep({ kind: "reading" });
        setElapsed(0);
        try {
            const image = await preparePlanImage(file);
            const response = await readPlan(image, controller.signal);
            const parsed = apartmentFromModel(response.answer);
            if ("error" in parsed) {
                setStep({
                    kind: "intro",
                    error: "Не удалось разобрать план. Попробуйте более чёткое фото или скан.",
                });
                return;
            }
            const rooms = parsed.rooms.map(importPlanRoom);
            setSelected(rooms.findIndex((room) => room.room !== null));
            setStep({ kind: "rooms", rooms });
            trackGoal("plan_upload_read");
        } catch (error) {
            if (controller.signal.aborted && !(error instanceof ApiError)) {
                setStep({ kind: "intro" });
                return;
            }
            setStep({
                kind: "intro",
                error:
                    error instanceof PlanImageError || error instanceof ApiError
                        ? error.message
                        : "Не удалось распознать план. Попробуйте ещё раз.",
            });
        }
    };

    const openSelected = () => {
        if (step.kind !== "rooms" || selected === null) return;
        const chosen = step.rooms[selected];
        const scene = chosen?.room ? roomToDrawingScene(chosen.room) : null;
        if (!scene) {
            setStep({
                ...step,
                error: "Эту комнату не получилось перенести в редактор. Выберите другую или нарисуйте её вручную.",
            });
            return;
        }
        onOpenRoom(scene, chosen.name);
        trackGoal("plan_upload_room_opened");
        onClose();
    };

    const cancelReading = () => {
        reading.current?.abort();
        setStep({ kind: "intro" });
    };

    const actions =
        step.kind === "reading" ? (
            <button type="button" onClick={cancelReading}>
                Отменить
            </button>
        ) : step.kind === "rooms" ? (
            <>
                <button type="button" onClick={() => setStep({ kind: "intro" })}>
                    Загрузить другой план
                </button>
                <button
                    type="button"
                    data-variant="primary"
                    disabled={selected === null || !step.rooms[selected]?.room}
                    onClick={openSelected}
                >
                    Открыть в редакторе
                </button>
            </>
        ) : (
            <>
                <button type="button" onClick={onClose}>
                    Закрыть
                </button>
                {isAuthenticated && (
                    <button
                        type="button"
                        data-variant="primary"
                        disabled={!consent}
                        onClick={() => fileInput.current?.click()}
                    >
                        Выбрать файл плана
                    </button>
                )}
            </>
        );

    return (
        <Dialog
            open={open}
            title="Загрузить план"
            onCancel={step.kind === "reading" ? undefined : onClose}
            actions={actions}
        >
            <div className={styles.body}>
                {step.kind === "intro" && (
                    <>
                        <p>
                            Загрузите фото или скан плана квартиры: из техпаспорта БТИ, от
                            застройщика или обмерный план. Мы найдём на нём комнаты с размерами,
                            окнами и дверями, а вы выберете, какую открыть в редакторе.
                        </p>
                        {isAuthenticated ? (
                            <>
                                <label className={styles.consent}>
                                    <input
                                        type="checkbox"
                                        checked={consent}
                                        onChange={(event) => setConsent(event.target.checked)}
                                    />
                                    <span>
                                        Я согласен, что изображение плана будет передано для
                                        распознавания сервису искусственного интеллекта, сервер
                                        которого находится за пределами России. Перед загрузкой я
                                        закрыл или обрезал адрес, ФИО и номера документов.
                                        Изображение не сохраняется.
                                    </span>
                                </label>
                                <small>
                                    JPG, PNG или WebP до 25 МБ. Распознавание занимает до двух
                                    минут.
                                </small>
                            </>
                        ) : (
                            <p className={styles.notice}>
                                Войдите в аккаунт, чтобы загрузить план.
                            </p>
                        )}
                        {step.error && (
                            <p role="alert" className={styles.error}>
                                {step.error}
                            </p>
                        )}
                        <input
                            ref={fileInput}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic"
                            aria-label="Файл плана"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void upload(file);
                            }}
                        />
                    </>
                )}
                {step.kind === "reading" && (
                    <p role="status" aria-live="polite">
                        Читаем план… {elapsed} с. Обычно это 20–60 секунд, сложные листы — до двух
                        минут.
                    </p>
                )}
                {step.kind === "rooms" && (
                    <>
                        <p>
                            {step.rooms.length
                                ? "Выберите комнату. Она заменит текущий чертёж — вернуть его можно кнопкой «Отменить». Остальные комнаты останутся в списке: их можно открыть позже без повторной загрузки."
                                : "Комнат на плане не нашлось."}
                        </p>
                        <fieldset className={styles.rooms}>
                            <legend>Комнаты на плане</legend>
                            {step.rooms.map((room, index) => {
                                const notes = notesFor(room);
                                return (
                                    <label
                                        key={`${room.name}-${index}`}
                                        className={styles.room}
                                        data-disabled={!room.room || undefined}
                                    >
                                        <input
                                            type="radio"
                                            name="plan-room"
                                            checked={selected === index}
                                            disabled={!room.room}
                                            onChange={() => setSelected(index)}
                                        />
                                        <span>
                                            <b>{room.name}</b>
                                            {room.area !== null && (
                                                <span className={styles.area}>
                                                    {room.area.toLocaleString("ru-RU")} м²
                                                </span>
                                            )}
                                            {room.problem && (
                                                <small className={styles.problem}>
                                                    {room.problem}
                                                </small>
                                            )}
                                            {notes.map((note) => (
                                                <small key={note} className={styles.note}>
                                                    {note}
                                                </small>
                                            ))}
                                        </span>
                                    </label>
                                );
                            })}
                        </fieldset>
                        {step.error && (
                            <p role="alert" className={styles.error}>
                                {step.error}
                            </p>
                        )}
                    </>
                )}
            </div>
        </Dialog>
    );
}
