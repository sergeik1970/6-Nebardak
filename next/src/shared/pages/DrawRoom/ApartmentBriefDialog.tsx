import React, { useEffect, useState } from "react";
import Dialog from "@/shared/components/Dialog";
import {
    BRIEF_LIMITS,
    STORAGE_LIMITS,
    DEFAULT_APARTMENT_BRIEF,
    type ApartmentBrief,
    type BriefPriority,
    type StorageBrief,
} from "@/shared/lib/furniture-planner";
import styles from "./ApartmentBriefDialog.module.scss";

const PRIORITY_LABEL: Record<BriefPriority, string> = {
    bed: "Больше спальное место",
    storage: "Больше мест хранения",
    living: "Больше диванная зона",
    work: "Больше рабочая зона",
    tv: "Больше экран, ТВ-зона",
    dressing: "Больше туалетный столик",
};
const PRIORITY_ORDER: BriefPriority[] = ["bed", "storage", "living", "work", "tv", "dressing"];

const plural = (count: number, one: string, few: string, many: string) => {
    const tens = count % 100;
    const units = count % 10;
    return `${count} ${tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many}`;
};

/** One line for the panel: who the furniture is chosen for. */
export const describeApartmentBrief = (brief?: ApartmentBrief): string => {
    if (!brief) return "Анкета не заполнена: подберём мебель для двух взрослых.";
    const answers = { ...DEFAULT_APARTMENT_BRIEF, ...brief };
    const children = answers.children + answers.babies;
    return [
        plural(answers.adults, "взрослый", "взрослых", "взрослых"),
        ...(children ? [plural(children, "ребёнок", "ребёнка", "детей")] : []),
        answers.tv === "none" ? "без ТВ" : answers.tv === "large" ? "большой ТВ" : "ТВ до 50″",
        ...(answers.desks ? [plural(answers.desks, "стол", "стола", "столов")] : []),
        ...(brief.storage ? ["шкафы по вещам"] : []),
    ].join(", ");
};

const NumberField = ({
    label,
    hint,
    value,
    maximum,
    onChange,
}: {
    label: string;
    hint?: string;
    value: number;
    maximum: number;
    onChange: (value: number) => void;
}) => (
    <label className={styles.number}>
        <span>
            {label}
            {hint && <small>{hint}</small>}
        </span>
        <input
            type="number"
            inputMode="numeric"
            min={0}
            max={maximum}
            value={value}
            onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next))
                    onChange(Math.min(maximum, Math.max(0, Math.round(next))));
            }}
        />
    </label>
);

/**
 * «Расскажите о семье»: blocks 1, 2 and 4 of the designer's questionnaire.
 * Every answer has a default, so the person may change only what matters to
 * them; the ranking is kept only if they actually moved something.
 */
