import { FURNITURE_BY_ID, FURNITURE_CATALOG, getMaximumFurnitureCount } from "./catalog";

export const QUESTIONNAIRE_PLANNER_HANDOFF_VERSION = 1 as const;
export const QUESTIONNAIRE_PLANNER_HANDOFF_SOURCE = "questionnaire" as const;
export const QUESTIONNAIRE_PLANNER_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
export const QUESTIONNAIRE_PLANNER_HANDOFF_STORAGE_PREFIX = "stylefinder:planner-handoff:v1:";
export const QUESTIONNAIRE_PLANNER_STYLE_KEY_MAX_LENGTH = 80;
export const QUESTIONNAIRE_PLANNER_STYLE_LABEL_MAX_LENGTH = 160;

const BED_IDS = new Set(["single-bed", "double-bed"]);
const SOFA_IDS = new Set(["sofa-two", "sofa-three", "sofa-four-left"]);
const WARDROBE_IDS = new Set(["wardrobe-small", "wardrobe-medium", "wardrobe-large"]);
const OPAQUE_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const CATALOG_ORDER = new Map(FURNITURE_CATALOG.map((definition, index) => [definition.id, index]));

export interface QuestionnairePlannerItemV1 {
    definitionId: string;
    count: number;
    required: boolean;
}

export interface QuestionnairePlannerInputV1 {
    version: 1;
    source: "questionnaire";
    createdAt: number;
    items: QuestionnairePlannerItemV1[];
    preferences?: {
        tvTargetCategory?: "sleep" | "living";
    };
    meta?: {
        styleKey?: string;
        styleLabel?: string;
    };
}

export interface QuestionnairePlannerInputDraftV1 {
    items: QuestionnairePlannerItemV1[];
    preferences?: QuestionnairePlannerInputV1["preferences"];
    meta?: QuestionnairePlannerInputV1["meta"];
}

export interface QuestionnairePlannerHandoffStorage {
    readonly length: number;
    getItem(key: string): string | null;
    key(index: number): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
}

export type QuestionnairePlannerHandoffInvalidReason =
    | "invalid-id"
    | "invalid-payload"
    | "invalid-version"
    | "invalid-source"
    | "invalid-created-at"
    | "invalid-items"
    | "empty-items"
    | "invalid-definition-id"
    | "unknown-definition-id"
    | "duplicate-definition-id"
    | "invalid-count"
    | "invalid-required"
    | "multiple-bed-types"
    | "multiple-sofa-types"
    | "too-many-wardrobes"
    | "cradle-requires-double-bed"
    | "bedside-table-requires-bed"
    | "coffee-table-requires-sofa"
    | "tv-requires-bed-or-sofa"
    | "invalid-preferences"
    | "invalid-tv-target"
    | "tv-target-requires-selection"
    | "tv-target-required"
    | "invalid-meta"
    | "invalid-style-key"
    | "invalid-style-label"
    | "malformed-json";

export type QuestionnairePlannerHandoffNormalizationResult =
    | { status: "success"; value: QuestionnairePlannerInputV1 }
    | { status: "invalid"; reason: QuestionnairePlannerHandoffInvalidReason }
    | { status: "unsupported-version"; version: number };

export type QuestionnairePlannerHandoffValidationResult =
    | QuestionnairePlannerHandoffNormalizationResult
    | { status: "expired"; expiredAt: number };

export type QuestionnairePlannerHandoffReadResult =
    | QuestionnairePlannerHandoffValidationResult
    | { status: "missing" }
    | { status: "unavailable" };

export type QuestionnairePlannerHandoffSaveResult =
    | {
          status: "success";
          id: string;
          value: QuestionnairePlannerInputV1;
          plannerHref: string;
      }
    | Exclude<QuestionnairePlannerHandoffValidationResult, { status: "success" }>
    | { status: "unavailable" };

export interface QuestionnairePlannerHandoffStorageOptions {
    /** Tests may inject a Storage-compatible implementation. `null` means unavailable. */
    storage?: QuestionnairePlannerHandoffStorage | null;
    now?: number;
}

