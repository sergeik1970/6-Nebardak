export const VISUAL_TEST_SESSION_VERSION = 2 as const;
export const VISUAL_TEST_SESSION_KEY = "stylefinder:visual-preference:v2";
export const VISUAL_TEST_TOTAL_STEPS = 18;
export const VISUAL_TEST_MAX_PRELOAD_URLS = 4;

export type NodeId =
    | "root"
    | "urban"
    | "nature"
    | "megapolis"
    | "town"
    | "ethno"
    | "plants"
    | "digital-styles"
    | "metal-styles"
    | "nostalgia-styles"
    | "order-styles"
    | "north-styles"
    | "south-styles"
    | "spirit-styles"
    | "bio-styles";

export interface VisualCategory {
    key: string;
    folder: string;
    imageName: string;
    imageCount: number;
}

export interface StyleProfile extends VisualCategory {
    label: string;
    signals: [string, string, string];
    palette: [string, string, string, string];
    materials: [string, string, string];
}

interface BinaryNode {
    type: "binary";
    categories: [VisualCategory, VisualCategory];
    nextByWinner: Record<string, NodeId>;
}

interface FinalNode {
    type: "final";
    categories: [StyleProfile, StyleProfile, StyleProfile];
}

type TestNode = BinaryNode | FinalNode;

export interface VisualSlot {
    key: string;
    imageIndex: number;
}

export type TestResponse = { kind: "choose"; key: string } | { kind: "both" } | { kind: "neither" };

export interface AnswerRecord {
    nodeId: NodeId;
    round: number;
    slotKeys: [string, string];
    response: TestResponse;
}

export interface VisualTestResult {
    primaryKey: string;
    nearbyKeys: [string, string];
    confidenceScore: number;
    confidenceLabel: "мягкий сигнал" | "умеренный сигнал" | "выраженный сигнал";
    influences: [string, string, string];
    palette: [string, string, string, string];
    materials: [string, string, string];
}

interface SessionSnapshot {
    phase: "playing" | "results";
    nodeId: NodeId;
    round: number;
    scores: Record<string, number>;
    usedImages: Record<string, number[]>;
    slots: [VisualSlot, VisualSlot];
    result?: VisualTestResult;
}

export interface VisualTestSession extends SessionSnapshot {
    version: typeof VISUAL_TEST_SESSION_VERSION;
    seed: number;
    answers: AnswerRecord[];
    history: SessionSnapshot[];
}

export interface SessionStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const category = (
    key: string,
    folder: string,
    imageName: string,
    imageCount: number,
): VisualCategory => ({ key, folder, imageName, imageCount });

const style = (
    key: string,
    folder: string,
    imageName: string,
    label: string,
    signals: StyleProfile["signals"],
    palette: StyleProfile["palette"],
    materials: StyleProfile["materials"],
): StyleProfile => ({
    key,
    folder,
    imageName,
    imageCount: 8,
    label,
    signals,
    palette,
    materials,
});

