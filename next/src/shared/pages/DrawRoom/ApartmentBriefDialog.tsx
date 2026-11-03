import React, { useEffect, useState } from "react";
import Dialog from "@/shared/components/Dialog";
import {
    BRIEF_LIMITS,
    DEFAULT_APARTMENT_BRIEF,
    type ApartmentBrief,
    type BriefPriority,
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