export interface QuestionnairePlannerHandoffSaveOptions
    extends QuestionnairePlannerHandoffStorageOptions {
    createId?: () => string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = (
    reason: QuestionnairePlannerHandoffInvalidReason,
): QuestionnairePlannerHandoffNormalizationResult => ({ status: "invalid", reason });

const normalizeOptionalBoundedString = (
    value: unknown,
    maximumLength: number,
    invalidReason: "invalid-style-key" | "invalid-style-label",
): { status: "success"; value?: string } | { status: "invalid"; reason: typeof invalidReason } => {
    if (value === undefined) {
        return { status: "success" };
    }

    if (typeof value !== "string") {
        return { status: "invalid", reason: invalidReason };
    }

    const normalized = value.trim();

    if (normalized.length > maximumLength) {
        return { status: "invalid", reason: invalidReason };
    }

    return normalized ? { status: "success", value: normalized } : { status: "success" };
};

/**
 * Strictly validates untrusted data and rebuilds it from the V1 allow-list.
 * Unknown properties (including raw questionnaire answers) are intentionally discarded.
 */
export const normalizeQuestionnairePlannerInput = (
    input: unknown,
): QuestionnairePlannerHandoffNormalizationResult => {
    if (!isRecord(input)) {
        return invalid("invalid-payload");
    }

    if (!Number.isInteger(input.version) || (input.version as number) < 1) {
        return invalid("invalid-version");
    }

    if (input.version !== QUESTIONNAIRE_PLANNER_HANDOFF_VERSION) {
        return { status: "unsupported-version", version: input.version as number };
    }

    if (input.source !== QUESTIONNAIRE_PLANNER_HANDOFF_SOURCE) {
        return invalid("invalid-source");
    }

    if (!Number.isSafeInteger(input.createdAt) || (input.createdAt as number) <= 0) {
        return invalid("invalid-created-at");
    }

    if (!Array.isArray(input.items)) {
        return invalid("invalid-items");
    }

    if (input.items.length === 0) {
        return invalid("empty-items");
    }

    const seenIds = new Set<string>();
    const items: QuestionnairePlannerItemV1[] = [];

    for (const candidate of input.items) {
        if (!isRecord(candidate)) {
            return invalid("invalid-items");
        }

        if (typeof candidate.definitionId !== "string" || !candidate.definitionId) {
            return invalid("invalid-definition-id");
        }

        const definitionId = candidate.definitionId;

        if (!FURNITURE_BY_ID.has(definitionId)) {
            return invalid("unknown-definition-id");
        }

        if (seenIds.has(definitionId)) {
            return invalid("duplicate-definition-id");
        }

        if (
            !Number.isInteger(candidate.count) ||
            (candidate.count as number) <= 0 ||
            (candidate.count as number) > getMaximumFurnitureCount(definitionId)
        ) {
            return invalid("invalid-count");
        }

        if (typeof candidate.required !== "boolean") {
            return invalid("invalid-required");
        }

        seenIds.add(definitionId);
        items.push({
            definitionId,
            count: candidate.count as number,
            required: candidate.required,
        });
    }

    const selectedBedIds = items.filter(({ definitionId }) => BED_IDS.has(definitionId));
    const selectedSofaIds = items.filter(({ definitionId }) => SOFA_IDS.has(definitionId));
    const wardrobeCount = items
        .filter(({ definitionId }) => WARDROBE_IDS.has(definitionId))
        .reduce((total, item) => total + item.count, 0);
    const hasBed = selectedBedIds.length > 0;
    const hasDoubleBed = seenIds.has("double-bed");
    const hasSofa = selectedSofaIds.length > 0;
    const hasTv = seenIds.has("tv");

    if (selectedBedIds.length > 1) {
        return invalid("multiple-bed-types");
    }

    if (selectedSofaIds.length > 1) {
        return invalid("multiple-sofa-types");
    }

    if (wardrobeCount > 2) {
        return invalid("too-many-wardrobes");
    }

    if (seenIds.has("cradle") && !hasDoubleBed) {
        return invalid("cradle-requires-double-bed");
    }

    if (seenIds.has("bedside-table") && !hasBed) {
        return invalid("bedside-table-requires-bed");
    }

    if (seenIds.has("coffee-table") && !hasSofa) {
        return invalid("coffee-table-requires-sofa");
    }

    if (hasTv && !hasBed && !hasSofa) {
        return invalid("tv-requires-bed-or-sofa");
    }

    for (const item of items) {
        const shouldBeRequired =
            BED_IDS.has(item.definitionId) ||
            item.definitionId === "cradle" ||
            (!hasBed && SOFA_IDS.has(item.definitionId));

        if (item.required !== shouldBeRequired) {
            return invalid("invalid-required");
        }
    }

    let preferences: QuestionnairePlannerInputV1["preferences"];

    if (input.preferences !== undefined) {
        if (!isRecord(input.preferences)) {
            return invalid("invalid-preferences");
        }

        const target = input.preferences.tvTargetCategory;

        if (target !== undefined && target !== "sleep" && target !== "living") {
            return invalid("invalid-tv-target");
        }

        if (target !== undefined && !hasTv) {
            return invalid("invalid-tv-target");
        }

        if ((target === "sleep" && !hasBed) || (target === "living" && !hasSofa)) {
            return invalid("tv-target-requires-selection");
        }

        if (target !== undefined) {
            preferences = { tvTargetCategory: target };
        }
    }

    if (hasTv && hasBed && hasSofa && !preferences?.tvTargetCategory) {
        return invalid("tv-target-required");
    }

    let meta: QuestionnairePlannerInputV1["meta"];

    if (input.meta !== undefined) {
        if (!isRecord(input.meta)) {
            return invalid("invalid-meta");
        }

        const styleKeyResult = normalizeOptionalBoundedString(
            input.meta.styleKey,
            QUESTIONNAIRE_PLANNER_STYLE_KEY_MAX_LENGTH,
            "invalid-style-key",
        );
        const styleLabelResult = normalizeOptionalBoundedString(
            input.meta.styleLabel,
            QUESTIONNAIRE_PLANNER_STYLE_LABEL_MAX_LENGTH,
            "invalid-style-label",
        );

        if (styleKeyResult.status === "invalid") {
            return invalid(styleKeyResult.reason);
        }

        if (styleLabelResult.status === "invalid") {
            return invalid(styleLabelResult.reason);
        }

        if (styleKeyResult.value || styleLabelResult.value) {
            meta = {
                ...(styleKeyResult.value ? { styleKey: styleKeyResult.value } : {}),
                ...(styleLabelResult.value ? { styleLabel: styleLabelResult.value } : {}),
            };
        }
    }

    items.sort(
        (left, right) =>
            (CATALOG_ORDER.get(left.definitionId) ?? Number.MAX_SAFE_INTEGER) -
            (CATALOG_ORDER.get(right.definitionId) ?? Number.MAX_SAFE_INTEGER),
    );

    return {
        status: "success",
        value: {
            version: QUESTIONNAIRE_PLANNER_HANDOFF_VERSION,
            source: QUESTIONNAIRE_PLANNER_HANDOFF_SOURCE,
            createdAt: input.createdAt as number,
            items,
            ...(preferences ? { preferences } : {}),
            ...(meta ? { meta } : {}),
        },
    };
};

export const validateQuestionnairePlannerInput = (
    input: unknown,
    now = Date.now(),
): QuestionnairePlannerHandoffValidationResult => {
    const normalized = normalizeQuestionnairePlannerInput(input);

    if (normalized.status !== "success") {
        return normalized;
    }

    if (Number.isFinite(now) && normalized.value.createdAt > now) {
        return invalid("invalid-created-at");
    }

    const expiredAt = normalized.value.createdAt + QUESTIONNAIRE_PLANNER_HANDOFF_TTL_MS;

    if (Number.isFinite(now) && now >= expiredAt) {
        return { status: "expired", expiredAt };
    }

    return normalized;
};

export const createQuestionnairePlannerInput = (
    draft: QuestionnairePlannerInputDraftV1,
    createdAt = Date.now(),
): QuestionnairePlannerInputV1 => ({
    version: QUESTIONNAIRE_PLANNER_HANDOFF_VERSION,
    source: QUESTIONNAIRE_PLANNER_HANDOFF_SOURCE,
    createdAt,
    items: draft.items,
    ...(draft.preferences ? { preferences: draft.preferences } : {}),
    ...(draft.meta ? { meta: draft.meta } : {}),
});

export const isQuestionnairePlannerHandoffId = (id: unknown): id is string =>
    typeof id === "string" && OPAQUE_ID_PATTERN.test(id);

export const createQuestionnairePlannerHandoffId = (): string => {
    try {
        if (typeof globalThis.crypto?.randomUUID === "function") {
            return globalThis.crypto.randomUUID();
        }

        if (typeof globalThis.crypto?.getRandomValues === "function") {
            const bytes = new Uint8Array(16);
            globalThis.crypto.getRandomValues(bytes);
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        }
    } catch {
        // Fall through to a URL/storage-safe legacy-browser ID.
    }

    const randomPart = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join(
        "",
    );

    return `${Date.now().toString(36)}-${randomPart}`.slice(0, 128).padEnd(16, "0");
};

export const getQuestionnairePlannerHandoffStorageKey = (id: string): string =>
    `${QUESTIONNAIRE_PLANNER_HANDOFF_STORAGE_PREFIX}${id}`;

export const getQuestionnairePlannerHandoffUrl = (id: string): string =>
    `/planner?handoff=${encodeURIComponent(id)}`;

const resolveStorage = (
    options: QuestionnairePlannerHandoffStorageOptions,
): QuestionnairePlannerHandoffStorage | null => {
    if (Object.prototype.hasOwnProperty.call(options, "storage")) {
        return options.storage ?? null;
    }

    if (typeof window === "undefined") {
        return null;
    }

    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const removeExpiredHandoffs = (storage: QuestionnairePlannerHandoffStorage, now: number): void => {
    try {
        const keys: string[] = [];

        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);

            if (key?.startsWith(QUESTIONNAIRE_PLANNER_HANDOFF_STORAGE_PREFIX)) {
                keys.push(key);
            }
        }

        keys.forEach((key) => {
            try {
                const serialized = storage.getItem(key);

                if (serialized === null) {
                    return;
                }

                const parsed: unknown = JSON.parse(serialized);

                if (
                    isRecord(parsed) &&
                    Number.isSafeInteger(parsed.createdAt) &&
                    (parsed.createdAt as number) > 0 &&
                    now >= (parsed.createdAt as number) + QUESTIONNAIRE_PLANNER_HANDOFF_TTL_MS
                ) {
                    storage.removeItem(key);
                }
            } catch {
                // Cleanup is opportunistic and must never block a new handoff.
            }
        });
    } catch {
        // Some storage implementations reject enumeration; saving may still work.
    }
};