export const STYLE_PROFILES: Record<string, StyleProfile> = {
    futorizm: style(
        "futorizm",
        "Футуризм",
        "Футуризм",
        "Футуризм",
        ["плавные силуэты", "световые акценты", "пространство без визуального шума"],
        ["#F4F2EE", "#BBC5CC", "#707B84", "#252A31"],
        ["стекло", "полированный металл", "гладкий пластик"],
    ),
    cyberpunk: style(
        "cyberpunk",
        "Киберпанк",
        "Киберпанк",
        "Киберпанк",
        ["контрастный неон", "тёмная основа", "технологичные детали"],
        ["#17141F", "#7B35FF", "#00C8C8", "#E65A8D"],
        ["чёрный металл", "тонированное стекло", "сетчатые фактуры"],
    ),
    dopamine: style(
        "dopamine",
        "Дофаминовый",
        "Дофаминовый",
        "Дофаминовый интерьер",
        ["чистые яркие цвета", "игровые формы", "смелые сочетания"],
        ["#FF6B52", "#FFCF45", "#5AA9E6", "#7BC67B"],
        ["цветной текстиль", "глянцевая керамика", "окрашенное дерево"],
    ),
    loft: style(
        "loft",
        "Лофт",
        "Лофт",
        "Лофт",
        ["открытая конструкция", "грубые фактуры", "крупный масштаб"],
        ["#2E2B29", "#7D6653", "#B37A52", "#D5CEC3"],
        ["кирпич", "чёрный металл", "состаренное дерево"],
    ),
    techno_leaf: style(
        "techno_leaf",
        "Техно",
        "Техно",
        "Техно",
        ["точная геометрия", "инженерная эстетика", "холодные нейтрали"],
        ["#E7E9EA", "#A8B0B5", "#59636A", "#1D2327"],
        ["алюминий", "стекло", "микроцемент"],
    ),
    hightech: style(
        "hightech",
        "Хайтек",
        "Хайтек",
        "Хай-тек",
        ["лаконичные поверхности", "встроенный свет", "функциональные детали"],
        ["#F7F8F8", "#CCD2D6", "#69747C", "#171B1E"],
        ["хром", "стекло", "глянцевые панели"],
    ),
    retrofuturism: style(
        "retrofuturism",
        "Ретрофутуризм",
        "Ретрофутуризм",
        "Ретрофутуризм",
        ["округлая геометрия", "винтажные цвета", "оптимистичные детали"],
        ["#E9D8B4", "#D57955", "#719A9A", "#5B4651"],
        ["цветной пластик", "шпон", "рифлёное стекло"],
    ),
    grunge: style(
        "grunge",
        "Гранж",
        "Гранж",
        "Гранж",
        ["необработанные поверхности", "приглушённый контраст", "неформальная композиция"],
        ["#262421", "#625B51", "#948573", "#C6BBAA"],
        ["потёртая кожа", "бетон", "тёмное дерево"],
    ),
    bauhaus: style(
        "bauhaus",
        "Баухаус",
        "Баухаус",
        "Баухаус",
        ["простые формы", "функция как декор", "точечный основной цвет"],
        ["#F0EDE4", "#D94B3D", "#E1B82F", "#2E4C68"],
        ["трубчатый металл", "фанера", "плотный текстиль"],
    ),
    minimalism: style(
        "minimalism",
        "Минимализм",
        "Минимализм",
        "Минимализм",
        ["много воздуха", "скрытое хранение", "спокойный ритм"],
        ["#F6F3EC", "#DDD8CE", "#AAA397", "#4F4B45"],
        ["светлое дерево", "матовая штукатурка", "лён"],
    ),
    eclectic: style(
        "eclectic",
        "Эклектика",
        "Эклектика",
        "Эклектика",
        ["смешение эпох", "выразительные предметы", "сложный цвет"],
        ["#334B47", "#B65D45", "#D2A74C", "#E3D5C1"],
        ["бархат", "латунь", "узорчатая керамика"],
    ),
    contemporary: style(
        "contemporary",
        "Контемпорари",
        "Контемпорари",
        "Контемпорари",
        ["современная база", "мягкие линии", "умеренные акценты"],
        ["#F1EEE8", "#C8B9A7", "#7E8A82", "#4B4B49"],
        ["шпон", "букле", "матовый металл"],
    ),
    russian: style(
        "russian",
        "Русский",
        "Русский",
        "Русский стиль",
        ["ремесленные детали", "насыщенное дерево", "традиционный орнамент"],
        ["#F2E2C5", "#B36B3F", "#6E342D", "#315D53"],
        ["массив дерева", "лён", "расписная керамика"],
    ),
    scandinavian: style(
        "scandinavian",
        "Скандинавский",
        "Скандинавский",
        "Скандинавский стиль",
        ["светлая база", "практичная простота", "уютный текстиль"],
        ["#F7F4EC", "#D9CDBD", "#9EAD9D", "#59645C"],
        ["светлая древесина", "шерсть", "матовая керамика"],
    ),
    country: style(
        "country",
        "Кантри",
        "Кантри",
        "Кантри",
        ["домашний уют", "простые формы", "природная палитра"],
        ["#F1E2C8", "#C5A470", "#80906C", "#76584A"],
        ["сосна", "хлопок", "плетение"],
    ),
    japanese: style(
        "japanese",
        "Японский",
        "Японский",
        "Японский стиль",
        ["низкие горизонтали", "паузы между предметами", "сдержанный контраст"],
        ["#E9E1D2", "#B8A488", "#6D715D", "#332F2A"],
        ["бамбук", "бумага", "тёмное дерево"],
    ),
    provence: style(
        "provence",
        "Прованс",
        "Прованс",
        "Прованс",
        ["мягкие пастели", "светлая мебель", "деликатный растительный мотив"],
        ["#F6EEE3", "#D8C5D5", "#A9B89A", "#B58A6B"],
        ["белёное дерево", "лён", "светлая керамика"],
    ),
    mediterranean: style(
        "mediterranean",
        "Средиземноморский",
        "Средиземноморский",
        "Средиземноморский стиль",
        ["солнечные нейтрали", "ручные фактуры", "синие акценты"],
        ["#F4E2C2", "#C98252", "#3E7E93", "#F8F5EC"],
        ["терракота", "светлая штукатурка", "плетёные волокна"],
    ),
    rustic: style(
        "rustic",
        "Рустик",
        "Рустик",
        "Рустик",
        ["выразительная древесина", "простые массивные формы", "землистые оттенки"],
        ["#D8C3A5", "#9B7653", "#5C493A", "#6E755B"],
        ["необработанное дерево", "камень", "грубый лён"],
    ),
    wabisabi: style(
        "wabisabi",
        "Ваби-саби",
        "Ваби-саби",
        "Ваби-саби",
        ["естественная неровность", "тихая палитра", "ценность следов времени"],
        ["#E2D8C8", "#B5A590", "#777064", "#46423C"],
        ["глина", "состаренное дерево", "небелёный лён"],
    ),
    eco: style(
        "eco",
        "Эко",
        "Эко",
        "Экостиль",
        ["природная палитра", "тактильные поверхности", "много живой зелени"],
        ["#E8E1CF", "#B7A67C", "#79906A", "#3F5B45"],
        ["пробка", "дерево", "растительные волокна"],
    ),
    biodesign: style(
        "biodesign",
        "Биодизайн",
        "Биодизайн",
        "Биодизайн",
        ["органические формы", "интегрированная зелень", "современные биоматериалы"],
        ["#E6E8D8", "#A8BE91", "#5E8065", "#344C3C"],
        ["биокомпозит", "стекло", "живые растения"],
    ),
    boho: style(
        "boho",
        "Бохо-шик",
        "Бохо-шик",
        "Бохо-шик",
        ["слоистый текстиль", "ручной декор", "тёплая свободная композиция"],
        ["#E8D1B3", "#C87A55", "#8A6A7A", "#65785E"],
        ["макраме", "ротанг", "узорчатый текстиль"],
    ),
    tropical: style(
        "tropical",
        "Тропический",
        "Тропический",
        "Тропический стиль",
        ["крупная зелень", "сочные акценты", "отпускное настроение"],
        ["#F5E4B8", "#EF8B5A", "#3D8B68", "#1F5A49"],
        ["ротанг", "цветной хлопок", "тёмное дерево"],
    ),
};

