import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import {
    clearProjectDraftVisualTest,
    readProjectDraft,
    updateProjectDraftVisualTest,
} from "@/shared/lib/furniture-planner/project-draft";
import {
    STYLE_PROFILES,
    VISUAL_TEST_TOTAL_STEPS,
    answerVisualTest,
    clearVisualTestSession,
    createVisualTestSession,
    getCategoryForSlot,
    getReachableNextImageUrls,
    getVisualImagePath,
    getVisualTestStep,
    persistVisualTestSession,
    undoVisualTest,
    type TestResponse,
    type VisualTestSession,
} from "@/shared/lib/visual-preference";
import {
    getStyleResultContent,
    type StyleResultContent,
} from "@/shared/lib/visual-preference/result-style-content";
import { restoreVisualTestForTab } from "./storage";
import styles from "./index.module.scss";

const RESULT_GALLERY_SWIPE_THRESHOLD = 48;

function createClientSeed(): number {
    const values = new Uint32Array(1);
    if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(values);
        if (values[0] > 0) return values[0];
    }
    return (Date.now() ^ Math.floor(window.performance.now() * 1000)) >>> 0 || 1;
}

interface ResultStyleGalleryProps {
    content: StyleResultContent;
    styleLabel: string;
}

const ResultStyleGallery: React.FC<ResultStyleGalleryProps> = ({ content, styleLabel }) => {
    const [activeRoomIndex, setActiveRoomIndex] = useState(0);
    const touchStartX = useRef<number | null>(null);
    const activeRoom = content.rooms[activeRoomIndex];

    const selectRoom = useCallback(
        (index: number) => {
            const roomCount = content.rooms.length;
            setActiveRoomIndex((index + roomCount) % roomCount);
        },
        [content.rooms.length],
    );

    const showPreviousRoom = useCallback(() => {
        selectRoom(activeRoomIndex - 1);
    }, [activeRoomIndex, selectRoom]);

    const showNextRoom = useCallback(() => {
        selectRoom(activeRoomIndex + 1);
    }, [activeRoomIndex, selectRoom]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.target !== event.currentTarget
        ) {
            return;
        }

        if (event.key === "ArrowLeft") {
            event.preventDefault();
            showPreviousRoom();
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            showNextRoom();
        }
    };

    const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
    };

    const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        const startX = touchStartX.current;
        const endX = event.changedTouches[0]?.clientX;
        touchStartX.current = null;

        if (startX === null || endX === undefined) return;
        const distance = endX - startX;

        if (Math.abs(distance) < RESULT_GALLERY_SWIPE_THRESHOLD) return;
        if (distance > 0) showPreviousRoom();
        else showNextRoom();
    };

    return (
        <section
            className={styles.styleGallery}
            aria-label={`Визуализации стиля «${styleLabel}»`}
            aria-roledescription="карусель"
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            <div className={styles.galleryHeading}>
                <div>
                    <p className={styles.eyebrow}>ВАШ СТИЛЬ В ИНТЕРЬЕРЕ</p>
                    <h3>Как это направление живёт в разных комнатах</h3>
                </div>
                <p className={styles.galleryCount} aria-live="polite" aria-atomic="true">
                    <strong>{String(activeRoomIndex + 1).padStart(2, "0")}</strong>
                    <span aria-hidden="true"> / </span>
                    <span>03</span>
                </p>
            </div>

            <div className={styles.galleryStage}>
                <button
                    type="button"
                    className={styles.galleryArrow}
                    onClick={showPreviousRoom}
                    aria-label="Показать предыдущую визуализацию"
                >
                    <span aria-hidden="true">←</span>
                </button>
                <div
                    id="style-result-visual"
                    className={styles.galleryViewport}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                >
                    <figure>
                        <Image
                            key={activeRoom.imagePath}
                            src={activeRoom.imagePath}
                            alt={`${styleLabel}: ${activeRoom.label.toLowerCase()} в выбранном стиле`}
                            fill
                            unoptimized
                            sizes="(max-width: 767px) calc(100vw - 7.5rem), (max-width: 1200px) calc(100vw - 12rem), 960px"
                        />
                        <figcaption>
                            <span>{String(activeRoomIndex + 1).padStart(2, "0")} / 03</span>
                            <strong>{activeRoom.label}</strong>
                        </figcaption>
                    </figure>
                </div>
                <button
                    type="button"
                    className={styles.galleryArrow}
                    onClick={showNextRoom}
                    aria-label="Показать следующую визуализацию"
                >
                    <span aria-hidden="true">→</span>
                </button>
            </div>

            <ol className={styles.galleryPagination} aria-label="Выбор комнаты">
                {content.rooms.map((room, index) => (
                    <li key={room.key}>
                        <button
                            type="button"
                            onClick={() => selectRoom(index)}
                            aria-controls="style-result-visual"
                            aria-pressed={index === activeRoomIndex}
                        >
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <strong>{room.label}</strong>
                        </button>
                    </li>
                ))}
            </ol>
        </section>
    );
};

