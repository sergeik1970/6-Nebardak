import React, { useCallback, useEffect, useMemo, useState } from "react";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
    adminPlannerObservationService,
    type AdminPlannerItem,
    type AdminPlannerObservation,
    type AdminPlannerObservationFilters,
    type AdminPlannerObservationReviewFilter,
    type AdminPlannerObservationTriageFilter,
    type AdminPlannerObservationTriageStatus,
    type AdminPlannerObservationVerdict,
} from "@/services/adminPlannerObservationService";
import { type User } from "@/types/auth";
import styles from "./index.module.scss";

const TRIAGE_OPTIONS: Array<{
    value: AdminPlannerObservationTriageFilter;
    label: string;
    tone: "all" | "new" | "working" | "resolved" | "dismissed";
}> = [
    { value: "all", label: "Все", tone: "all" },
    { value: "new", label: "Новые", tone: "new" },
    { value: "in-progress", label: "В работе", tone: "working" },
    { value: "resolved", label: "Решено", tone: "resolved" },
    { value: "dismissed", label: "Не учитывать", tone: "dismissed" },
];

const REVIEW_OPTIONS: Array<{
    value: AdminPlannerObservationReviewFilter;
    label: string;
    tone: "all" | "unreviewed" | "good" | "questionable" | "needs-fix";
}> = [
    { value: "all", label: "Все", tone: "all" },
    { value: "unreviewed", label: "Без оценки", tone: "unreviewed" },
    { value: "good", label: "Удачно", tone: "good" },
    { value: "questionable", label: "Сомнительно", tone: "questionable" },
    { value: "needs-fix", label: "Нужно исправить", tone: "needs-fix" },
];

const INITIAL_FILTERS: AdminPlannerObservationFilters = {
    status: "all",
    review: "all",
};

const getTriageMeta = (status: AdminPlannerObservationTriageStatus) =>
    TRIAGE_OPTIONS.find((option) => option.value === status) ?? TRIAGE_OPTIONS[1];

const getReviewMeta = (verdict: AdminPlannerObservationVerdict | null) =>
    REVIEW_OPTIONS.find((option) => option.value === (verdict ?? "unreviewed")) ??
    REVIEW_OPTIONS[1];

const isAdministrator = (user: User | null): boolean => user?.role === "admin";

const formatDate = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Дата не определена";

    return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const readFiniteNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

const readText = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;

interface SavedPlanSpecification {
    room: SavedPlanRoom;
    items: AdminPlannerItem[];
}

type SavedWall = "top" | "right" | "bottom" | "left";

interface SavedWallOpening {
    id: string;
    wall: SavedWall;
    offset: number;
    width: number;
}

interface SavedRadiator extends SavedWallOpening {
    depth: number;
}

interface SavedPlanRoom {
    width: number;
    depth: number;
    doors: SavedWallOpening[];
    windows: SavedWallOpening[];
    radiators: SavedRadiator[];
}

const SAVED_WALLS = new Set<SavedWall>(["top", "right", "bottom", "left"]);

const readWall = (value: unknown): SavedWall | null =>
    typeof value === "string" && SAVED_WALLS.has(value as SavedWall) ? (value as SavedWall) : null;

const readWallOpenings = (value: unknown): SavedWallOpening[] =>
    Array.isArray(value)
        ? value.flatMap((candidate, index) => {
              if (!isRecord(candidate)) return [];
              const wall = readWall(candidate.wall);
              const offset = readFiniteNumber(candidate.offset);
              const width = readFiniteNumber(candidate.width);
              if (!wall || offset === null || width === null || offset < 0 || width <= 0) {
                  return [];
              }

              return [
                  {
                      id: readText(candidate.id) ?? `opening-${index}`,
                      wall,
                      offset,
                      width,
                  },
              ];
          })
        : [];