const NODES: Record<NodeId, TestNode> = {
    root: {
        type: "binary",
        categories: [
            category("techno", "1.0 Техно", "Техно", 13),
            category("natura", "2.0 Природа", "Природа", 13),
        ],
        nextByWinner: { techno: "urban", natura: "nature" },
    },
    urban: {
        type: "binary",
        categories: [
            category("megapolis", "1.1 Мегаполис", "Мегаполис", 7),
            category("town", "1.1 Городок", "Городок", 7),
        ],
        nextByWinner: { megapolis: "megapolis", town: "town" },
    },
    nature: {
        type: "binary",
        categories: [
            category("ethno", "2.1 Этно", "Этно", 11),
            category("plants", "2.1 Растения", "Растения", 11),
        ],
        nextByWinner: { ethno: "ethno", plants: "plants" },
    },
    megapolis: {
        type: "binary",
        categories: [
            category("digital", "1.2 Цифровой", "Цифровой", 7),
            category("metal", "1.2 Металл", "Металл", 7),
        ],
        nextByWinner: { digital: "digital-styles", metal: "metal-styles" },
    },
    town: {
        type: "binary",
        categories: [
            category("nostalgia", "1.2 Ностальгия", "Ностальгия", 7),
            category("order", "1.2 Порядок", "Порядок", 7),
        ],
        nextByWinner: { nostalgia: "nostalgia-styles", order: "order-styles" },
    },
    ethno: {
        type: "binary",
        categories: [
            category("north", "2.2 Север", "Север", 7),
            category("south", "2.2 Юг", "Юг", 7),
        ],
        nextByWinner: { north: "north-styles", south: "south-styles" },
    },
    plants: {
        type: "binary",
        categories: [
            category("spirit", "2.2 Дух", "Дух", 7),
            category("biosphere", "2.2 Биосфера", "Биосфера", 7),
        ],
        nextByWinner: { spirit: "spirit-styles", biosphere: "bio-styles" },
    },
    "digital-styles": {
        type: "final",
        categories: [STYLE_PROFILES.futorizm, STYLE_PROFILES.cyberpunk, STYLE_PROFILES.dopamine],
    },
    "metal-styles": {
        type: "final",
        categories: [STYLE_PROFILES.loft, STYLE_PROFILES.techno_leaf, STYLE_PROFILES.hightech],
    },
    "nostalgia-styles": {
        type: "final",
        categories: [STYLE_PROFILES.retrofuturism, STYLE_PROFILES.grunge, STYLE_PROFILES.bauhaus],
    },
    "order-styles": {
        type: "final",
        categories: [
            STYLE_PROFILES.minimalism,
            STYLE_PROFILES.eclectic,
            STYLE_PROFILES.contemporary,
        ],
    },
    "north-styles": {
        type: "final",
        categories: [STYLE_PROFILES.russian, STYLE_PROFILES.scandinavian, STYLE_PROFILES.country],
    },
    "south-styles": {
        type: "final",
        categories: [
            STYLE_PROFILES.japanese,
            STYLE_PROFILES.provence,
            STYLE_PROFILES.mediterranean,
        ],
    },
    "spirit-styles": {
        type: "final",
        categories: [STYLE_PROFILES.rustic, STYLE_PROFILES.wabisabi, STYLE_PROFILES.eco],
    },
    "bio-styles": {
        type: "final",
        categories: [STYLE_PROFILES.biodesign, STYLE_PROFILES.boho, STYLE_PROFILES.tropical],
    },
};

