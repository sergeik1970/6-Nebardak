import React, { useState, useCallback } from "react";
import Image from "next/image";
import Navigation from "@/shared/components/Navigation";
import Footer from "@/shared/components/Footer";
import styles from "./index.module.scss";

const TOTAL_ROUNDS = 5;

const NATURA_IMAGES = Array.from(
    { length: 13 },
    (_, i) => `/images/Home/test-images/Природа/Природа ${i + 1}.png`,
);

const TECHNO_IMAGES = Array.from(
    { length: 13 },
    (_, i) => `/images/Home/test-images/Техно/Техно ${i + 1}.png`,
);

type Category = "natura" | "techno";

interface RoundLog {
    round: number;
    chosen: Category;
}

interface Pair {
    naturaImg: string;
    technoImg: string;
    naturaOnLeft: boolean;
}

function pickUnused(images: string[], used: string[]): string {
    const available = images.filter((img) => !used.includes(img));
    const pool = available.length > 0 ? available : images;
    return pool[Math.floor(Math.random() * pool.length)];
}

function generatePair(usedNatura: string[], usedTechno: string[]): Pair {
    return {
        naturaImg: pickUnused(NATURA_IMAGES, usedNatura),
        technoImg: pickUnused(TECHNO_IMAGES, usedTechno),
        naturaOnLeft: Math.random() < 0.5,
    };
}

const WINNER_LABEL: Record<Category | "tie", string> = {
    natura: "Тебе ближе природа",
    techno: "Тебе ближе техно",
    tie: "Ничья!",
};

const Test: React.FC = () => {
    const [phase, setPhase] = useState<"test" | "results">("test");
    const [round, setRound] = useState(1);
    const [scores, setScores] = useState<Record<Category, number>>({ natura: 0, techno: 0 });
    const [log, setLog] = useState<RoundLog[]>([]);
    const [usedNatura, setUsedNatura] = useState<string[]>([]);
    const [usedTechno, setUsedTechno] = useState<string[]>([]);
    const [pair, setPair] = useState<Pair>(() => generatePair([], []));

    const handleChoice = useCallback(
        (chosen: Category) => {
            const newScores = { ...scores, [chosen]: scores[chosen] + 1 };
            setScores(newScores);
            setLog((prev) => [...prev, { round, chosen }]);

            if (round >= TOTAL_ROUNDS) {
                setPhase("results");
                return;
            }

            const newUsedNatura = [...usedNatura, pair.naturaImg];
            const newUsedTechno = [...usedTechno, pair.technoImg];
            setUsedNatura(newUsedNatura);
            setUsedTechno(newUsedTechno);
            setPair(generatePair(newUsedNatura, newUsedTechno));
            setRound((r) => r + 1);
        },
        [round, scores, pair, usedNatura, usedTechno],
    );

    const restart = () => {
        setPhase("test");
        setRound(1);
        setScores({ natura: 0, techno: 0 });
        setLog([]);
        setUsedNatura([]);
        setUsedTechno([]);
        setPair(generatePair([], []));
    };

    const winner: Category | "tie" =
        scores.natura > scores.techno
            ? "natura"
            : scores.techno > scores.natura
              ? "techno"
              : "tie";

    const leftCategory: Category = pair.naturaOnLeft ? "natura" : "techno";
    const rightCategory: Category = pair.naturaOnLeft ? "techno" : "natura";
    const leftImg = pair.naturaOnLeft ? pair.naturaImg : pair.technoImg;
    const rightImg = pair.naturaOnLeft ? pair.technoImg : pair.naturaImg;

    return (
        <div className={styles.test}>
            <Navigation />
            <main className={styles.main}>
                <div className={styles.container}>
                    {phase === "test" ? (
                        <>
                            <h1 className={styles.title}>Выбери понравившееся изображение</h1>
                            <p className={styles.progress}>
                                {round} <span>/ {TOTAL_ROUNDS}</span>
                            </p>
                            <div className={styles.imageBlock}>
                                <button
                                    className={styles.imgButton}
                                    onClick={() => handleChoice(leftCategory)}
                                >
                                    <Image src={leftImg} alt="Изображение слева" fill style={{ objectFit: "cover" }} unoptimized />
                                </button>
                                <button
                                    className={styles.imgButton}
                                    onClick={() => handleChoice(rightCategory)}
                                >
                                    <Image src={rightImg} alt="Изображение справа" fill style={{ objectFit: "cover" }} unoptimized />
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className={styles.results}>
                            <h1 className={styles.title}>{WINNER_LABEL[winner]}</h1>
                            <div className={styles.scores}>
                                <div className={styles.scoreItem}>
                                    <span className={styles.scoreLabel}>Природа</span>
                                    <span className={styles.scoreValue}>{scores.natura}</span>
                                </div>
                                <div className={styles.scoreItem}>
                                    <span className={styles.scoreLabel}>Техно</span>
                                    <span className={styles.scoreValue}>{scores.techno}</span>
                                </div>
                            </div>

                            <details className={styles.debugLog}>
                                <summary>Детальный лог (debug)</summary>
                                <ol>
                                    {log.map((entry) => (
                                        <li key={entry.round}>
                                            Раунд {entry.round}:{" "}
                                            <strong>
                                                {entry.chosen === "natura" ? "Природа" : "Техно"}
                                            </strong>
                                        </li>
                                    ))}
                                </ol>
                            </details>

                            <button className={styles.restartButton} onClick={restart}>
                                Пройти ещё раз
                            </button>
                        </div>
                    )}
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Test;