const readRadiators = (value: unknown): SavedRadiator[] =>
    Array.isArray(value)
        ? value.flatMap((candidate, index) => {
              if (!isRecord(candidate)) return [];
              const wall = readWall(candidate.wall);
              const offset = readFiniteNumber(candidate.offset);
              const width = readFiniteNumber(candidate.width);
              const depth = readFiniteNumber(candidate.depth);
              if (
                  !wall ||
                  offset === null ||
                  width === null ||
                  depth === null ||
                  offset < 0 ||
                  width <= 0 ||
                  depth <= 0
              ) {
                  return [];
              }

              return [
                  {
                      id: readText(candidate.id) ?? `radiator-${index}`,
                      wall,
                      offset,
                      width,
                      depth,
                  },
              ];
          })
        : [];

const getSavedSpecification = (
    observation: AdminPlannerObservation,
): SavedPlanSpecification | null => {
    const snapshot = observation.layoutSnapshot;
    if (
        !isRecord(snapshot) ||
        !isRecord(snapshot.specification) ||
        !isRecord(snapshot.specification.room)
    ) {
        return null;
    }

    const width = readFiniteNumber(snapshot.specification.room.width);
    const depth = readFiniteNumber(snapshot.specification.room.depth);
    if (width === null || depth === null || width <= 0 || depth <= 0) return null;

    const room: SavedPlanRoom = {
        width,
        depth,
        doors: readWallOpenings(snapshot.specification.room.doors),
        windows: readWallOpenings(snapshot.specification.room.windows),
        radiators: readRadiators(snapshot.specification.room.radiators),
    };
    const rawItems = snapshot.specification.items;
    if (!Array.isArray(rawItems)) return { room, items: [] };

    const items = rawItems.flatMap((rawItem): AdminPlannerItem[] => {
        if (!isRecord(rawItem)) return [];

        const x = readFiniteNumber(rawItem.x);
        const y = readFiniteNumber(rawItem.y);
        const itemWidth = readFiniteNumber(rawItem.width);
        const itemDepth = readFiniteNumber(rawItem.depth);
        if (
            x === null ||
            y === null ||
            itemWidth === null ||
            itemDepth === null ||
            itemWidth <= 0 ||
            itemDepth <= 0
        ) {
            return [];
        }

        const rotation = readFiniteNumber(rawItem.rotation);
        return [
            {
                id: readText(rawItem.id),
                instanceId: readText(rawItem.instanceId),
                label: readText(rawItem.label),
                name: readText(rawItem.name),
                x,
                y,
                width: itemWidth,
                depth: itemDepth,
                ...(rotation === null ? {} : { rotation }),
            },
        ];
    });

    return { room, items };
};

const formatRoom = (observation: AdminPlannerObservation): string => {
    const room = getSavedSpecification(observation)?.room;
    if (!room) return "Размеры комнаты не сохранены";

    return `${(room.width / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} × ${(
        room.depth / 1000
    ).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} м`;
};

const formatSolverStatus = (
    status: string,
): { label: string; tone: "complete" | "partial" | "failed" } => {
    if (status === "complete" || status === "success")
        return { label: "Расчёт готов", tone: "complete" };
    if (status === "partial") return { label: "Частичный результат", tone: "partial" };
    return { label: "Расчёт не завершён", tone: "failed" };
};

const getItemLabel = (item: AdminPlannerItem, position: number): string =>
    item.name?.trim() ||
    item.label?.trim() ||
    item.id?.trim() ||
    item.instanceId?.trim() ||
    `Предмет ${position + 1}`;

const getItems = (observation: AdminPlannerObservation): AdminPlannerItem[] =>
    getSavedSpecification(observation)?.items ?? [];

const getItemCount = (observation: AdminPlannerObservation): number => getItems(observation).length;

const shortFingerprint = (fingerprint: string): string =>
    fingerprint.length > 24 ? `${fingerprint.slice(0, 24)}…` : fingerprint;

interface PlanPreviewProps {
    observation: AdminPlannerObservation;
}

const boundedPercent = (value: number, total: number): number =>
    Math.max(0, Math.min(100, (value / total) * 100));