const FINAL_PAIR_SCHEDULE: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
    [0, 1],
    [0, 2],
    [1, 2],
];

const BINARY_ROUNDS = 4;
const FINAL_ROUNDS = FINAL_PAIR_SCHEDULE.length;

function hashSeed(seed: number, value: string): number {
    let hash = seed ^ 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

function seededIndex(length: number, seed: number, scope: string): number {
    if (length <= 1) return 0;
    return hashSeed(seed, scope) % length;
}

function getRoundCategories(nodeId: NodeId, round: number): [VisualCategory, VisualCategory] {
    const node = NODES[nodeId];
    if (node.type === "binary") return [...node.categories];

    const pair = FINAL_PAIR_SCHEDULE[round];
    return [node.categories[pair[0]], node.categories[pair[1]]];
}

function pairOccurrence(nodeId: NodeId, round: number, keys: [string, string]): number {
    let occurrence = 0;
    const target = [...keys].sort().join(":");

    for (let priorRound = 0; priorRound < round; priorRound += 1) {
        const priorKeys = getRoundCategories(nodeId, priorRound)
            .map((item) => item.key)
            .sort()
            .join(":");
        if (priorKeys === target) occurrence += 1;
    }

    return occurrence;
}

function orderedRoundCategories(
    nodeId: NodeId,
    round: number,
    seed: number,
): [VisualCategory, VisualCategory] {
    const categories = getRoundCategories(nodeId, round);
    const sortedKeys = categories
        .map((item) => item.key)
        .sort()
        .join(":");
    const baseFlip = seededIndex(2, seed, `${nodeId}:${sortedKeys}:side`);
    const occurrence = pairOccurrence(nodeId, round, [categories[0].key, categories[1].key]);

    return (baseFlip + occurrence) % 2 === 0 ? categories : [categories[1], categories[0]];
}

function pickImageIndex(
    categoryDefinition: VisualCategory,
    usedImages: Record<string, number[]>,
    seed: number,
    scope: string,
): number {
    const all = Array.from({ length: categoryDefinition.imageCount }, (_, index) => index + 1);
    const used = usedImages[categoryDefinition.folder] ?? [];
    const available = all.filter((index) => !used.includes(index));
    const pool = available.length > 0 ? available : all;
    return pool[seededIndex(pool.length, seed, `${scope}:${used.join("-")}`)];
}

function buildSlots(
    nodeId: NodeId,
    round: number,
    seed: number,
    usedImages: Record<string, number[]>,
): [VisualSlot, VisualSlot] {
    const categories = orderedRoundCategories(nodeId, round, seed);
    return categories.map((categoryDefinition) => ({
        key: categoryDefinition.key,
        imageIndex: pickImageIndex(
            categoryDefinition,
            usedImages,
            seed,
            `${nodeId}:${round}:${categoryDefinition.key}`,
        ),
    })) as [VisualSlot, VisualSlot];
}

function copyScores(scores: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, value]));
}

