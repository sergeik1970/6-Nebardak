import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import {
    FURNITURE_CATALOG,
    FurnitureDefinition,
    getFurniture,
    getFurnitureAsset,
    saveQuestionnairePlannerHandoff,
} from "@/shared/lib/furniture-planner";
import styles from "./index.module.scss";

type BedChoice = "none" | "single-bed" | "double-bed";
type SofaChoice = "none" | "sofa-two" | "sofa-three" | "sofa-four-left";
type WardrobeChoice = "none" | "wardrobe-small" | "wardrobe-medium" | "wardrobe-large";

interface QuestionnaireAnswers {
    bed: BedChoice;
    sofa: SofaChoice;
    wardrobe: WardrobeChoice;
    cradle: boolean;
    bedsideTableCount: 0 | 1 | 2;
    coffeeTable: boolean;
    tv: boolean;
    tvTargetCategory?: "sleep" | "living";
    desk: boolean;
    bookcase: boolean;
    dresser: boolean;
}

interface SelectedFurniture {
    definition: FurnitureDefinition;
    count: number;
    required: boolean;
}

const INITIAL_ANSWERS: QuestionnaireAnswers = {
    bed: "none",
    sofa: "none",
    wardrobe: "none",
    cradle: false,
    bedsideTableCount: 0,
    coffeeTable: false,
    tv: false,
    desk: false,
    bookcase: false,
    dresser: false,
};

const BED_OPTIONS: Array<{ value: BedChoice; label: string }> = [
    { value: "none", label: "Без кровати" },
    { value: "single-bed", label: "Односпальная" },
    { value: "double-bed", label: "Двуспальная" },
];

const SOFA_OPTIONS: Array<{ value: SofaChoice; label: string }> = [
    { value: "none", label: "Без дивана" },
    { value: "sofa-two", label: "На двоих" },
    { value: "sofa-three", label: "На троих" },
    { value: "sofa-four-left", label: "Угловой, левый" },
];

const WARDROBE_OPTIONS: Array<{ value: WardrobeChoice; label: string }> = [
    { value: "none", label: "Без шкафа" },
    { value: "wardrobe-small", label: "Малый · 700 мм" },
    { value: "wardrobe-medium", label: "Средний · 1500 мм" },
    { value: "wardrobe-large", label: "Большой · 2000 мм" },
];

const getQueryString = (value: string | string[] | undefined, maximumLength: number) => {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maximumLength) : undefined;
};

const pluralizeFurniture = (count: number) => {
    const modulo100 = count % 100;
    const modulo10 = count % 10;
    if (modulo100 >= 11 && modulo100 <= 19) return `${count} предметов`;
    if (modulo10 === 1) return `${count} предмет`;
    if (modulo10 >= 2 && modulo10 <= 4) return `${count} предмета`;
    return `${count} предметов`;
};

const RadioChoice = <T extends string>({
    id,
    name,
    value,
    checked,
    label,
    onChange,
}: {
    id: string;
    name: string;
    value: T;
    checked: boolean;
    label: string;
    onChange: (value: T) => void;
}) => (
    <label className={styles.radioChoice} htmlFor={id}>
        <input
            id={id}
            type="radio"
            name={name}
            value={value}
            checked={checked}
            onChange={() => onChange(value)}
        />
        <span aria-hidden="true" />
        <strong>{label}</strong>
    </label>
);

