import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Navigation from "@/shared/components/Navigation";
import Footer from "@/shared/components/Footer";
import styles from "./index.module.scss";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Cat {
    key: string;
    folder: string; // relative to /images/Home/test-images/
    name: string; // image filename prefix (e.g. "Техно" → "Техно 1.png")
    count: number;
    label: string;
}

interface BinaryNode {
    type: "binary";
    left: Cat;
    right: Cat;
    next: (winner: string) => GameNode;
}

interface LeafNode {
    type: "leaf";
    styles: [Cat, Cat, Cat];
}

type GameNode = BinaryNode | LeafNode;

// ─── Helpers ───────────────────────────────────────────────────────────────

const c = (key: string, folder: string, name: string, count: number, label: string): Cat => ({
    key,
    folder,
    name,
    count,
    label,
});

const imgPath = (cat: Cat, n: number) =>
    `/images/Home/test-images/${cat.folder}/${cat.name} ${n}.webp`;

const imageSizes = (slotCount: number) =>
    slotCount === 3 ? "(max-width: 768px) 100vw, 30vw" : "(max-width: 768px) 100vw, 40vw";

function pickUnused(count: number, used: number[]): number {
    const all = Array.from({ length: count }, (_, i) => i + 1);
    const available = all.filter((n) => !used.includes(n));
    const pool = available.length > 0 ? available : all;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Game tree (defined bottom-up) ─────────────────────────────────────────

// Leaf nodes

const LEAF_DIGITAL: LeafNode = {
    type: "leaf",
    styles: [
        c("futorizm", "Футуризм", "Футуризм", 8, "Футуризм"),
        c("cyberpunk", "Киберпанк", "Киберпанк", 8, "Киберпанк"),
        c("dopamine", "Дофаминовый", "Дофаминовый", 8, "Дофаминовый"),
    ],
};

const LEAF_METAL_STYLE: LeafNode = {
    type: "leaf",
    styles: [
        c("loft", "Лофт", "Лофт", 8, "Лофт"),
        c("techno_leaf", "Техно", "Техно", 13, "Техно"),
        c("hightech", "Хайтек", "Хайтек", 8, "Хайтек"),
    ],
};

const LEAF_NOSTALGIA: LeafNode = {
    type: "leaf",
    styles: [
        c("retrofuturism", "Ретрофутуризм", "Ретрофутуризм", 8, "Ретрофутуризм"),
        c("grunge", "Гранж", "Гранж", 8, "Гранж"),
        c("bauhaus", "Баухаус", "Баухаус", 8, "Баухаус"),
    ],
};

const LEAF_ORDER: LeafNode = {
    type: "leaf",
    styles: [
        c("minimalism", "Минимализм", "Минимализм", 8, "Минимализм"),
        c("eclectic", "Эклектика", "Эклектика", 8, "Эклектика"),
        c("contemporary", "Контемпорари", "Контемпорари", 8, "Контемпорари"),
    ],
};

const LEAF_NORTH: LeafNode = {
    type: "leaf",
    styles: [
        c("russian", "Русский", "Русский", 8, "Русский"),
        c("scandinavian", "Скандинавский", "Скандинавский", 8, "Скандинавский"),
        c("country", "Кантри", "Кантри", 8, "Кантри"),
    ],
};

const LEAF_SOUTH: LeafNode = {
    type: "leaf",
    styles: [
        c("japanese", "Японский", "Японский", 8, "Японский"),
        c("provence", "Прованс", "Прованс", 8, "Прованс"),
        c("mediterranean", "Средиземноморский", "Средиземноморский", 8, "Средиземноморский"),
    ],
};

const LEAF_SPIRIT: LeafNode = {
    type: "leaf",
    styles: [
        c("rustic", "Рустик", "Рустик", 8, "Рустик"),
        c("wabisabi", "Ваби-саби", "Ваби-саби", 8, "Ваби-саби"),
        c("eco", "Эко", "Эко", 8, "Эко"),
    ],
};

const LEAF_BIO: LeafNode = {
    type: "leaf",
    styles: [
        c("biodesign", "Биодизайн", "Биодизайн", 8, "Биодизайн"),
        c("boho", "Бохо-шик", "Бохо-шик", 8, "Бохо-шик"),
        c("tropical", "Тропический", "Тропический", 8, "Тропический"),
    ],
};

// Level 2 binary nodes

const LEVEL2_MEGAPOLIS: BinaryNode = {
    type: "binary",
    left: c("digital", "1.2 Цифровой", "Цифровой", 7, "Цифровой"),
    right: c("metal", "1.2 Металл", "Металл", 7, "Металл"),
    next: (w) => (w === "digital" ? LEAF_DIGITAL : LEAF_METAL_STYLE),
};

const LEVEL2_GORODOK: BinaryNode = {
    type: "binary",
    left: c("nostalgia", "1.2 Ностальгия", "Ностальгия", 7, "Ностальгия"),
    right: c("order", "1.2 Порядок", "Порядок", 7, "Порядок"),
    next: (w) => (w === "nostalgia" ? LEAF_NOSTALGIA : LEAF_ORDER),
};

const LEVEL2_ETHNO: BinaryNode = {
    type: "binary",
    left: c("north", "2.2 Север", "Север", 7, "Север"),
    right: c("south", "2.2 Юг", "Юг", 7, "Юг"),
    next: (w) => (w === "north" ? LEAF_NORTH : LEAF_SOUTH),
};

const LEVEL2_PLANTS: BinaryNode = {
    type: "binary",
    left: c("spirit", "2.2 Дух", "Дух", 7, "Дух"),
    right: c("biosphere", "2.2 Биосфера", "Биосфера", 7, "Биосфера"),
    next: (w) => (w === "spirit" ? LEAF_SPIRIT : LEAF_BIO),
};

// Level 1 binary nodes

const LEVEL1_TECHNO: BinaryNode = {
    type: "binary",
    left: c("megapolis", "1.1 Мегаполис", "Мегаполис", 7, "Мегаполис"),
    right: c("gorodok", "1.1 Городок", "Городок", 7, "Городок"),
    next: (w) => (w === "megapolis" ? LEVEL2_MEGAPOLIS : LEVEL2_GORODOK),
};

const LEVEL1_NATURE: BinaryNode = {
    type: "binary",
    left: c("ethno", "2.1 Этно", "Этно", 11, "Этно"),
    right: c("plants", "2.1 Растения", "Растения", 11, "Растения"),
    next: (w) => (w === "ethno" ? LEVEL2_ETHNO : LEVEL2_PLANTS),
};

// Root

const ROOT_NODE: BinaryNode = {
    type: "binary",
    left: c("techno", "1.0 Техно", "Техно", 13, "Техно"),
    right: c("natura", "2.0 Природа", "Природа", 13, "Природа"),
    next: (w) => (w === "techno" ? LEVEL1_TECHNO : LEVEL1_NATURE),
};

// ─── Game config ───────────────────────────────────────────────────────────

const BINARY_ROUNDS = 5;
const BINARY_WIN = 3;
const LEAF_ROUNDS = 5;
const LEAF_PAIR_SEQUENCE: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
    [0, 1],
    [1, 2],
];

