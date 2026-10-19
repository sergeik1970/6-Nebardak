import { buildFurnitureInstances, FURNITURE_BY_ID, getMaximumFurnitureCount } from "./catalog";
import {
    FurnitureInstance,
    FurniturePriority,
    FurnitureSelection,
    Placement,
    RemovalMethod,
    RemovalRecord,
} from "./types";

const MAX_INSTANCE_ID_LENGTH = 160;
const MAX_REMOVAL_REASON_LENGTH = 500;
const REMOVAL_METHODS = new Set<RemovalMethod>(["automatic", "manual"]);
const FURNITURE_PRIORITIES = new Set<FurniturePriority>(["required", "preferred", "optional"]);

export const MANUAL_REMOVAL_REASON =
    "Пользователь подтвердил удаление предмета из текущей планировки.";
export const AUTOMATIC_REMOVAL_REASON =
    "Предмет отмечен «Можно убрать»: доказано, что полный набор не помещается, а без этого предмета найден допустимый вариант.";

const formatItemCount = (count: number): string => {
    const modulo100 = count % 100;
    const modulo10 = count % 10;
    if (modulo100 >= 11 && modulo100 <= 19) return `${count} предметов`;
    if (modulo10 === 1) return `${count} предмет`;
    if (modulo10 >= 2 && modulo10 <= 4) return `${count} предмета`;
    return `${count} предметов`;
};

/**
 * Describes only what the removal search actually proves. It intentionally
 * avoids calling an individual item incompatible with the room: the conflict
 * can exist only in combination with the rest of the selected furniture.
 */
export const buildAutomaticRemovalReason = (
    totalItemCount: number,
    removedItemCount: number,
): string =>
    `Полный комплект (${formatItemCount(totalItemCount)}) не имеет допустимой расстановки. ` +
    `Этот предмет имел приоритет «Можно убрать» и вошёл в минимальную подтверждённую группу (${formatItemCount(removedItemCount)}): без неё найден допустимый вариант. ` +
    "Обязательные и желательные предметы сохранены. Это конфликт всего комплекта, а не несовместимость предмета с комнатой.";