const getWallMarkerStyle = (
    opening: SavedWallOpening,
    room: SavedPlanRoom,
): React.CSSProperties => {
    const alongTotal =
        opening.wall === "top" || opening.wall === "bottom" ? room.width : room.depth;
    const offset = boundedPercent(opening.offset, alongTotal);
    const length = Math.max(1.5, Math.min(100 - offset, boundedPercent(opening.width, alongTotal)));

    switch (opening.wall) {
        case "top":
            return { left: `${offset}%`, top: 0, width: `${length}%` };
        case "right":
            return { right: 0, top: `${offset}%`, height: `${length}%` };
        case "bottom":
            return { bottom: 0, left: `${offset}%`, width: `${length}%` };
        case "left":
            return { left: 0, top: `${offset}%`, height: `${length}%` };
    }
};

const getRadiatorStyle = (radiator: SavedRadiator, room: SavedPlanRoom): React.CSSProperties => {
    const wallStyle = getWallMarkerStyle(radiator, room);
    const depthPercent =
        radiator.wall === "top" || radiator.wall === "bottom"
            ? boundedPercent(radiator.depth, room.depth)
            : boundedPercent(radiator.depth, room.width);
    const depth = `${Math.max(1.5, Math.min(22, depthPercent))}%`;

    switch (radiator.wall) {
        case "top":
            return { ...wallStyle, height: depth };
        case "right":
            return { ...wallStyle, width: depth };
        case "bottom":
            return { ...wallStyle, height: depth };
        case "left":
            return { ...wallStyle, width: depth };
    }
};

const PlanPreview: React.FC<PlanPreviewProps> = ({ observation }) => {
    const specification = getSavedSpecification(observation);
    const room = specification?.room;
    const items = specification?.items ?? [];

    if (!room || room.width <= 0 || room.depth <= 0) {
        return (
            <div className={styles.planUnavailable}>
                План не удалось восстановить из сохранённого снимка.
            </div>
        );
    }

    const aspectRatio = `${room.width} / ${room.depth}`;

    return (
        <figure className={styles.planFigure}>
            <div
                aria-label={`План комнаты ${formatRoom(observation)}, ${items.length} предметов`}
                className={styles.planSheet}
                role="img"
                style={{ aspectRatio }}
            >
                <span aria-hidden="true" className={styles.planDimensionTop}>
                    {room.width} мм
                </span>
                <span aria-hidden="true" className={styles.planDimensionSide}>
                    {room.depth} мм
                </span>
                {room.doors.map((door) => (
                    <span
                        aria-label={`Дверной проём: ${door.wall}`}
                        className={styles.planDoor}
                        key={door.id}
                        role="img"
                        style={getWallMarkerStyle(door, room)}
                    />
                ))}
                {room.windows.map((window) => (
                    <span
                        aria-label={`Окно: ${window.wall}`}
                        className={styles.planWindow}
                        key={window.id}
                        role="img"
                        style={getWallMarkerStyle(window, room)}
                    />
                ))}
                {room.radiators.map((radiator) => (
                    <span
                        aria-label={`Радиатор: ${radiator.wall}`}
                        className={styles.planRadiator}
                        key={radiator.id}
                        role="img"
                        style={getRadiatorStyle(radiator, room)}
                    />
                ))}
                {items.map((item, index) => {
                    const label = getItemLabel(item, index);
                    const left = Math.max(0, Math.min(100, (item.x / room.width) * 100));
                    const top = Math.max(0, Math.min(100, (item.y / room.depth) * 100));
                    const width = Math.max(
                        2,
                        Math.min(100 - left, (item.width / room.width) * 100),
                    );
                    const height = Math.max(
                        2,
                        Math.min(100 - top, (item.depth / room.depth) * 100),
                    );

                    return (
                        <span
                            className={styles.planItem}
                            data-tone={index % 3}
                            key={item.id ?? item.instanceId ?? `${label}-${index}`}
                            style={{
                                left: `${left}%`,
                                top: `${top}%`,
                                width: `${width}%`,
                                height: `${height}%`,
                            }}
                            title={label}
                        >
                            <span>{label}</span>
                            <span
                                aria-hidden="true"
                                className={styles.planOrientation}
                                data-rotation={item.rotation ?? 0}
                            >
                                ↑
                            </span>
                        </span>
                    );
                })}
                {items.length === 0 ? (
                    <span className={styles.emptyPlanLabel}>
                        В этой расстановке нет размещённых предметов.
                    </span>
                ) : null}
            </div>
            <figcaption>
                <span>Схема по сохранённой геометрии</span>
                <span>{items.length} предметов</span>
            </figcaption>
        </figure>
    );
};