function copyUsedImages(usedImages: Record<string, number[]>): Record<string, number[]> {
    return Object.fromEntries(
        Object.entries(usedImages).map(([folder, values]) => [folder, [...values]]),
    );
}

function copySlots(slots: [VisualSlot, VisualSlot]): [VisualSlot, VisualSlot] {
    return slots.map((slot) => ({ ...slot })) as [VisualSlot, VisualSlot];
}

function copyResult(result: VisualTestResult | undefined): VisualTestResult | undefined {
    if (!result) return undefined;
    return {
        ...result,
        nearbyKeys: [...result.nearbyKeys],
        influences: [...result.influences],
        palette: [...result.palette],
        materials: [...result.materials],
    };
}

function snapshotOf(session: VisualTestSession): SessionSnapshot {
    const snapshot: SessionSnapshot = {
        phase: session.phase,
        nodeId: session.nodeId,
        round: session.round,
        scores: copyScores(session.scores),
        usedImages: copyUsedImages(session.usedImages),
        slots: copySlots(session.slots),
    };
    const result = copyResult(session.result);
    if (result) snapshot.result = result;
    return snapshot;
}

function markCurrentImagesUsed(session: VisualTestSession): Record<string, number[]> {
    const usedImages = copyUsedImages(session.usedImages);
    const categories = new Map(
        getRoundCategories(session.nodeId, session.round).map((item) => [item.key, item]),
    );

    for (const slot of session.slots) {
        const folder = categories.get(slot.key)?.folder;
        if (!folder) continue;
        const values = usedImages[folder] ? [...usedImages[folder]] : [];
        if (!values.includes(slot.imageIndex)) values.push(slot.imageIndex);
        usedImages[folder] = values;
    }

    return usedImages;
}