// ─── Slot / State ──────────────────────────────────────────────────────────

interface Slot {
    cat: Cat;
    imgIndex: number;
}

interface GameState {
    phase: "playing" | "results";
    node: GameNode;
    round: number;
    scores: Record<string, number>;
    usedImages: Record<string, number[]>; // folder → used indices
    slots: Slot[];
    winnerKey?: string;
}

interface PreparedAdvance {
    node: GameNode;
    slots: Slot[];
}

interface PreparedRound {
    usedAfterRound: Record<string, number[]>;
    continueSlots?: Slot[];
    advanceByWinner?: Record<string, PreparedAdvance>;
}

function getRoundCats(node: GameNode, round: number): Cat[] {
    if (node.type === "binary") return [node.left, node.right];

    const pair = LEAF_PAIR_SEQUENCE[Math.min(round - 1, LEAF_PAIR_SEQUENCE.length - 1)];
    return [node.styles[pair[0]], node.styles[pair[1]]];
}

function buildSlots(node: GameNode, used: Record<string, number[]>, round: number): Slot[] {
    const cats: Cat[] = getRoundCats(node, round);

    // Shuffle positions so categories don't always appear on the same side
    for (let i = cats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cats[i], cats[j]] = [cats[j], cats[i]];
    }

    return cats.map((cat) => ({
        cat,
        imgIndex: pickUnused(cat.count, used[cat.folder] ?? []),
    }));
}