const Test: React.FC = () => {
    const [session, setSession] = useState<VisualTestSession | null>(null);
    const preloadedUrls = useRef(new Set<string>());

    useEffect(() => {
        const project = readProjectDraft();
        const restored = restoreVisualTestForTab({
            projectSession: project.status === "success" ? project.value.visualTest : undefined,
            fallbackStorage: window.sessionStorage,
            saveProjectSession: updateProjectDraftVisualTest,
        });

        setSession(restored ?? createVisualTestSession(createClientSeed()));
    }, []);

    useEffect(() => {
        if (!session) return;

        const result = updateProjectDraftVisualTest(session);
        if (result.status === "success") {
            clearVisualTestSession(window.sessionStorage);
        } else {
            persistVisualTestSession(window.sessionStorage, session);
        }
    }, [session]);

    const answer = useCallback((response: TestResponse) => {
        setSession((current) => (current ? answerVisualTest(current, response) : current));
    }, []);

    const goBack = useCallback(() => {
        setSession((current) => (current ? undoVisualTest(current) : current));
    }, []);

    const restart = useCallback(() => {
        const confirmed = window.confirm(
            "Начать тест заново? Текущий прогресс и результат будут удалены.",
        );
        if (!confirmed) return;

        clearProjectDraftVisualTest();
        clearVisualTestSession(window.sessionStorage);
        preloadedUrls.current.clear();
        setSession(createVisualTestSession(createClientSeed()));
    }, []);

    const nextImageUrls = useMemo(
        () => (session ? getReachableNextImageUrls(session) : []),
        [session],
    );

    useEffect(() => {
        for (const url of nextImageUrls) {
            if (preloadedUrls.current.has(url)) continue;
            const image = new window.Image();
            image.decoding = "async";
            image.src = url;
            preloadedUrls.current.add(url);
        }
    }, [nextImageUrls]);

    useEffect(() => {
        if (!session || session.phase !== "playing") return;

        const handleKeyboard = (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const target = event.target as HTMLElement | null;
            if (target?.matches("input, textarea, select, [contenteditable='true']")) return;

            if (event.key === "ArrowLeft" || event.key === "1") {
                event.preventDefault();
                answer({ kind: "choose", key: session.slots[0].key });
            } else if (event.key === "ArrowRight" || event.key === "2") {
                event.preventDefault();
                answer({ kind: "choose", key: session.slots[1].key });
            } else if (event.key.toLowerCase() === "b" || event.key.toLowerCase() === "и") {
                event.preventDefault();
                answer({ kind: "both" });
            } else if (event.key.toLowerCase() === "n" || event.key.toLowerCase() === "т") {
                event.preventDefault();
                answer({ kind: "neither" });
            } else if (event.key === "Backspace" && session.history.length > 0) {
                event.preventDefault();
                goBack();
            }
        };

        window.addEventListener("keydown", handleKeyboard);
        return () => window.removeEventListener("keydown", handleKeyboard);
    }, [answer, goBack, session]);

    if (!session) {
        return (
            <div className={styles.test}>
                <Navigation />
                <main id="main-content" className={styles.main} tabIndex={-1}>
                    <div className={styles.loading} role="status" aria-live="polite">
                        <span className={styles.loadingMark} aria-hidden="true" />
                        <p>Восстанавливаем ваш выбор…</p>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    if (session.phase === "results" && session.result) {
        const primary = STYLE_PROFILES[session.result.primaryKey];
        const nearby = session.result.nearbyKeys.map((key) => STYLE_PROFILES[key]);
        const styleContent = getStyleResultContent(primary.key);

        return (
            <div className={styles.test}>
                <Navigation />
                <main id="main-content" className={styles.main} tabIndex={-1}>
                    <section
                        className={styles.resultHero}
                        aria-labelledby="result-title"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        <p className={styles.eyebrow}>ВАШ ВИЗУАЛЬНЫЙ ОРИЕНТИР</p>
                        <p className={styles.resultOverline}>Основное направление</p>
                        <h1 id="result-title" className={styles.resultTitle}>
                            {primary.label}
                        </h1>
                        <p className={styles.resultLead}>
                            Это не диагноз и не окончательный ярлык, а отправная точка. Сочетания,
                            цвета и предметы можно менять под вашу комнату и привычки.
                        </p>
                        <div className={styles.confidence}>
                            <span>Уверенность результата</span>
                            <strong>
                                {session.result.confidenceLabel} · {session.result.confidenceScore}
                                /100
                            </strong>
                        </div>
                    </section>

                    {styleContent && (
                        <section
                            className={styles.styleStory}
                            aria-labelledby="style-description-title"
                        >
                            <div className={styles.styleCopyHeading}>
                                <p className={styles.eyebrow}>ОПИСАНИЕ СТИЛЯ</p>
                                <h2 id="style-description-title">{primary.label}</h2>
                            </div>
                            <div className={styles.styleDescription}>
                                {styleContent.description.map((paragraph) => (
                                    <p key={paragraph}>{paragraph}</p>
                                ))}
                            </div>
                            <ResultStyleGallery content={styleContent} styleLabel={primary.label} />
                        </section>
                    )}

                    <div className={styles.resultGrid}>
                        <section className={styles.resultPanel} aria-labelledby="signals-title">
                            <p className={styles.panelNumber}>01</p>
                            <h2 id="signals-title">Что повлияло на результат</h2>
                            <ul className={styles.signalList}>
                                {session.result.influences.map((signal) => (
                                    <li key={signal}>{signal}</li>
                                ))}
                            </ul>
                        </section>

                        <section className={styles.resultPanel} aria-labelledby="palette-title">
                            <p className={styles.panelNumber}>02</p>
                            <h2 id="palette-title">Палитра и материалы</h2>
                            <div className={styles.palette} aria-label="Рекомендуемая палитра">
                                {session.result.palette.map((color, index) => (
                                    <span
                                        key={color}
                                        className={styles.swatch}
                                        style={{ backgroundColor: color }}
                                        title={`Цвет ${index + 1}: ${color}`}
                                    />
                                ))}
                            </div>
                            <p className={styles.materials}>
                                {session.result.materials.join(" · ")}
                            </p>
                        </section>
                    </div>

                    <section className={styles.nearbySection} aria-labelledby="nearby-title">
                        <div>
                            <p className={styles.eyebrow}>БЛИЗКИЕ НАПРАВЛЕНИЯ</p>
                            <h2 id="nearby-title">Ваш вкус не обязан помещаться в один стиль</h2>
                        </div>
                        <div className={styles.nearbyGrid}>
                            {nearby.map((profile) => (
                                <article key={profile.key} className={styles.nearbyCard}>
                                    <h3>{profile.label}</h3>
                                    <p>{profile.signals.slice(0, 2).join(" · ")}</p>
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className={styles.resultActions} aria-label="Следующий шаг">
                        <div>
                            <p className={styles.eyebrow}>ДАЛЬШЕ — ПОТРЕБНОСТИ КОМНАТЫ</p>
                            <h2>Соберём мебель, а затем проверим расстановку</h2>
                            <p>
                                Стиль останется подсказкой и не будет подменять ваши реальные
                                задачи.
                            </p>
                        </div>
                        <div className={styles.actionButtons}>
                            <Link
                                className={styles.primaryAction}
                                href={{
                                    pathname: "/questionnaire",
                                    query: { style: primary.key, styleLabel: primary.label },
                                }}
                            >
                                Перейти к мебели
                            </Link>
                            <button
                                type="button"
                                className={styles.secondaryAction}
                                onClick={restart}
                            >
                                Начать тест заново
                            </button>
                        </div>
                    </section>
                </main>
                <Footer />
            </div>
        );
    }

    const step = getVisualTestStep(session);
    const progress = Math.round((session.answers.length / VISUAL_TEST_TOTAL_STEPS) * 100);

    return (
        <div className={styles.test}>
            <Navigation />
            <main id="main-content" className={styles.main} tabIndex={-1}>
                <section className={styles.intro} aria-labelledby="test-title">
                    <div>
                        <p className={styles.eyebrow}>ВИЗУАЛЬНЫЕ ПРЕДПОЧТЕНИЯ</p>
                        <h1 id="test-title">Что вам ближе?</h1>
                        <p>
                            Выбирайте интуитивно. Это не научная диагностика: тест замечает
                            визуальные склонности и предлагает направление для дальнейшей работы.
                        </p>
                    </div>
                    <button type="button" className={styles.restartTop} onClick={restart}>
                        Начать заново
                    </button>
                </section>

                <section className={styles.testCard} aria-label="Сравнение изображений">
                    <div className={styles.progressRow}>
                        <p className={styles.progressText} aria-live="polite" aria-atomic="true">
                            Сравнение {step} из {VISUAL_TEST_TOTAL_STEPS}
                        </p>
                        <span>{progress}% пройдено</span>
                    </div>
                    <div
                        className={styles.progressTrack}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={VISUAL_TEST_TOTAL_STEPS}
                        aria-valuenow={session.answers.length}
                        aria-label="Прогресс теста"
                    >
                        <span style={{ width: `${progress}%` }} />
                    </div>

                    <div className={styles.imageBlock}>
                        {session.slots.map((slot, index) => {
                            const categoryDefinition = getCategoryForSlot(session, slot);
                            const side = index === 0 ? "левое" : "правое";
                            return (
                                <button
                                    key={`${session.nodeId}:${session.round}:${slot.key}`}
                                    type="button"
                                    className={styles.imageChoice}
                                    onClick={() => answer({ kind: "choose", key: slot.key })}
                                    aria-label={`Выбрать ${side} изображение`}
                                >
                                    <Image
                                        src={getVisualImagePath(
                                            categoryDefinition,
                                            slot.imageIndex,
                                        )}
                                        alt=""
                                        fill
                                        unoptimized
                                        sizes="(max-width: 767px) 50vw, 50vw"
                                        priority
                                    />
                                    <span aria-hidden="true">{index === 0 ? "А" : "Б"}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className={styles.choiceControls}>
                        <button
                            type="button"
                            className={styles.neutralButton}
                            onClick={() => answer({ kind: "both" })}
                        >
                            Нравятся оба
                        </button>
                        <button
                            type="button"
                            className={styles.neutralButton}
                            onClick={() => answer({ kind: "neither" })}
                        >
                            Не нравится ни один
                        </button>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
};

export default Test;