function scoreResponse(
    scores: Record<string, number>,
    slots: [VisualSlot, VisualSlot],
    response: TestResponse,
): Record<string, number> {
    const nextScores = copyScores(scores);

    if (response.kind === "choose") {
        nextScores[response.key] = (nextScores[response.key] ?? 0) + 1;
    } else if (response.kind === "both") {
        for (const slot of slots) nextScores[slot.key] = (nextScores[slot.key] ?? 0) + 0.5;
    }

    return nextScores;
}

function rankedCategories(
    categories: readonly VisualCategory[],
    scores: Record<string, number>,
    seed: number,
    scope: string,
): VisualCategory[] {
    return [...categories].sort((first, second) => {
        const scoreDifference = (scores[second.key] ?? 0) - (scores[first.key] ?? 0);
        if (scoreDifference !== 0) return scoreDifference;
        const firstTie = hashSeed(seed, `${scope}:${first.key}`);
        const secondTie = hashSeed(seed, `${scope}:${second.key}`);
        if (firstTie !== secondTie) return firstTie - secondTie;
        return first.key.localeCompare(second.key);
    });
}

function makeResult(session: VisualTestSession, scores: Record<string, number>): VisualTestResult {
    const node = NODES[session.nodeId];
    if (node.type !== "final") throw new Error("Result can only be created for a final node");

    const ranking = rankedCategories(node.categories, scores, session.seed, session.nodeId);
    const primary = STYLE_PROFILES[ranking[0].key];
    const finalAnswers = session.answers.filter((answer) => answer.nodeId === session.nodeId);
    const decisiveCount = finalAnswers.filter((answer) => answer.response.kind === "choose").length;
    const bothCount = finalAnswers.filter((answer) => answer.response.kind === "both").length;
    const neitherCount = finalAnswers.filter((answer) => answer.response.kind === "neither").length;
    const scoreMargin = (scores[ranking[0].key] ?? 0) - (scores[ranking[1].key] ?? 0);
    const confidenceScore = Math.max(
        18,
        Math.min(
            88,
            Math.round(28 + decisiveCount * 6 + scoreMargin * 8 - bothCount * 3 - neitherCount * 4),
        ),
    );
    const confidenceLabel =
        confidenceScore >= 72
            ? "выраженный сигнал"
            : confidenceScore >= 48
              ? "умеренный сигнал"
              : "мягкий сигнал";

    return {
        primaryKey: primary.key,
        nearbyKeys: [ranking[1].key, ranking[2].key],
        confidenceScore,
        confidenceLabel,
        influences: [
            primary.signals[0],
            decisiveCount >= 4
                ? "в большинстве финальных пар был выбран один вариант"
                : "несколько финальных пар оказались равно близкими",
            scoreMargin > 0
                ? `основное направление опередило ближайшее на ${scoreMargin.toLocaleString("ru-RU")} балла`
                : "два направления получили одинаковый балл; порядок определён по seed",
        ],
        palette: [...primary.palette],
        materials: [...primary.materials],
    };
}

export function createVisualTestSession(seed: number): VisualTestSession {
    const normalizedSeed = Number.isSafeInteger(seed) && seed > 0 ? seed >>> 0 || 1 : 1;
    const usedImages: Record<string, number[]> = {};
    return {
        version: VISUAL_TEST_SESSION_VERSION,
        phase: "playing",
        seed: normalizedSeed,
        nodeId: "root",
        round: 0,
        scores: {},
        usedImages,
        slots: buildSlots("root", 0, normalizedSeed, usedImages),
        answers: [],
        history: [],
    };
}

