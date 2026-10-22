import FurniturePhoto from "@/shared/components/FurniturePhoto";
import { getFurniturePhoto } from "@/shared/lib/furniture-planner/furniture-photos";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import { trackGoal } from "@/shared/lib/analytics";
import {
    FURNITURE_CATALOG,
    FurniturePriority,
    StyleFinderProjectDraft,
    createProjectDraft,
    getFurniture,
    getFurnitureAsset,
    readProjectDraft,
    resetProjectDraft,
    saveProjectDraft,
    saveQuestionnairePlannerHandoff,
} from "@/shared/lib/furniture-planner";
import RadioChoice from "./RadioChoice";
import {
    answersFromDraft,
    BED_OPTIONS,
    BedChoice,
    getDefaultPriority,
    getPlannerInputsSignature,
    getQueryString,
    getWardrobeItems,
    getWardrobeTotal,
    INITIAL_ANSWERS,
    pluralizeFurniture,
    PRIORITY_OPTIONS,
    PriorityMap,
    QuestionnaireAnswers,
    SelectedFurniture,
    SOFA_OPTIONS,
    SofaChoice,
    WARDROBE_OPTIONS,
    WardrobeCount,
    WardrobeId,
} from "./model";
import styles from "./index.module.scss";
import { useProjectHref } from "@/shared/lib/project-scope/ProjectScope";
import { readProjectDocument } from "@/shared/lib/project-scope/document";
import { hasProjectRoom } from "@/shared/lib/project-scope/progress";
import { getProjectStorage, withProjectQuery } from "@/shared/lib/project-scope/storage";

