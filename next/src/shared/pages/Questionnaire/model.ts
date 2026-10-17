import type {
    FurnitureDefinition,
    FurniturePriority,
    LayoutPreferences,
    ProjectDraftFurnitureItem,
} from "@/shared/lib/furniture-planner";

export type BedChoice = "none" | "single-bed" | "double-bed";
export type SofaChoice = "none" | "sofa-two" | "sofa-three" | "sofa-four-left";
export const WARDROBE_IDS = ["wardrobe-small", "wardrobe-medium", "wardrobe-large"] as const;
export type WardrobeId = (typeof WARDROBE_IDS)[number];
export type WardrobeCount = 0 | 1 | 2;
export type WardrobeCounts = Record<WardrobeId, WardrobeCount>;

const EMPTY_WARDROBE_COUNTS: WardrobeCounts = {
    "wardrobe-small": 0,
    "wardrobe-medium": 0,
    "wardrobe-large": 0,
};

export interface QuestionnaireAnswers {
    bed: BedChoice;
    sofa: SofaChoice;
    wardrobes: WardrobeCounts;
    cradle: boolean;
    bedsideTableCount: 0 | 1 | 2;
    coffeeTable: boolean;
    tv: boolean;
    tvTargetCategory?: "sleep" | "living";
    desk: boolean;
    bookcase: boolean;
    dresser: boolean;
}

export interface SelectedFurniture {
    definition: FurnitureDefinition;
    count: number;
    priority: FurniturePriority;
}

export type PriorityMap = Record<string, FurniturePriority>;

export const INITIAL_ANSWERS: QuestionnaireAnswers = {
    bed: "none",
    sofa: "none",
    wardrobes: { ...EMPTY_WARDROBE_COUNTS },
    cradle: false,
    bedsideTableCount: 0,
    coffeeTable: false,
    tv: false,
    desk: false,
    bookcase: false,
    dresser: false,
};

export const PRIORITY_OPTIONS: Array<{
    value: FurniturePriority;
    label: string;
    description: string;
}> = [
    {
        value: "required",
        label: "Обязательно",
        description: "не удаляется автоматически",
    },
    {
        value: "preferred",
        label: "Желательно",
        description: "сохраняем, если возможно",
    },
];

export const getDefaultPriority = (
    _definitionId: string,
    _answers: QuestionnaireAnswers,
): FurniturePriority => "required";

export const answersFromDraft = (
    items: Array<{ definitionId: string; count: number }>,
    tvTargetCategory?: "sleep" | "living",
): QuestionnaireAnswers => {
    const counts = new Map(items.map((item) => [item.definitionId, item.count]));
    const selectedFrom = <T extends string>(ids: readonly T[], fallback: T) =>
        ids.find((id) => (counts.get(id) ?? 0) > 0) ?? fallback;
    const bed = selectedFrom<BedChoice>(["single-bed", "double-bed"], "none");
    const sofa = selectedFrom<SofaChoice>(["sofa-two", "sofa-three", "sofa-four-left"], "none");
    const hasBed = bed !== "none";
    const hasSofa = sofa !== "none";
    const hasTv = (hasBed || hasSofa) && (counts.get("tv") ?? 0) > 0;
    const normalizedTvTarget = hasTv
        ? hasBed && hasSofa
            ? tvTargetCategory
            : hasBed
              ? "sleep"
              : "living"
        : undefined;

    return {
        bed,
        sofa,
        wardrobes: getWardrobeCountsFromDraft(items),
        cradle: bed === "double-bed" && (counts.get("cradle") ?? 0) > 0,
        bedsideTableCount: hasBed
            ? (Math.min(2, counts.get("bedside-table") ?? 0) as 0 | 1 | 2)
            : 0,
        coffeeTable: hasSofa && (counts.get("coffee-table") ?? 0) > 0,
        tv: hasTv,
        tvTargetCategory: normalizedTvTarget,
        desk: (counts.get("desk") ?? 0) > 0,
        bookcase: (counts.get("bookcase") ?? 0) > 0,
        dresser: (counts.get("dresser") ?? 0) > 0,
    };
};

export const BED_OPTIONS: Array<{ value: BedChoice; label: string }> = [
    { value: "none", label: "Без кровати" },
    { value: "single-bed", label: "Односпальная" },
    { value: "double-bed", label: "Двуспальная" },
];

export const SOFA_OPTIONS: Array<{ value: SofaChoice; label: string }> = [
    { value: "none", label: "Без дивана" },
    { value: "sofa-two", label: "На двоих" },
    { value: "sofa-three", label: "На троих" },
    { value: "sofa-four-left", label: "Угловой, левый" },
];

export const WARDROBE_OPTIONS: Array<{ value: WardrobeId; label: string }> = [
    { value: "wardrobe-small", label: "Малый · 700 мм" },
    { value: "wardrobe-medium", label: "Средний · 1500 мм" },
    { value: "wardrobe-large", label: "Большой · 2000 мм" },
];

/**
 * Restores the item-based draft format used by all project-draft versions.
 * Valid planner drafts contain at most two wardrobes in total. The defensive
 * remaining-capacity clamp keeps a malformed/legacy caller from creating an
 * answer state the questionnaire cannot edit.
 */
export const getWardrobeCountsFromDraft = (
    items: Array<{ definitionId: string; count: number }>,
): WardrobeCounts => {
    const sourceCounts = new Map(items.map((item) => [item.definitionId, item.count]));
    let remaining = 2;

    return WARDROBE_IDS.reduce<WardrobeCounts>(
        (counts, definitionId) => {
            const requested = sourceCounts.get(definitionId) ?? 0;
            const count = Math.min(remaining, Math.max(0, Math.trunc(requested))) as WardrobeCount;
            counts[definitionId] = count;
            remaining -= count;
            return counts;
        },
        { ...EMPTY_WARDROBE_COUNTS },
    );
};

export const getWardrobeTotal = (wardrobes: WardrobeCounts) =>
    WARDROBE_IDS.reduce((total, definitionId) => total + wardrobes[definitionId], 0);

export const getWardrobeItems = (wardrobes: WardrobeCounts) =>
    WARDROBE_IDS.flatMap((definitionId) => {
        const count = wardrobes[definitionId];
        return count > 0 ? [{ definitionId, count }] : [];
    });

export const getQueryString = (value: string | string[] | undefined, maximumLength: number) => {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maximumLength) : undefined;
};

export const pluralizeFurniture = (count: number) => {
    const modulo100 = count % 100;
    const modulo10 = count % 10;
    if (modulo100 >= 11 && modulo100 <= 19) return `${count} предметов`;
    if (modulo10 === 1) return `${count} предмет`;
    if (modulo10 >= 2 && modulo10 <= 4) return `${count} предмета`;
    return `${count} предметов`;
};

/** Stable comparison used to preserve a generated plan while questionnaire inputs stay unchanged. */
export const getPlannerInputsSignature = (
    items: ProjectDraftFurnitureItem[],
    preferences?: LayoutPreferences,
) =>
    JSON.stringify({
        items: [...items]
            .map(({ definitionId, count, priority }) => ({ definitionId, count, priority }))
            .sort((first, second) => first.definitionId.localeCompare(second.definitionId)),
        preferences: preferences ?? null,
    });