export function answerVisualTest(
    session: VisualTestSession,
    response: TestResponse,
): VisualTestSession {
    if (session.phase !== "playing") return session;
    if (response.kind === "choose" && !session.slots.some((slot) => slot.key === response.key)) {
        throw new Error("The chosen category is not on the current screen");
    }

    const node = NODES[session.nodeId];
    const nextScores = scoreResponse(session.scores, session.slots, response);
    const usedImages = markCurrentImagesUsed(session);
    const answer: AnswerRecord = {
        nodeId: session.nodeId,
        round: session.round,
        slotKeys: session.slots.map((slot) => slot.key) as [string, string],
        response: { ...response },
    };
    const answers = [...session.answers, answer];
    const history = [...session.history, snapshotOf(session)];
    const roundCount = node.type === "binary" ? BINARY_ROUNDS : FINAL_ROUNDS;

    if (session.round + 1 < roundCount) {
        return {
            ...session,
            round: session.round + 1,
            scores: nextScores,
            usedImages,
            slots: buildSlots(session.nodeId, session.round + 1, session.seed, usedImages),
            answers,
            history,
        };
    }

    if (node.type === "binary") {
        const winner = rankedCategories(
            node.categories,
            nextScores,
            session.seed,
            session.nodeId,
        )[0];
        const nextNodeId = node.nextByWinner[winner.key];
        return {
            ...session,
            nodeId: nextNodeId,
            round: 0,
            scores: {},
            usedImages,
            slots: buildSlots(nextNodeId, 0, session.seed, usedImages),
            answers,
            history,
        };
    }

    const withAnswer = { ...session, answers };
    return {
        ...session,
        phase: "results",
        scores: nextScores,
        usedImages,
        answers,
        history,
        result: makeResult(withAnswer, nextScores),
    };
}

export function undoVisualTest(session: VisualTestSession): VisualTestSession {
    const previous = session.history.at(-1);
    if (!previous) return session;

    const restored: VisualTestSession = {
        version: VISUAL_TEST_SESSION_VERSION,
        seed: session.seed,
        phase: previous.phase,
        nodeId: previous.nodeId,
        round: previous.round,
        scores: copyScores(previous.scores),
        usedImages: copyUsedImages(previous.usedImages),
        slots: copySlots(previous.slots),
        answers: session.answers.slice(0, -1),
        history: session.history.slice(0, -1),
    };
    const result = copyResult(previous.result);
    if (result) restored.result = result;
    return restored;
}

export function getCategoryForSlot(session: VisualTestSession, slot: VisualSlot): VisualCategory {
    const categoryDefinition = getRoundCategories(session.nodeId, session.round).find(
        (item) => item.key === slot.key,
    );
    if (!categoryDefinition) throw new Error(`Unknown visual category ${slot.key}`);
    return categoryDefinition;
}

export function getVisualImagePath(categoryDefinition: VisualCategory, imageIndex: number): string {
    return `/images/Home/test-images.20260716-v1/${categoryDefinition.folder}/${categoryDefinition.imageName} ${imageIndex}.webp`;
}

export function getReachableNextImageUrls(session: VisualTestSession): string[] {
    if (session.phase !== "playing") return [];

    const responses: TestResponse[] = [
        { kind: "choose", key: session.slots[0].key },
        { kind: "choose", key: session.slots[1].key },
        { kind: "both" },
        { kind: "neither" },
    ];
    const urls = new Set<string>();

    for (const response of responses) {
        const next = answerVisualTest(session, response);
        if (next.phase !== "playing") continue;
        for (const slot of next.slots) {
            const categoryDefinition = getCategoryForSlot(next, slot);
            urls.add(getVisualImagePath(categoryDefinition, slot.imageIndex));
        }
    }

    return Array.from(urls).slice(0, VISUAL_TEST_MAX_PRELOAD_URLS);
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([first], [second]) => first.localeCompare(second))
                .map(([key, nested]) => [key, canonicalize(nested)]),
        );
    }
    return value;
}