function markSlotsAsUsed(used: Record<string, number[]>, slots: Slot[]): Record<string, number[]> {
    const nextUsed = { ...used };

    for (const slot of slots) {
        const arr = nextUsed[slot.cat.folder] ? [...nextUsed[slot.cat.folder]] : [];
        if (!arr.includes(slot.imgIndex)) arr.push(slot.imgIndex);
        nextUsed[slot.cat.folder] = arr;
    }

    return nextUsed;
}

function prepareRound(
    node: GameNode,
    used: Record<string, number[]>,
    slots: Slot[],
    round: number,
): PreparedRound {
    const usedAfterRound = markSlotsAsUsed(used, slots);

    if (node.type === "binary") {
        const continueSlots = buildSlots(node, usedAfterRound, round + 1);
        const leftAdvanceNode = node.next(node.left.key);
        const rightAdvanceNode = node.next(node.right.key);

        return {
            usedAfterRound,
            continueSlots,
            advanceByWinner: {
                [node.left.key]: {
                    node: leftAdvanceNode,
                    slots: buildSlots(leftAdvanceNode, usedAfterRound, 1),
                },
                [node.right.key]: {
                    node: rightAdvanceNode,
                    slots: buildSlots(rightAdvanceNode, usedAfterRound, 1),
                },
            },
        };
    }

    return {
        usedAfterRound,
        continueSlots: buildSlots(node, usedAfterRound, round + 1),
    };
}

function initState(): GameState {
    const node = ROOT_NODE;
    const used: Record<string, number[]> = {};
    return {
        phase: "playing",
        node,
        round: 1,
        scores: {},
        usedImages: used,
        slots: buildSlots(node, used, 1),
    };
}

// ─── Component ─────────────────────────────────────────────────────────────