export default function ApartmentBriefDialog({
    open,
    initial,
    onSubmit,
    onCancel,
}: {
    open: boolean;
    initial?: ApartmentBrief;
    onSubmit: (brief: ApartmentBrief) => void;
    onCancel: () => void;
}) {
    const [brief, setBrief] = useState({ ...DEFAULT_APARTMENT_BRIEF, ...initial });
    const [ranking, setRanking] = useState<BriefPriority[]>(
        initial?.priorities?.length
            ? [
                  ...initial.priorities,
                  ...PRIORITY_ORDER.filter((item) => !initial.priorities!.includes(item)),
              ]
            : PRIORITY_ORDER,
    );
    const [ranked, setRanked] = useState(Boolean(initial?.priorities?.length));
    // Each opening starts from what was saved last.
    useEffect(() => {
        if (!open) return;
        setBrief({ ...DEFAULT_APARTMENT_BRIEF, ...initial });
        setRanking(
            initial?.priorities?.length
                ? [
                      ...initial.priorities,
                      ...PRIORITY_ORDER.filter((item) => !initial.priorities!.includes(item)),
                  ]
                : PRIORITY_ORDER,
        );
        setRanked(Boolean(initial?.priorities?.length));
    }, [open, initial]);

    const set = <Key extends keyof ApartmentBrief>(key: Key, value: ApartmentBrief[Key]) =>
        setBrief((current) => ({ ...current, [key]: value }));
    const move = (index: number, by: -1 | 1) => {
        const target = index + by;
        if (target < 0 || target >= ranking.length) return;
        const next = [...ranking];
        [next[index], next[target]] = [next[target], next[index]];
        setRanking(next);
        setRanked(true);
    };
    const setStorage = <Key extends keyof StorageBrief>(key: Key, value: StorageBrief[Key]) =>
        setBrief((current) => ({ ...current, storage: { ...current.storage, [key]: value } }));
    const storage = brief.storage;
    const submit = () => {
        const { priorities: _priorities, ...answers } = brief;
        onSubmit({ ...answers, version: 1, ...(ranked ? { priorities: ranking } : {}) });
    };

    return (
        <Dialog
            open={open}
            title="Расскажите о семье"
            onCancel={onCancel}
            actions={
                <>
                    <button data-variant="primary" form="apartment-brief" type="submit">
                        Сохранить и обставить
                    </button>
                    <button type="button" onClick={() => onSubmit({ version: 1 })}>
                        Обычная семья — подберите сами
                    </button>
                    <button type="button" onClick={onCancel}>
                        Отмена
                    </button>
                </>
            }
        >
            {open ? (
                <form
                    id="apartment-brief"
                    className={styles.form}
                    data-apartment-brief="true"
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <p>
                        По ответам подберём кровати, столы и диван для каждой комнаты. Всё можно
                        оставить как есть.
                    </p>
                    <fieldset>
                        <legend>Сон и отдых</legend>
                        <NumberField
                            label="Взрослых спит постоянно"
                            hint="Двое — одна двуспальная кровать"
                            value={brief.adults}
                            maximum={BRIEF_LIMITS.adults}
                            onChange={(value) => set("adults", value)}
                        />
                        <NumberField
                            label="Детей до 3 лет"
                            hint="Детская кроватка"
                            value={brief.babies}
                            maximum={BRIEF_LIMITS.babies}
                            onChange={(value) => set("babies", value)}
                        />
                        <NumberField
                            label="Детей от 3 лет"
                            hint="Односпальная или полуторная кровать"
                            value={brief.children}
                            maximum={BRIEF_LIMITS.children}
                            onChange={(value) => set("children", value)}
                        />
                        <label className={styles.choice}>
                            <span>Диван</span>
                            <select
                                value={brief.sofaSeats ?? ""}
                                onChange={(event) =>
                                    set(
                                        "sofaSeats",
                                        event.target.value
                                            ? (Number(event.target.value) as 2 | 3 | 4)
                                            : undefined,
                                    )
                                }
                            >
                                <option value="">По размеру комнаты</option>
                                <option value="2">На 2 человек</option>
                                <option value="3">На 3 человек</option>
                                <option value="4">На 4 и больше</option>
                            </select>
                        </label>
                        <NumberField
                            label="Кресел"
                            value={brief.armchairs ?? 0}
                            maximum={BRIEF_LIMITS.armchairs}
                            onChange={(value) => set("armchairs", value)}
                        />
                        <label className={styles.choice}>
                            <span>Прикроватные тумбы</span>
                            <select
                                value={brief.bedsideTables}
                                onChange={(event) =>
                                    set(
                                        "bedsideTables",
                                        event.target.value as ApartmentBrief["bedsideTables"],
                                    )
                                }
                            >
                                <option value="per-sleeper">По числу спальных мест</option>
                                <option value="two">Две у кровати</option>
                                <option value="one">Одна</option>
                                <option value="none">Не нужны</option>
                            </select>
                        </label>
                    </fieldset>
                    <fieldset>
                        <legend>Работа и экраны</legend>
                        <label className={styles.choice}>
                            <span>Телевизор в гостиной</span>
                            <select
                                value={brief.tv}
                                onChange={(event) =>
                                    set("tv", event.target.value as ApartmentBrief["tv"])
                                }
                            >
                                <option value="compact">Компактный, до 50″</option>
                                <option value="large">Большой, от 65″</option>
                                <option value="none">Не нужен</option>
                            </select>
                        </label>
                        <NumberField
                            label="Письменных столов"
                            hint="Для работы или учёбы"
                            value={brief.desks}
                            maximum={BRIEF_LIMITS.desks}
                            onChange={(value) => set("desks", value)}
                        />
                        <label className={styles.check}>
                            <input
                                type="checkbox"
                                checked={brief.dressingTable}
                                onChange={(event) => set("dressingTable", event.target.checked)}
                            />
                            Туалетный столик с зеркалом
                        </label>
                    </fieldset>
                    <fieldset>
                        <legend>Хранение</legend>
                        <label className={styles.check}>
                            <input
                                type="checkbox"
                                checked={Boolean(storage)}
                                onChange={(event) =>
                                    set("storage", event.target.checked ? {} : undefined)
                                }
                            />
                            Посчитать шкафы по вещам
                        </label>
                        {storage ? (
                            <>
                                <p className={styles.hint}>
                                    Верхняя одежда, обувь и крупные вещи — в прихожую, остальное — в
                                    шкафы спален. Высота шкафа 2200 мм.
                                </p>
                                <label className={styles.choice}>
                                    <span>
                                        Верхняя одежда, вешалок
                                        <small>Пальто, куртки, пиджаки: 1 вешалка ≈ 12 см</small>
                                    </span>
                                    <select
                                        value={storage.longHangers ?? "10-20"}
                                        onChange={(event) =>
                                            setStorage(
                                                "longHangers",
                                                event.target.value as StorageBrief["longHangers"],
                                            )
                                        }
                                    >
                                        <option value="up-to-10">До 10</option>
                                        <option value="10-20">10–20</option>
                                        <option value="20-40">20–40</option>
                                        <option value="40+">Больше 40</option>
                                        <option value="none">Не храним</option>
                                    </select>
                                </label>
                                <NumberField
                                    label="Обычная одежда, вешалок"
                                    hint="Рубашки, платья, брюки: 1 вешалка ≈ 4 см"
                                    value={storage.shortHangers ?? 30}
                                    maximum={STORAGE_LIMITS.shortHangers}
                                    onChange={(value) => setStorage("shortHangers", value)}
                                />
                                <label className={styles.choice}>
                                    <span>
                                        Полки для одежды
                                        <small>Блоки шириной 40 см на всю высоту</small>
                                    </span>
                                    <select
                                        value={storage.shelfBlocks ?? 1}
                                        onChange={(event) =>
                                            setStorage("shelfBlocks", Number(event.target.value))
                                        }
                                    >
                                        <option value={0}>Не нужны</option>
                                        <option value={1}>6 полок</option>
                                        <option value={2}>12 полок</option>
                                        <option value={3}>18 полок</option>
                                        <option value={4}>24 полки</option>
                                    </select>
                                </label>
                                <label className={styles.choice}>
                                    <span>
                                        Обувь, пар
                                        <small>20 пар — секция шкафа шириной 1 м</small>
                                    </span>
                                    <select
                                        value={storage.shoePairs ?? "10-20"}
                                        onChange={(event) =>
                                            setStorage(
                                                "shoePairs",
                                                event.target.value as StorageBrief["shoePairs"],
                                            )
                                        }
                                    >
                                        <option value="up-to-10">До 10</option>
                                        <option value="10-20">10–20</option>
                                        <option value="20-30">20–30</option>
                                        <option value="30+">Больше 30</option>
                                    </select>
                                </label>
                                <label className={styles.choice}>
                                    <span>
                                        Крупные вещи
                                        <small>
                                            Чемодан, лыжи, коляска, пылесос, гладильная доска
                                        </small>
                                    </span>
                                    <select
                                        value={storage.bulkyItems ?? "0-2"}
                                        onChange={(event) =>
                                            setStorage(
                                                "bulkyItems",
                                                event.target.value as StorageBrief["bulkyItems"],
                                            )
                                        }
                                    >
                                        <option value="0-2">0–2</option>
                                        <option value="3-5">3–5</option>
                                        <option value="6+">6 и больше</option>
                                    </select>
                                </label>
                                <label className={styles.choice}>
                                    <span>
                                        Книги и документы, метров полок
                                        <small>1 м полки ≈ 30 книг</small>
                                    </span>
                                    <select
                                        value={storage.bookMeters ?? "1-3"}
                                        onChange={(event) =>
                                            setStorage(
                                                "bookMeters",
                                                event.target.value as StorageBrief["bookMeters"],
                                            )
                                        }
                                    >
                                        <option value="up-to-1">До 1 м, до 30 книг</option>
                                        <option value="1-3">1–3 м, до 90 книг</option>
                                        <option value="3-5">3–5 м, до 150 книг</option>
                                        <option value="5+">Больше 5 м</option>
                                    </select>
                                </label>
                            </>
                        ) : null}
                    </fieldset>
                    <fieldset>
                        <legend>Что важнее, если места не хватит</legend>
                        <p className={styles.hint}>
                            Сверху — самое важное. То, что ниже, уступит первым.
                        </p>
                        <ol className={styles.ranking} aria-label="Порядок важности">
                            {ranking.map((item, index) => (
                                <li key={item} data-brief-priority={item}>
                                    <span>{PRIORITY_LABEL[item]}</span>
                                    <button
                                        type="button"
                                        aria-label={`Выше: ${PRIORITY_LABEL[item]}`}
                                        disabled={index === 0}
                                        onClick={() => move(index, -1)}
                                    >
                                        ↑
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Ниже: ${PRIORITY_LABEL[item]}`}
                                        disabled={index === ranking.length - 1}
                                        onClick={() => move(index, 1)}
                                    >
                                        ↓
                                    </button>
                                </li>
                            ))}
                        </ol>
                    </fieldset>
                </form>
            ) : null}
        </Dialog>
    );
}