function fingerprint(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function parseReplayableAnswers(value: unknown): AnswerRecord[] | null {
    if (!Array.isArray(value) || value.length > VISUAL_TEST_TOTAL_STEPS) return null;
    const answers: AnswerRecord[] = [];

    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        if (
            fingerprint(Object.keys(record).sort()) !==
            fingerprint(["nodeId", "response", "round", "slotKeys"])
        ) {
            return null;
        }
        if (!((record.nodeId as string) in NODES) || !Number.isInteger(record.round)) return null;
        if (
            !Array.isArray(record.slotKeys) ||
            record.slotKeys.length !== 2 ||
            !record.slotKeys.every((key) => typeof key === "string")
        ) {
            return null;
        }
        if (
            !record.response ||
            typeof record.response !== "object" ||
            Array.isArray(record.response)
        ) {
            return null;
        }
        const response = record.response as Record<string, unknown>;
        if (response.kind === "choose") {
            if (
                fingerprint(Object.keys(response).sort()) !== fingerprint(["key", "kind"]) ||
                typeof response.key !== "string"
            ) {
                return null;
            }
        } else if (response.kind === "both" || response.kind === "neither") {
            if (fingerprint(Object.keys(response)) !== fingerprint(["kind"])) return null;
        } else {
            return null;
        }

        answers.push(item as AnswerRecord);
    }

    return answers;
}

export function replayVisualTest(seed: number, answers: AnswerRecord[]): VisualTestSession {
    let session = createVisualTestSession(seed);

    for (const answer of answers) {
        if (session.phase !== "playing")
            throw new Error("Stored answers continue after the result");
        const expectedContext = {
            nodeId: session.nodeId,
            round: session.round,
            slotKeys: session.slots.map((slot) => slot.key),
        };
        const storedContext = {
            nodeId: answer.nodeId,
            round: answer.round,
            slotKeys: answer.slotKeys,
        };
        if (fingerprint(expectedContext) !== fingerprint(storedContext)) {
            throw new Error("Stored answer does not match its deterministic screen");
        }
        session = answerVisualTest(session, answer.response);
    }

    return session;
}

export function serializeVisualTestSession(session: VisualTestSession): string {
    return JSON.stringify(session);
}

function normalizeParsedVisualTestSession(candidate: unknown): VisualTestSession | null {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    if (record.version !== VISUAL_TEST_SESSION_VERSION) return null;
    if (
        !Number.isSafeInteger(record.seed) ||
        (record.seed as number) <= 0 ||
        (record.seed as number) > 0xffffffff
    ) {
        return null;
    }
    const answers = parseReplayableAnswers(record.answers);
    if (!answers) return null;

    try {
        const replayed = replayVisualTest(record.seed as number, answers);
        return fingerprint(record) === fingerprint(replayed) ? replayed : null;
    } catch {
        return null;
    }
}

/**
 * Validates an unknown in-memory value by replaying its compact answer history.
 * The returned object is a fresh canonical session, never the caller-owned value.
 */
export function normalizeVisualTestSession(value: unknown): VisualTestSession | null {
    try {
        const serialized = JSON.stringify(value);
        if (!serialized || serialized.length > 250_000) return null;
        return normalizeParsedVisualTestSession(JSON.parse(serialized));
    } catch {
        return null;
    }
}

export function parseVisualTestSession(raw: string | null): VisualTestSession | null {
    if (!raw || raw.length > 250_000) return null;

    try {
        return normalizeParsedVisualTestSession(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function restoreVisualTestSession(storage: SessionStorageLike): VisualTestSession | null {
    try {
        const restored = parseVisualTestSession(storage.getItem(VISUAL_TEST_SESSION_KEY));
        if (!restored) storage.removeItem(VISUAL_TEST_SESSION_KEY);
        return restored;
    } catch {
        return null;
    }
}

export function persistVisualTestSession(
    storage: SessionStorageLike,
    session: VisualTestSession,
): boolean {
    try {
        storage.setItem(VISUAL_TEST_SESSION_KEY, serializeVisualTestSession(session));
        return true;
    } catch {
        return false;
    }
}

export function clearVisualTestSession(storage: SessionStorageLike): void {
    try {
        storage.removeItem(VISUAL_TEST_SESSION_KEY);
    } catch {
        // An unavailable storage backend must not block a local restart.
    }
}

export function getVisualTestStep(session: VisualTestSession): number {
    return Math.min(session.answers.length + 1, VISUAL_TEST_TOTAL_STEPS);
}