const Test: React.FC = () => {
    const [state, setState] = useState<GameState>(initState);
    const preloadedUrlsRef = useRef<Set<string>>(new Set());

    const preparedRound =
        state.phase === "playing"
            ? prepareRound(state.node, state.usedImages, state.slots, state.round)
            : null;

    useEffect(() => {
        if (!preparedRound) return;

        const urls = new Set<string>();

        for (const slot of state.slots) {
            urls.add(imgPath(slot.cat, slot.imgIndex));
        }

        if (preparedRound.continueSlots) {
            for (const slot of preparedRound.continueSlots) {
                urls.add(imgPath(slot.cat, slot.imgIndex));
            }
        }

        if (preparedRound.advanceByWinner) {
            for (const advance of Object.values(preparedRound.advanceByWinner)) {
                for (const slot of advance.slots) {
                    urls.add(imgPath(slot.cat, slot.imgIndex));
                }
            }
        }

        urls.forEach((url) => {
            if (preloadedUrlsRef.current.has(url)) return;

            const image = new window.Image();
            image.decoding = "async";
            image.src = url;
            preloadedUrlsRef.current.add(url);
        });
    }, [preparedRound, state.slots]);

    const handleChoice = useCallback((chosenKey: string) => {
        setState((prev) => {
            if (prev.phase === "results") return prev;

            const prepared = prepareRound(prev.node, prev.usedImages, prev.slots, prev.round);

            // Update scores
            const newScores: Record<string, number> = {
                ...prev.scores,
                [chosenKey]: (prev.scores[chosenKey] ?? 0) + 1,
            };
            const newUsed = prepared.usedAfterRound;

            if (prev.node.type === "binary") {
                const { left, right, next } = prev.node;
                const ls = newScores[left.key] ?? 0;
                const rs = newScores[right.key] ?? 0;
                const done = ls >= BINARY_WIN || rs >= BINARY_WIN || prev.round >= BINARY_ROUNDS;

                if (done) {
                    // Advance to next node
                    const winnerKey = ls >= rs ? left.key : right.key;
                    const preparedAdvance = prepared.advanceByWinner?.[winnerKey];
                    const nextNode = preparedAdvance?.node ?? next(winnerKey);
                    return {
                        phase: "playing",
                        node: nextNode,
                        round: 1,
                        scores: {},
                        usedImages: newUsed,
                        slots: preparedAdvance?.slots ?? buildSlots(nextNode, newUsed, 1),
                    };
                }

                return {
                    ...prev,
                    round: prev.round + 1,
                    scores: newScores,
                    usedImages: newUsed,
                    slots: prepared.continueSlots ?? buildSlots(prev.node, newUsed, prev.round + 1),
                };
            }

            // Leaf (3-way)
            if (prev.round >= LEAF_ROUNDS) {
                const winner = prev.node.styles.reduce((best, s) =>
                    (newScores[s.key] ?? 0) > (newScores[best.key] ?? 0) ? s : best,
                );
                return {
                    ...prev,
                    phase: "results",
                    scores: newScores,
                    usedImages: newUsed,
                    winnerKey: winner.key,
                };
            }

            return {
                ...prev,
                round: prev.round + 1,
                scores: newScores,
                usedImages: newUsed,
                slots: prepared.continueSlots ?? buildSlots(prev.node, newUsed, prev.round + 1),
            };
        });
    }, []);

    const restart = useCallback(() => setState(initState), []);

    // Results screen
    if (state.phase === "results" && state.node.type === "leaf") {
        const winner = state.node.styles.find((s) => s.key === state.winnerKey);
        return (
            <div className={styles.test}>
                <Navigation />
                <main className={styles.main}>
                    <div className={styles.container}>
                        <div className={styles.results}>
                            <h1 className={styles.title}>Твой стиль: {winner?.label}</h1>
                            <button className={styles.restartButton} onClick={restart}>
                                Пройти ещё раз
                            </button>
                        </div>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    const isLeaf = state.node.type === "leaf";
    const totalRounds = isLeaf ? LEAF_ROUNDS : BINARY_ROUNDS;

    const battleLabel = state.slots.map((slot) => slot.cat.label).join(" vs ");

    return (
        <div className={styles.test}>
            <Navigation />
            <main className={styles.main}>
                <div className={styles.container}>
                    <h1 className={styles.title}>Выбери понравившееся изображение</h1>
                    <p className={styles.battle}>{battleLabel}</p>
                    <p className={styles.progress}>
                        {state.round} <span>/ {totalRounds}</span>
                    </p>
                    <div
                        className={`${styles.imageBlock} ${
                            state.slots.length === 3 ? styles.threeWay : ""
                        }`}
                    >
                        {state.slots.map((slot) => (
                            <button
                                key={slot.cat.key}
                                className={styles.imgButton}
                                onClick={() => handleChoice(slot.cat.key)}
                            >
                                <Image
                                    src={imgPath(slot.cat, slot.imgIndex)}
                                    alt={slot.cat.label}
                                    fill
                                    unoptimized
                                    sizes={imageSizes(state.slots.length)}
                                    quality={70}
                                    priority
                                    style={{ objectFit: "cover" }}
                                />
                            </button>
                        ))}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Test;