export const saveQuestionnairePlannerHandoff = (
    input: unknown,
    options: QuestionnairePlannerHandoffSaveOptions = {},
): QuestionnairePlannerHandoffSaveResult => {
    const now = options.now ?? Date.now();
    const validated = validateQuestionnairePlannerInput(input, now);

    if (validated.status !== "success") {
        return validated;
    }

    const storage = resolveStorage(options);

    if (!storage) {
        return { status: "unavailable" };
    }

    removeExpiredHandoffs(storage, now);

    const id = (options.createId ?? createQuestionnairePlannerHandoffId)();

    if (!isQuestionnairePlannerHandoffId(id)) {
        return { status: "invalid", reason: "invalid-id" };
    }

    try {
        storage.setItem(
            getQuestionnairePlannerHandoffStorageKey(id),
            JSON.stringify(validated.value),
        );
    } catch {
        return { status: "unavailable" };
    }

    return {
        status: "success",
        id,
        value: validated.value,
        plannerHref: getQuestionnairePlannerHandoffUrl(id),
    };
};

export const readQuestionnairePlannerHandoff = (
    id: unknown,
    options: QuestionnairePlannerHandoffStorageOptions = {},
): QuestionnairePlannerHandoffReadResult => {
    if (!isQuestionnairePlannerHandoffId(id)) {
        return { status: "invalid", reason: "invalid-id" };
    }

    const storage = resolveStorage(options);

    if (!storage) {
        return { status: "unavailable" };
    }

    let serialized: string | null;

    try {
        serialized = storage.getItem(getQuestionnairePlannerHandoffStorageKey(id));
    } catch {
        return { status: "unavailable" };
    }

    if (serialized === null) {
        return { status: "missing" };
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(serialized);
    } catch {
        return { status: "invalid", reason: "malformed-json" };
    }

    return validateQuestionnairePlannerInput(parsed, options.now ?? Date.now());
};