const Questionnaire: React.FC = () => {
    const projectHref = useProjectHref();
    const router = useRouter();
    const [answers, setAnswers] = useState<QuestionnaireAnswers>(INITIAL_ANSWERS);
    const [priorities, setPriorities] = useState<PriorityMap>({});
    const [restoredMeta, setRestoredMeta] = useState<{
        styleKey?: string;
        styleLabel?: string;
    }>({});
    const [draftPlanner, setDraftPlanner] = useState<NonNullable<
        StyleFinderProjectDraft["planner"]
    > | null>(null);
    const [submitError, setSubmitError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    // With a room already drawn the next step is the layout itself.
    const [hasRoom, setHasRoom] = useState(false);
    const [draftReady, setDraftReady] = useState(false);
    const [draftWritable, setDraftWritable] = useState(false);
    const [draftCanReset, setDraftCanReset] = useState(false);
    const [draftWarning, setDraftWarning] = useState("");
    const draftRead = useRef(false);
    const restoredPlannerInputsSignature = useRef<string | null>(null);

    const queryStyleKey = router.isReady ? getQueryString(router.query.style, 80) : undefined;
    const queryStyleLabel = router.isReady
        ? getQueryString(router.query.styleLabel, 120)
        : undefined;
    const styleKey = queryStyleKey ?? restoredMeta.styleKey;
    const styleLabel = queryStyleLabel ?? restoredMeta.styleLabel;
    const hasBed = answers.bed !== "none";
    const hasSofa = answers.sofa !== "none";
    const tvTargetRequired = answers.tv && hasBed && hasSofa;

    const selectedFurniture = useMemo<SelectedFurniture[]>(() => {
        const selection = new Map<string, { count: number }>();

        if (hasBed) selection.set(answers.bed, { count: 1 });
        if (hasSofa) selection.set(answers.sofa, { count: 1 });
        for (const wardrobe of getWardrobeItems(answers.wardrobes)) {
            selection.set(wardrobe.definitionId, { count: wardrobe.count });
        }
        if (answers.cradle && answers.bed === "double-bed") {
            selection.set("cradle", { count: 1 });
        }
        if (answers.bedsideTableCount > 0 && hasBed) {
            selection.set("bedside-table", {
                count: answers.bedsideTableCount,
            });
        }
        if (answers.coffeeTable && hasSofa) {
            selection.set("coffee-table", { count: 1 });
        }
        if (answers.tv && (hasBed || hasSofa)) {
            selection.set("tv", { count: 1 });
        }
        if (answers.desk) selection.set("desk", { count: 1 });
        if (answers.bookcase) selection.set("bookcase", { count: 1 });
        if (answers.dresser) selection.set("dresser", { count: 1 });

        return FURNITURE_CATALOG.flatMap((definition) => {
            const selected = selection.get(definition.id);
            return selected
                ? [
                      {
                          definition,
                          ...selected,
                          priority:
                              priorities[definition.id] ??
                              getDefaultPriority(definition.id, answers),
                      },
                  ]
                : [];
        });
    }, [answers, hasBed, hasSofa, priorities]);

    const totalCount = selectedFurniture.reduce((sum, item) => sum + item.count, 0);
    const wardrobeTotal = getWardrobeTotal(answers.wardrobes);
    const disabledReason =
        totalCount === 0
            ? "Выберите хотя бы один предмет мебели."
            : tvTargetRequired && !answers.tvTargetCategory
              ? "Укажите, напротив чего поставить телевизор."
              : "";

    useEffect(() => {
        if (!router.isReady || draftRead.current) return;
        draftRead.current = true;
        const projectDocument = readProjectDocument(getProjectStorage());
        setHasRoom(projectDocument.status === "success" && hasProjectRoom(projectDocument.value));

        const result = readProjectDraft();
        if (result.status === "success") {
            const { questionnaire, planner } = result.value;
            setAnswers(
                answersFromDraft(questionnaire.items, questionnaire.preferences?.tvTargetCategory),
            );
            setPriorities(
                Object.fromEntries(
                    questionnaire.items.map((item) => [item.definitionId, item.priority]),
                ),
            );
            setRestoredMeta(questionnaire.meta ?? {});
            setDraftPlanner(planner ?? null);
            restoredPlannerInputsSignature.current = planner
                ? getPlannerInputsSignature(questionnaire.items, questionnaire.preferences)
                : null;
            setDraftWritable(true);
            setDraftReady(true);
            return;
        }

        if (result.status === "missing") {
            setDraftWritable(true);
        } else if (result.status === "unsupported-version") {
            setDraftCanReset(true);
            setDraftWarning("Не удалось открыть предыдущий проект. Начните новый.");
        } else if (result.status !== "unavailable") {
            setDraftCanReset(true);
            setDraftWarning("Не удалось открыть предыдущий проект. Начните новый.");
        } else {
            setDraftWarning("");
        }
        setDraftReady(true);
    }, [router.isReady]);

    useEffect(() => {
        if (!draftReady || !draftWritable) return;

        const items = selectedFurniture.map(({ definition, count, priority }) => ({
            definitionId: definition.id,
            count,
            priority,
        }));
        const preferences = answers.tv
            ? {
                  tvTargetCategory: answers.tvTargetCategory ?? (hasBed ? "sleep" : "living"),
              }
            : undefined;
        const questionnaire = {
            items,
            ...(preferences ? { preferences } : {}),
            ...(styleKey || styleLabel
                ? {
                      meta: {
                          ...(styleKey ? { styleKey } : {}),
                          ...(styleLabel ? { styleLabel } : {}),
                      },
                  }
                : {}),
        };
        const plannerInputsSignature = getPlannerInputsSignature(items, preferences);
        const preserveGeneratedPlan =
            draftPlanner !== null &&
            restoredPlannerInputsSignature.current === plannerInputsSignature;
        const planner = draftPlanner
            ? {
                  room: draftPlanner.room,
                  selection: Object.fromEntries(
                      items.map((item) => [item.definitionId, item.count]),
                  ),
                  priorities: Object.fromEntries(
                      items.map((item) => [item.definitionId, item.priority]),
                  ),
                  ...(preferences ? { preferences } : {}),
                  ...(preserveGeneratedPlan && draftPlanner.layout
                      ? { layout: draftPlanner.layout }
                      : {}),
                  ...(preserveGeneratedPlan && draftPlanner.removedItems
                      ? { removedItems: draftPlanner.removedItems }
                      : {}),
                  ...(preserveGeneratedPlan && draftPlanner.removalArchive
                      ? { removalArchive: draftPlanner.removalArchive }
                      : {}),
              }
            : undefined;
        const result = saveProjectDraft(createProjectDraft(questionnaire, planner));

        if (result.status === "unavailable") return;
    }, [
        answers.tv,
        answers.tvTargetCategory,
        draftReady,
        draftPlanner,
        draftWritable,
        hasBed,
        selectedFurniture,
        styleKey,
        styleLabel,
    ]);

    const discardBrokenDraft = useCallback(() => {
        const result = resetProjectDraft();
        if (result.status === "unavailable") {
            setDraftWarning("Не удалось начать новый проект. Попробуйте ещё раз.");
            return;
        }
        setDraftWarning("");
        setDraftCanReset(false);
        setDraftWritable(true);
    }, []);

    const startNewProject = useCallback(async () => {
        if (
            typeof window !== "undefined" &&
            !window.confirm("Начать новый проект? Текущие ответы и план комнаты будут удалены.")
        ) {
            return;
        }

        const reset = resetProjectDraft();
        if (reset.status === "unavailable") {
            setDraftWarning("Не удалось удалить текущий черновик. Новый проект не начат.");
            return;
        }

        setAnswers(INITIAL_ANSWERS);
        setPriorities({});
        setRestoredMeta({});
        setDraftPlanner(null);
        restoredPlannerInputsSignature.current = null;
        setDraftWarning("");
        setDraftCanReset(false);
        setDraftWritable(true);
        await router.replace({ pathname: "/questionnaire", query: withProjectQuery({ new: "1" }) });
    }, [router]);

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

    const updateWardrobeCount = useCallback((definitionId: WardrobeId, count: WardrobeCount) => {
        setSubmitError("");
        setAnswers((current) => {
            const otherWardrobes =
                getWardrobeTotal(current.wardrobes) - current.wardrobes[definitionId];
            if (otherWardrobes + count > 2) return current;

            return {
                ...current,
                wardrobes: {
                    ...current.wardrobes,
                    [definitionId]: count,
                },
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
            items: selectedFurniture.map(({ definition, count, priority }) => ({
                definitionId: definition.id,
                count,
                priority,
                required: priority === "required",
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
                "Не удалось подготовить комплект. Проверьте ответы и попробуйте ещё раз.",
            );
            setIsSubmitting(false);
            return;
        }

        trackGoal("questionnaire_complete", {
            items: selectedFurniture.length,
            hasRoom,
            hasStyle: Boolean(styleKey),
        });

        try {
            const navigated = await router.push({
                pathname: hasRoom ? "/planner" : "/planner/draw",
                query: withProjectQuery({ handoff: result.id }),
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
        hasRoom,
        isSubmitting,
        router,
        selectedFurniture,
        styleKey,
        styleLabel,
    ]);

    return (
        <div className={styles.page}>
            <Navigation />
            <main id="main-content" className={styles.main} tabIndex={-1}>
                <div className={styles.projectBar}>
                    <span>{styleLabel ? `Стиль: ${styleLabel}` : ""}</span>
                    <button type="button" onClick={startNewProject}>
                        Новый проект
                    </button>
                </div>

                {draftWarning && (
                    <div className={styles.draftWarning} role="alert">
                        <span>{draftWarning}</span>
                        {draftReady && draftCanReset && (
                            <button type="button" onClick={discardBrokenDraft}>
                                Удалить несовместимый черновик
                            </button>
                        )}
                    </div>
                )}

                <header className={styles.header}>
                    <span className={styles.eyebrow}>Шаг 2 · Анкета</span>
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
                                    <small>До двух шкафов — одного или разных размеров</small>
                                </span>
                            </legend>
                            <div className={styles.wardrobeGrid}>
                                {WARDROBE_OPTIONS.map((option) => (
                                    <div className={styles.countChoice} key={option.value}>
                                        <span>
                                            <strong>{option.label}</strong>
                                            <small>
                                                {answers.wardrobes[option.value] > 0
                                                    ? `Выбрано: ${answers.wardrobes[option.value]}`
                                                    : "Не выбран"}
                                            </small>
                                        </span>
                                        <span
                                            aria-label={`Количество: ${option.label}`}
                                            className={styles.countButtons}
                                            role="group"
                                        >
                                            {([0, 1, 2] as const).map((count) => {
                                                const otherWardrobes =
                                                    wardrobeTotal - answers.wardrobes[option.value];
                                                const unavailable = otherWardrobes + count > 2;
                                                return (
                                                    <button
                                                        aria-label={`${option.label}: ${count}`}
                                                        aria-pressed={
                                                            answers.wardrobes[option.value] ===
                                                            count
                                                        }
                                                        disabled={unavailable}
                                                        key={count}
                                                        onClick={() =>
                                                            updateWardrobeCount(option.value, count)
                                                        }
                                                        type="button"
                                                    >
                                                        {count}
                                                    </button>
                                                );
                                            })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <p className={styles.wardrobeHint} aria-live="polite">
                                Шкафов в комплекте: {wardrobeTotal} из 2. Чтобы заменить заполненный
                                вариант, сначала уменьшите его количество.
                            </p>
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

                        <div
                            aria-atomic="true"
                            aria-live="polite"
                            className={styles.mobileSummary}
                            role="status"
                        >
                            <strong>Выбрано</strong>
                            <span>{pluralizeFurniture(totalCount)}</span>
                        </div>

                        <button
                            aria-busy={isSubmitting}
                            aria-describedby={
                                disabledReason
                                    ? "questionnaire-disabled-reason"
                                    : submitError
                                      ? "questionnaire-submit-error"
                                      : undefined
                            }
                            className={styles.submitButton}
                            disabled={Boolean(disabledReason) || isSubmitting}
                            onClick={submit}
                            type="button"
                        >
                            {isSubmitting
                                ? "Открываем следующий шаг…"
                                : hasRoom
                                  ? "Перейти к расстановке"
                                  : "Дальше: комната"}
                        </button>
                        {disabledReason && (
                            <p
                                aria-live="polite"
                                className={styles.disabledReason}
                                id="questionnaire-disabled-reason"
                            >
                                {disabledReason}
                            </p>
                        )}
                        {submitError && (
                            <p
                                className={styles.submitError}
                                id="questionnaire-submit-error"
                                role="alert"
                            >
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
                                {selectedFurniture.map(({ definition, count, priority }) => {
                                    const asset = getFurnitureAsset(definition.id);
                                    return (
                                        <li key={definition.id}>
                                            <span className={styles.thumbnail} aria-hidden="true">
                                                {getFurniturePhoto(definition.id) ? (
                                                    <FurniturePhoto
                                                        photo={getFurniturePhoto(definition.id)!}
                                                        fit
                                                    />
                                                ) : (
                                                    asset && (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={asset.src}
                                                            alt=""
                                                            draggable={false}
                                                            style={{
                                                                transform: `rotate(${asset.baseRotation}deg)`,
                                                            }}
                                                        />
                                                    )
                                                )}
                                            </span>
                                            <span>
                                                <strong>{definition.shortLabel}</strong>
                                                <div
                                                    className={styles.priorityField}
                                                    role="group"
                                                    aria-label={`Приоритет: ${definition.label}`}
                                                >
                                                    <span>Приоритет</span>
                                                    <span className={styles.priorityChoices}>
                                                        {PRIORITY_OPTIONS.map((option) => (
                                                            <button
                                                                key={option.value}
                                                                type="button"
                                                                aria-pressed={
                                                                    priority === option.value ||
                                                                    (priority === "optional" &&
                                                                        option.value ===
                                                                            "preferred")
                                                                }
                                                                onClick={() => {
                                                                    setSubmitError("");
                                                                    setPriorities((current) => ({
                                                                        ...current,
                                                                        [definition.id]:
                                                                            option.value,
                                                                    }));
                                                                }}
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </span>
                                                </div>
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
                            {PRIORITY_OPTIONS.map((option) => (
                                <span key={option.value}>
                                    <i aria-hidden="true" data-priority={option.value} />
                                    {option.label}: {option.description}
                                </span>
                            ))}
                        </footer>
                    </aside>
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Questionnaire;