interface StatePanelProps {
    title: string;
    children: React.ReactNode;
    tone?: "neutral" | "error";
}

const StatePanel: React.FC<StatePanelProps> = ({ title, children, tone = "neutral" }) => (
    <section className={styles.statePanel} data-tone={tone} aria-live="polite">
        <span aria-hidden="true" className={styles.stateMark}>
            {tone === "error" ? "!" : "—"}
        </span>
        <div>
            <h1>{title}</h1>
            <p>{children}</p>
        </div>
    </section>
);

const AdminPlannerObservations: React.FC = () => {
    const { user, isLoading: isAuthLoading } = useAuth();
    const [filters, setFilters] = useState<AdminPlannerObservationFilters>(INITIAL_FILTERS);
    const [observations, setObservations] = useState<AdminPlannerObservation[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<number | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const admin = isAdministrator(user);

    const loadObservations = useCallback(async () => {
        if (!admin) return;

        setIsLoading(true);
        setLoadError(null);
        try {
            const result = await adminPlannerObservationService.list(filters);
            setObservations(result);
            setSelectedId((current) =>
                current !== null && result.some((observation) => observation.id === current)
                    ? current
                    : result[0]?.id ?? null,
            );
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "Не удалось загрузить очередь.");
        } finally {
            setIsLoading(false);
        }
    }, [admin, filters]);

    useEffect(() => {
        void loadObservations();
    }, [loadObservations]);

    const selectedObservation = useMemo(
        () => observations.find((observation) => observation.id === selectedId) ?? null,
        [observations, selectedId],
    );

    const updateTriage = async (
        observation: AdminPlannerObservation,
        status: AdminPlannerObservationTriageStatus,
    ) => {
        if (status === observation.triageStatus) return;

        setSavingId(observation.id);
        setSaveError(null);
        try {
            const updated = await adminPlannerObservationService.updateTriage(
                observation.id,
                status,
            );
            setObservations((current) =>
                current.map((item) => (item.id === observation.id ? updated : item)),
            );
            await loadObservations();
        } catch (error) {
            setSaveError(
                error instanceof Error ? error.message : "Не удалось изменить состояние записи.",
            );
        } finally {
            setSavingId(null);
        }
    };

    const changeFilter = <Key extends keyof AdminPlannerObservationFilters>(
        key: Key,
        value: AdminPlannerObservationFilters[Key],
    ) => {
        setFilters((current) => ({ ...current, [key]: value }));
    };

    const renderContent = () => {
        if (isAuthLoading) {
            return (
                <StatePanel title="Проверяем доступ">Подготавливаем закрытую очередь.</StatePanel>
            );
        }

        if (!admin) {
            return (
                <StatePanel title="Доступ ограничен">
                    Эта очередь доступна только администраторам. Войдите с учётной записью, которой
                    назначена соответствующая роль.
                </StatePanel>
            );
        }

        if (isLoading && observations.length === 0) {
            return (
                <StatePanel title="Загружаем расстановки">
                    Собираем сохранённые наблюдения.
                </StatePanel>
            );
        }

        if (loadError) {
            return (
                <StatePanel title="Очередь пока недоступна" tone="error">
                    {loadError}
                    <button
                        className={styles.retryButton}
                        onClick={() => void loadObservations()}
                        type="button"
                    >
                        Повторить загрузку
                    </button>
                </StatePanel>
            );
        }

        return (
            <>
                <section aria-label="Фильтры очереди" className={styles.filters}>
                    <div className={styles.filterGroup}>
                        <span className={styles.filterLabel}>Состояние</span>
                        <div className={styles.filterChoices}>
                            {TRIAGE_OPTIONS.map((option) => (
                                <button
                                    aria-pressed={filters.status === option.value}
                                    className={styles.filterButton}
                                    data-active={filters.status === option.value}
                                    data-tone={option.tone}
                                    key={option.value}
                                    onClick={() => changeFilter("status", option.value)}
                                    type="button"
                                >
                                    <span aria-hidden="true" />
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className={styles.filterGroup}>
                        <span className={styles.filterLabel}>Оценка дизайнера</span>
                        <div className={styles.filterChoices}>
                            {REVIEW_OPTIONS.map((option) => (
                                <button
                                    aria-pressed={filters.review === option.value}
                                    className={styles.filterButton}
                                    data-active={filters.review === option.value}
                                    data-tone={option.tone}
                                    key={option.value}
                                    onClick={() => changeFilter("review", option.value)}
                                    type="button"
                                >
                                    <span aria-hidden="true" />
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </section>

                {observations.length === 0 ? (
                    <StatePanel title="В этой выборке пока пусто">
                        Новые записи появятся здесь после генерации расстановки и сохранения
                        наблюдения дизайнером.
                    </StatePanel>
                ) : (
                    <div className={styles.workspace}>
                        <aside
                            aria-label="Сохранённые расстановки"
                            className={styles.observationList}
                        >
                            <div className={styles.listHeading}>
                                <span>Записи</span>
                                <strong>{observations.length}</strong>
                            </div>
                            <div className={styles.listScroller}>
                                {observations.map((observation) => {
                                    const triage = getTriageMeta(observation.triageStatus);
                                    const review = getReviewMeta(observation.reviewVerdict);
                                    const solver = formatSolverStatus(observation.solverStatus);
                                    const selected = observation.id === selectedId;

                                    return (
                                        <button
                                            aria-current={selected ? "true" : undefined}
                                            className={styles.observationCard}
                                            data-selected={selected}
                                            key={observation.id}
                                            onClick={() => setSelectedId(observation.id)}
                                            type="button"
                                        >
                                            <span className={styles.cardTopline}>
                                                <time dateTime={observation.createdAt}>
                                                    {formatDate(observation.createdAt)}
                                                </time>
                                                <span
                                                    className={styles.statusDot}
                                                    data-tone={triage.tone}
                                                />
                                            </span>
                                            <strong>{formatRoom(observation)}</strong>
                                            <span className={styles.cardMeta}>
                                                {getItemCount(observation)} предметов ·{" "}
                                                {solver.label}
                                            </span>
                                            <span className={styles.cardTags}>
                                                <span data-tone={review.tone}>{review.label}</span>
                                                <span data-tone={triage.tone}>{triage.label}</span>
                                            </span>
                                            <span className={styles.commentPreview}>
                                                {observation.reviewComment?.trim() ||
                                                    "Наблюдение не оставлено"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </aside>

                        {selectedObservation ? (
                            <article className={styles.detailPanel}>
                                <header className={styles.detailHeader}>
                                    <div>
                                        <span className={styles.detailEyebrow}>
                                            Выбранная расстановка
                                        </span>
                                        <h1>{formatRoom(selectedObservation)}</h1>
                                        <p>
                                            Сохранено {formatDate(selectedObservation.createdAt)} ·
                                            проверил дизайнер {selectedObservation.reviewer.name}
                                        </p>
                                    </div>
                                    <span
                                        className={styles.detailStatus}
                                        data-tone={
                                            getTriageMeta(selectedObservation.triageStatus).tone
                                        }
                                    >
                                        <span aria-hidden="true" />
                                        {getTriageMeta(selectedObservation.triageStatus).label}
                                    </span>
                                </header>

                                <div className={styles.detailLayout}>
                                    <PlanPreview observation={selectedObservation} />
                                    <section
                                        className={styles.reviewBlock}
                                        aria-labelledby="designer-review-title"
                                    >
                                        <span className={styles.sectionLabel}>
                                            Наблюдение дизайнера
                                        </span>
                                        <h2 id="designer-review-title">
                                            {getReviewMeta(selectedObservation.reviewVerdict).label}
                                        </h2>
                                        <p>
                                            {selectedObservation.reviewComment?.trim() ||
                                                "Комментарий к этой расстановке не сохранён."}
                                        </p>
                                        {selectedObservation.reviewedAt ? (
                                            <time dateTime={selectedObservation.reviewedAt}>
                                                Оценка сохранена{" "}
                                                {formatDate(selectedObservation.reviewedAt)}
                                            </time>
                                        ) : null}
                                    </section>
                                </div>

                                <div className={styles.detailFooter}>
                                    <section
                                        className={styles.triageControl}
                                        aria-labelledby="triage-label"
                                    >
                                        <label id="triage-label" htmlFor="observation-triage">
                                            Состояние разбора
                                        </label>
                                        <select
                                            disabled={savingId === selectedObservation.id}
                                            id="observation-triage"
                                            onChange={(event) =>
                                                void updateTriage(
                                                    selectedObservation,
                                                    event.target
                                                        .value as AdminPlannerObservationTriageStatus,
                                                )
                                            }
                                            value={selectedObservation.triageStatus}
                                        >
                                            {TRIAGE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        {savingId === selectedObservation.id ? (
                                            <span className={styles.saveState}>Сохраняем…</span>
                                        ) : selectedObservation.triagedAt ? (
                                            <span className={styles.saveState}>
                                                Обновлено{" "}
                                                {formatDate(selectedObservation.triagedAt)}
                                            </span>
                                        ) : null}
                                    </section>

                                    <section
                                        className={styles.technicalMeta}
                                        aria-label="Технические сведения"
                                    >
                                        <dl>
                                            <div>
                                                <dt>Алгоритм</dt>
                                                <dd>{selectedObservation.algorithmVersion}</dd>
                                            </div>
                                            <div>
                                                <dt>Каталог</dt>
                                                <dd>{selectedObservation.catalogVersion}</dd>
                                            </div>
                                            <div>
                                                <dt>Вход</dt>
                                                <dd title={selectedObservation.inputFingerprint}>
                                                    {shortFingerprint(
                                                        selectedObservation.inputFingerprint,
                                                    )}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>План</dt>
                                                <dd title={selectedObservation.layoutFingerprint}>
                                                    {shortFingerprint(
                                                        selectedObservation.layoutFingerprint,
                                                    )}
                                                </dd>
                                            </div>
                                        </dl>
                                    </section>
                                </div>
                                {saveError ? (
                                    <p className={styles.saveError} role="alert">
                                        {saveError}
                                    </p>
                                ) : null}
                            </article>
                        ) : null}
                    </div>
                )}
            </>
        );
    };

    return (
        <div className={styles.page}>
            <Navigation />
            <main className={styles.main} id="main-content" tabIndex={-1}>
                <header className={styles.pageHeader}>
                    <div>
                        <span className={styles.eyebrow}>Администрирование · планировщик</span>
                        <h1>Разбор расстановок</h1>
                        <p>
                            Каждая сгенерированная схема сохранена вместе с одним наблюдением
                            дизайнера.
                        </p>
                    </div>
                    {admin && !isAuthLoading ? (
                        <div className={styles.queueCount} aria-live="polite">
                            <strong>{observations.length}</strong>
                            <span>в текущей выборке</span>
                        </div>
                    ) : null}
                </header>
                {renderContent()}
            </main>
            <Footer />
        </div>
    );
};

export default AdminPlannerObservations;