export type RemovalRecordsValidationResult =
    | { status: "valid"; value: RemovalRecord[] }
    | { status: "invalid"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isValidIsoTimestamp = (value: string): boolean => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isInstanceForDefinition = (instanceId: string, definitionId: string): boolean => {
    if (!instanceId.startsWith(`${definitionId}-`)) return false;
    const ordinal = instanceId.slice(definitionId.length + 1);
    return /^[1-9]\d*$/.test(ordinal) && Number(ordinal) <= getMaximumFurnitureCount(definitionId);
};

const getInstanceOrdinal = (instanceId: string, definitionId: string): number =>
    Number(instanceId.slice(definitionId.length + 1));

/** Validates untrusted persisted/exported removal data and returns fresh objects. */
export const validateRemovalRecords = (input: unknown): RemovalRecordsValidationResult => {
    if (!Array.isArray(input)) {
        return { status: "invalid", message: "Список удалённых предметов имеет неверный формат." };
    }

    const seenInstanceIds = new Set<string>();
    const value: RemovalRecord[] = [];

    for (const candidate of input) {
        if (!isRecord(candidate)) {
            return { status: "invalid", message: "Запись об удалении имеет неверный формат." };
        }

        const { instanceId, definitionId, priority, method, reason, removedAt } = candidate;
        if (
            typeof instanceId !== "string" ||
            instanceId.length === 0 ||
            instanceId.length > MAX_INSTANCE_ID_LENGTH ||
            typeof definitionId !== "string" ||
            !FURNITURE_BY_ID.has(definitionId) ||
            !isInstanceForDefinition(instanceId, definitionId) ||
            (priority !== undefined &&
                (typeof priority !== "string" ||
                    !FURNITURE_PRIORITIES.has(priority as FurniturePriority))) ||
            typeof method !== "string" ||
            !REMOVAL_METHODS.has(method as RemovalMethod) ||
            typeof reason !== "string" ||
            reason.trim().length === 0 ||
            reason.trim().length > MAX_REMOVAL_REASON_LENGTH ||
            typeof removedAt !== "string" ||
            !isValidIsoTimestamp(removedAt)
        ) {
            return { status: "invalid", message: "Запись об удалении не прошла проверку." };
        }
        if (seenInstanceIds.has(instanceId)) {
            return {
                status: "invalid",
                message: "Один предмет не может быть указан в списке удалённых дважды.",
            };
        }

        seenInstanceIds.add(instanceId);
        value.push({
            instanceId,
            definitionId,
            ...(priority ? { priority: priority as FurniturePriority } : {}),
            method: method as RemovalMethod,
            reason: reason.trim(),
            removedAt,
        });
    }

    return { status: "valid", value };
};

export const createRemovalRecord = (
    input: Omit<RemovalRecord, "removedAt"> & { removedAt?: string },
): RemovalRecord => {
    const candidate = { ...input, removedAt: input.removedAt ?? new Date().toISOString() };
    const validation = validateRemovalRecords([candidate]);
    if (validation.status === "invalid") throw new Error(validation.message);
    return validation.value[0];
};

export const mergeRemovalRecords = (
    current: RemovalRecord[],
    additions: RemovalRecord[],
): RemovalRecord[] => {
    const validation = validateRemovalRecords([...current, ...additions]);
    if (validation.status === "valid") return validation.value;

    const additionsById = new Map(additions.map((record) => [record.instanceId, record]));
    const merged = [
        ...current.filter((record) => !additionsById.has(record.instanceId)),
        ...additions,
    ];
    const mergedValidation = validateRemovalRecords(merged);
    if (mergedValidation.status === "invalid") throw new Error(mergedValidation.message);
    return mergedValidation.value;
};

/** Builds stable instance ids while active removals leave ordinal gaps. */
export const buildFurnitureInstancesExcludingRemoved = (
    counts: Record<string, number>,
    priorities: Record<string, FurniturePriority>,
    removedItems: RemovalRecord[],
): FurnitureInstance[] => {
    const validation = validateRemovalRecords(removedItems);
    if (validation.status === "invalid") throw new Error(validation.message);

    const removedCountByDefinition = new Map<string, number>();
    const removedInstanceIds = new Set<string>();
    validation.value.forEach((record) => {
        removedCountByDefinition.set(
            record.definitionId,
            (removedCountByDefinition.get(record.definitionId) ?? 0) + 1,
        );
        removedInstanceIds.add(record.instanceId);
    });

    const definitionIds = new Set([
        ...Object.keys(counts),
        ...validation.value.map((record) => record.definitionId),
    ]);
    const selection: FurnitureSelection = Object.fromEntries(
        Array.from(definitionIds).map((definitionId) => {
            const count = counts[definitionId] ?? 0;
            const totalCount = count + (removedCountByDefinition.get(definitionId) ?? 0);
            if (totalCount > getMaximumFurnitureCount(definitionId)) {
                throw new Error("Количество выбранных и удалённых экземпляров превышает каталог.");
            }
            const priority = priorities[definitionId] ?? "preferred";
            return [
                definitionId,
                {
                    count: totalCount,
                    priority,
                    required: priority === "required",
                },
            ];
        }),
    );

    return buildFurnitureInstances(selection).filter(
        (instance) => !removedInstanceIds.has(instance.instanceId),
    );
};

/** Chooses exactly the records restored by an explicit count increase. */
export const getRestoredRemovalRecordIds = (
    removedItems: RemovalRecord[],
    definitionId: string,
    previousCount: number,
    nextCount: number,
): string[] =>
    removedItems
        .filter((record) => record.definitionId === definitionId)
        .sort(
            (first, second) =>
                getInstanceOrdinal(first.instanceId, definitionId) -
                getInstanceOrdinal(second.instanceId, definitionId),
        )
        .slice(0, Math.max(0, nextCount - previousCount))
        .map((record) => record.instanceId);

/**
 * Keeps removal records aligned with an undo/redo placement snapshot. Only
 * records already present in the archive may become active again.
 */
export const reconcileRemovalRecordsWithPlacements = (
    current: RemovalRecord[],
    previousPlacements: Placement[],
    nextPlacements: Placement[],
    archive: ReadonlyMap<string, RemovalRecord>,
): RemovalRecord[] => {
    const presentIds = new Set(nextPlacements.map((placement) => placement.instanceId));
    const transitionIds = new Set(
        [...previousPlacements, ...nextPlacements].map((placement) => placement.instanceId),
    );
    const candidateIds = new Set([
        ...current.map((record) => record.instanceId),
        ...Array.from(archive.keys()).filter((instanceId) => transitionIds.has(instanceId)),
    ]);
    const next = Array.from(candidateIds)
        .filter((instanceId) => !presentIds.has(instanceId))
        .map(
            (instanceId) =>
                archive.get(instanceId) ?? current.find((item) => item.instanceId === instanceId),
        )
        .filter((record): record is RemovalRecord => Boolean(record));

    const validation = validateRemovalRecords(next);
    if (validation.status === "invalid") throw new Error(validation.message);
    return validation.value;
};

/** Applies instance-level additions/removals from an undo/redo snapshot to counts. */
export const reconcileSelectionWithPlacementHistory = (
    current: Record<string, number>,
    previousPlacements: Placement[],
    nextPlacements: Placement[],
): Record<string, number> => {
    const previousById = new Map(
        previousPlacements.map((placement) => [placement.instanceId, placement]),
    );
    const nextById = new Map(nextPlacements.map((placement) => [placement.instanceId, placement]));
    const result = { ...current };

    previousById.forEach((placement, instanceId) => {
        if (nextById.has(instanceId)) return;
        result[placement.definitionId] = Math.max(0, (result[placement.definitionId] ?? 0) - 1);
    });
    nextById.forEach((placement, instanceId) => {
        if (previousById.has(instanceId)) return;
        result[placement.definitionId] = (result[placement.definitionId] ?? 0) + 1;
    });

    return result;
};