const Questionnaire: React.FC = () => {
    const router = useRouter();
    const [answers, setAnswers] = useState<QuestionnaireAnswers>(INITIAL_ANSWERS);
    const [submitError, setSubmitError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const styleKey = router.isReady ? getQueryString(router.query.style, 80) : undefined;
    const styleLabel = router.isReady ? getQueryString(router.query.styleLabel, 120) : undefined;
    const hasBed = answers.bed !== "none";
    const hasSofa = answers.sofa !== "none";
    const tvTargetRequired = answers.tv && hasBed && hasSofa;

    const selectedFurniture = useMemo<SelectedFurniture[]>(() => {
        const selection = new Map<string, { count: number; required: boolean }>();

        if (hasBed) selection.set(answers.bed, { count: 1, required: true });
        if (hasSofa) selection.set(answers.sofa, { count: 1, required: !hasBed });
        if (answers.wardrobe !== "none") {
            selection.set(answers.wardrobe, { count: 1, required: false });
        }
        if (answers.cradle && answers.bed === "double-bed") {
            selection.set("cradle", { count: 1, required: true });
        }
        if (answers.bedsideTableCount > 0 && hasBed) {
            selection.set("bedside-table", {
                count: answers.bedsideTableCount,
                required: false,
            });
        }
        if (answers.coffeeTable && hasSofa) {
            selection.set("coffee-table", { count: 1, required: false });
        }
        if (answers.tv && (hasBed || hasSofa)) {
            selection.set("tv", { count: 1, required: false });
        }
        if (answers.desk) selection.set("desk", { count: 1, required: false });
        if (answers.bookcase) selection.set("bookcase", { count: 1, required: false });
        if (answers.dresser) selection.set("dresser", { count: 1, required: false });

        return FURNITURE_CATALOG.flatMap((definition) => {
            const selected = selection.get(definition.id);
            return selected ? [{ definition, ...selected }] : [];
        });
    }, [answers, hasBed, hasSofa]);

    const totalCount = selectedFurniture.reduce((sum, item) => sum + item.count, 0);
    const disabledReason =
        totalCount === 0
            ? "Выберите хотя бы один предмет мебели."
            : tvTargetRequired && !answers.tvTargetCategory
              ? "Укажите, напротив чего поставить телевизор."
              : "";

    const updateBed = useCallback((bed: BedChoice) => {
        setSubmitError("");
        setAnswers((current) => {
            const hasNextBed = bed !== "none";
            const hasNextSofa = current.sofa !== "none";
            return {
                ...current,
                bed,
                cradle: bed === "double-bed" ? current.cradle : false,
                bedsideTableCount: hasNextBed ? current.bedsideTableCount : 0,
                tv: hasNextBed || hasNextSofa ? current.tv : false,
                tvTargetCategory: hasNextBed && hasNextSofa ? current.tvTargetCategory : undefined,
            };
        });
    }, []);

    const updateSofa = useCallback((sofa: SofaChoice) => {
        setSubmitError("");
        setAnswers((current) => {
            const hasNextSofa = sofa !== "none";
            const hasNextBed = current.bed !== "none";
            return {
                ...current,
                sofa,
                coffeeTable: hasNextSofa ? current.coffeeTable : false,
                tv: hasNextSofa || hasNextBed ? current.tv : false,
                tvTargetCategory: hasNextBed && hasNextSofa ? current.tvTargetCategory : undefined,
            };
        });
    }, []);

    const toggleTv = useCallback((checked: boolean) => {
        setSubmitError("");
        setAnswers((current) => ({
            ...current,
            tv: checked,
            tvTargetCategory: checked ? current.tvTargetCategory : undefined,
        }));
    }, []);

    const submit = useCallback(async () => {
        if (disabledReason || isSubmitting) return;

        setSubmitError("");
        setIsSubmitting(true);

        const result = saveQuestionnairePlannerHandoff({
            version: 1,
            source: "questionnaire",
            createdAt: Date.now(),
            items: selectedFurniture.map(({ definition, count, required }) => ({
                definitionId: definition.id,
                count,
                required,
            })),
            preferences: answers.tv
                ? {
                      tvTargetCategory: answers.tvTargetCategory ?? (hasBed ? "sleep" : "living"),
                  }
                : undefined,
            meta: styleKey || styleLabel ? { styleKey, styleLabel } : undefined,
        });

        if (result.status !== "success") {
            setSubmitError(
                result.status === "unavailable"
                    ? "Браузер не разрешил сохранить комплект. Проверьте настройки хранения и попробуйте ещё раз."
                    : "Не удалось подготовить комплект. Проверьте ответы и попробуйте ещё раз.",
            );
            setIsSubmitting(false);
            return;
        }

        try {
            const navigated = await router.push({
                pathname: "/planner",
                query: { handoff: result.id },
            });
            if (!navigated) {
                setSubmitError("Не удалось открыть планировщик. Попробуйте ещё раз.");
                setIsSubmitting(false);
            }
        } catch {
            setSubmitError("Не удалось открыть планировщик. Попробуйте ещё раз.");
            setIsSubmitting(false);
        }
    }, [
        answers.tv,
        answers.tvTargetCategory,
        disabledReason,
        hasBed,
        isSubmitting,
        router,
        selectedFurniture,
        styleKey,
        styleLabel,
    ]);

    return (
        <div className={styles.page}>
            <Navigation />
            <main className={styles.main}>
                <nav className={styles.progressRail} aria-label="Этапы создания комнаты">
                    <Link href="/test" data-state={styleLabel ? "done" : "available"}>
                        <span>{styleLabel ? "✓" : "1"}</span>
                        <span>
                            <strong>Стиль</strong>
                            <small>{styleLabel ?? "можно пройти отдельно"}</small>
                        </span>
                    </Link>
                    <span className={styles.activeStep} aria-current="step">
                        <span>2</span>
                        <span>
                            <strong>Потребности</strong>
                            <small>собираем комплект</small>
                        </span>
                    </span>
                    <span>
                        <span>3</span>
                        <span>
                            <strong>Планировка</strong>
                            <small>проверка размеров</small>
                        </span>
                    </span>
                </nav>

                <header className={styles.header}>
                    <span className={styles.eyebrow}>Спецификация комнаты · шаг 2 из 3</span>
                    <h1>Что должно быть в комнате?</h1>
                    <p>
                        Выберите нужные функции — мы соберём поштучный комплект. Интерьерный стиль
                        сохранится как заметка и не будет подменять ваши потребности.
                    </p>
                </header>

                <div className={styles.layout}>
                    <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
                        <fieldset className={styles.section}>
                            <legend>
                                <span>01</span>
                                <span>
                                    <strong>Спальное место</strong>
                                    <small>Выберите один вариант</small>
                                </span>
                            </legend>
                            <div className={styles.choiceGrid}>
                                {BED_OPTIONS.map((option) => (
                                    <RadioChoice
                                        key={option.value}
                                        id={`bed-${option.value}`}
                                        name="bed"
                                        value={option.value}
                                        checked={answers.bed === option.value}
                                        label={option.label}
                                        onChange={updateBed}
                                    />
                                ))}
                            </div>
                        </fieldset>

                        <fieldset className={styles.section}>
                            <legend>
                                <span>02</span>
                                <span>
                                    <strong>Диван</strong>
                                    <small>Для отдыха или гостевой зоны</small>
                                </span>
                            </legend>
                            <div className={`${styles.choiceGrid} ${styles.fourChoices}`}>
                                {SOFA_OPTIONS.map((option) => (
                                    <RadioChoice
                                        key={option.value}
                                        id={`sofa-${option.value}`}
                                        name="sofa"
                                        value={option.value}
                                        checked={answers.sofa === option.value}
                                        label={option.label}
                                        onChange={updateSofa}
                                    />
                                ))}
                            </div>
                        </fieldset>

                        <fieldset className={styles.section}>
                            <legend>
                                <span>03</span>
                                <span>
                                    <strong>Хранение одежды</strong>
                                    <small>Один шкаф подходящего размера</small>
                                </span>
                            </legend>
                            <div className={`${styles.choiceGrid} ${styles.fourChoices}`}>
                                {WARDROBE_OPTIONS.map((option) => (
                                    <RadioChoice
                                        key={option.value}
                                        id={`wardrobe-${option.value}`}
                                        name="wardrobe"
                                        value={option.value}
                                        checked={answers.wardrobe === option.value}
                                        label={option.label}
                                        onChange={(wardrobe) => {
                                            setSubmitError("");
                                            setAnswers((current) => ({ ...current, wardrobe }));
                                        }}
                                    />
                                ))}
                            </div>
                        </fieldset>

                        <fieldset className={`${styles.section} ${styles.additionalSection}`}>
                            <legend>
                                <span>04</span>
                                <span>
                                    <strong>Дополнительно</strong>
                                    <small>Можно выбрать несколько пунктов</small>
                                </span>
                            </legend>

                            <div className={styles.additionalGrid}>
                                {answers.bed === "double-bed" && (
                                    <label className={styles.checkChoice}>
                                        <input
                                            type="checkbox"
                                            checked={answers.cradle}
                                            onChange={(event) =>
                                                setAnswers((current) => ({
                                                    ...current,
                                                    cradle: event.target.checked,
                                                }))
                                            }
                                        />
                                        <span aria-hidden="true" />
                                        <span>
                                            <strong>Детская люлька</strong>
                                            <small>Рядом с двуспальной кроватью</small>
                                        </span>
                                    </label>
                                )}

                                {hasBed && (
                                    <div className={styles.countChoice}>
                                        <span>
                                            <strong>Прикроватные тумбы</strong>
                                            <small>С одной или двух сторон кровати</small>
                                        </span>
                                        <span className={styles.countButtons}>
                                            {[0, 1, 2].map((count) => (
                                                <button
                                                    key={count}
                                                    type="button"
                                                    aria-pressed={
                                                        answers.bedsideTableCount === count
                                                    }
                                                    onClick={() =>
                                                        setAnswers((current) => ({
                                                            ...current,
                                                            bedsideTableCount: count as 0 | 1 | 2,
                                                        }))
                                                    }
                                                >
                                                    {count}
                                                </button>
                                            ))}
                                        </span>
                                    </div>
                                )}

                                {hasSofa && (
                                    <label className={styles.checkChoice}>
                                        <input
                                            type="checkbox"
                                            checked={answers.coffeeTable}
                                            onChange={(event) =>
                                                setAnswers((current) => ({
                                                    ...current,
                                                    coffeeTable: event.target.checked,
                                                }))
                                            }
                                        />
                                        <span aria-hidden="true" />
                                        <span>
                                            <strong>Кофейный столик</strong>
                                            <small>Перед выбранным диваном</small>
                                        </span>
                                    </label>
                                )}

                                {(hasBed || hasSofa) && (
                                    <label className={styles.checkChoice}>
                                        <input
                                            type="checkbox"
                                            checked={answers.tv}
                                            onChange={(event) => toggleTv(event.target.checked)}
                                        />
                                        <span aria-hidden="true" />
                                        <span>
                                            <strong>Телевизор</strong>
                                            <small>На стене напротив зоны просмотра</small>
                                        </span>
                                    </label>
                                )}

                                {["desk", "bookcase", "dresser"].map((definitionId) => {
                                    const definition = getFurniture(definitionId);
                                    const checked =
                                        answers[definitionId as "desk" | "bookcase" | "dresser"];
                                    return (
                                        <label key={definitionId} className={styles.checkChoice}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(event) => {
                                                    setSubmitError("");
                                                    setAnswers((current) => ({
                                                        ...current,
                                                        [definitionId]: event.target.checked,
                                                    }));
                                                }}
                                            />
                                            <span aria-hidden="true" />
                                            <span>
                                                <strong>{definition.shortLabel}</strong>
                                                <small>
                                                    {definitionId === "desk"
                                                        ? "Рабочее место у стены или окна"
                                                        : definitionId === "bookcase"
                                                          ? "Неглубокое хранение книг"
                                                          : "Дополнительное хранение"}
                                                </small>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>

                            {!hasBed && !hasSofa && (
                                <p className={styles.dependencyNote}>
                                    Люлька, тумбы, кофейный столик и телевизор появятся после выбора
                                    кровати или дивана.
                                </p>
                            )}

                            {tvTargetRequired && (
                                <fieldset className={styles.tvTarget}>
                                    <legend>Напротив чего поставить телевизор?</legend>
                                    <p>
                                        В комнате есть и кровать, и диван — укажите главную точку
                                        просмотра.
                                    </p>
                                    <div>
                                        <RadioChoice
                                            id="tv-target-living"
                                            name="tv-target"
                                            value="living"
                                            checked={answers.tvTargetCategory === "living"}
                                            label="Напротив дивана"
                                            onChange={(tvTargetCategory) =>
                                                setAnswers((current) => ({
                                                    ...current,
                                                    tvTargetCategory,
                                                }))
                                            }
                                        />
                                        <RadioChoice
                                            id="tv-target-sleep"
                                            name="tv-target"
                                            value="sleep"
                                            checked={answers.tvTargetCategory === "sleep"}
                                            label="Напротив кровати"
                                            onChange={(tvTargetCategory) =>
                                                setAnswers((current) => ({
                                                    ...current,
                                                    tvTargetCategory,
                                                }))
                                            }
                                        />
                                    </div>
                                </fieldset>
                            )}
                        </fieldset>

                        <div className={styles.mobileSummary}>
                            <strong>Комплект комнаты</strong>
                            <span>{pluralizeFurniture(totalCount)}</span>
                        </div>

                        <button
                            type="button"
                            className={styles.submitButton}
                            onClick={submit}
                            disabled={Boolean(disabledReason) || isSubmitting}
                        >
                            {isSubmitting ? "Открываем планировщик…" : "Перейти к расстановке"}
                        </button>
                        {disabledReason && (
                            <p className={styles.disabledReason}>{disabledReason}</p>
                        )}
                        {submitError && (
                            <p className={styles.submitError} role="alert">
                                {submitError}
                            </p>
                        )}
                    </form>

                    <aside className={styles.summary} aria-label="Выбранный комплект комнаты">
                        <header>
                            <span>Комплект комнаты</span>
                            <strong>{pluralizeFurniture(totalCount)}</strong>
                        </header>
                        {styleLabel && (
                            <p className={styles.styleContext}>
                                Контекст стиля: <strong>{styleLabel}</strong>
                            </p>
                        )}
                        {selectedFurniture.length > 0 ? (
                            <ol className={styles.selectedList}>
                                {selectedFurniture.map(({ definition, count, required }) => {
                                    const asset = getFurnitureAsset(definition.assetKey);
                                    return (
                                        <li key={definition.id}>
                                            <span className={styles.thumbnail} aria-hidden="true">
                                                {asset && (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={asset.src}
                                                        alt=""
                                                        draggable={false}
                                                        style={{
                                                            transform: `rotate(${asset.baseRotation}deg)`,
                                                        }}
                                                    />
                                                )}
                                            </span>
                                            <span>
                                                <strong>{definition.shortLabel}</strong>
                                                <small>
                                                    {required ? "обязательно" : "желательно"}
                                                </small>
                                            </span>
                                            <output aria-label={`Количество: ${definition.label}`}>
                                                ×{count}
                                            </output>
                                        </li>
                                    );
                                })}
                            </ol>
                        ) : (
                            <div className={styles.emptySummary}>
                                <span aria-hidden="true">＋</span>
                                <strong>Пока пусто</strong>
                                <p>Выбирайте варианты слева — предметы появятся здесь поштучно.</p>
                            </div>
                        )}
                        <footer>
                            <span>
                                <i aria-hidden="true" /> обязательное не удаляется автоматически
                            </span>
                            <span>
                                <i aria-hidden="true" /> желательное можно убрать, если тесно
                            </span>
                        </footer>
                    </aside>
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Questionnaire;
