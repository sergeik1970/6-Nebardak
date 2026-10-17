import { getFurniture } from "../catalog";
import {
    analyzeConnectedAccess,
    getBounds,
    getWindowCurtainObstacle,
    getWorldBodyRects,
    rectsIntersect,
    tvFacesTarget,
    validateLayout,
    wallForBack,
} from "../geometry";
import {
    getFunctionalBlocks,
    getLayoutStructureSignature,
    isPlacementNearPreferredWindow,
    scoreLivingComposition,
} from "../solver";
import type { Placement, Rect } from "../types";
import type {
    RoomLabCase,
    RoomLabExecution,
    RoomLabFunctionalZone,
    RoomLabPredicate,
    RoomLabPredicateResult,
} from "./types";

export interface RoomLabPredicateContext {
    roomCase: RoomLabCase;
    execution: RoomLabExecution;
    runAgain: () => RoomLabExecution;
}

const pass = (predicate: RoomLabPredicate, message: string): RoomLabPredicateResult => ({
    predicate,
    passed: true,
    message,
});

const fail = (predicate: RoomLabPredicate, message: string): RoomLabPredicateResult => ({
    predicate,
    passed: false,
    message,
});

const requireSuccess = (
    predicate: RoomLabPredicate,
    execution: RoomLabExecution,
): RoomLabPredicateResult | null =>
    execution.status === "success"
        ? null
        : fail(predicate, `Предикат требует success, получен ${execution.status}.`);

const boundsGap = (first: Rect, second: Rect): number => {
    const dx = Math.max(first.x - (second.x + second.width), second.x - (first.x + first.width), 0);
    const dy = Math.max(first.y - (second.y + second.depth), second.y - (first.y + first.depth), 0);
    return Math.hypot(dx, dy);
};

const nearestGap = (placement: Placement, anchors: Placement[]): number | null => {
    if (anchors.length === 0) return null;
    const placementBounds = getBounds(getWorldBodyRects(placement));
    return Math.min(
        ...anchors.map((anchor) =>
            boundsGap(placementBounds, getBounds(getWorldBodyRects(anchor))),
        ),
    );
};

const zonePlacements = (placements: Placement[], zone: RoomLabFunctionalZone): Placement[] =>
    placements.filter((placement) => {
        const definition = getFurniture(placement.definitionId);
        switch (zone) {
            case "living":
                return definition.category === "living" || definition.category === "media";
            case "sleep":
                return (
                    definition.category === "sleep" ||
                    definition.category === "children" ||
                    definition.id === "bedside-table"
                );
            case "work":
                return definition.category === "work";
        }
    });

const zoneCenter = (placements: Placement[]): { x: number; y: number } | null => {
    if (placements.length === 0) return null;
    const bounds = getBounds(placements.flatMap(getWorldBodyRects));
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.depth / 2 };
};

const stableExecutionSignature = (roomCase: RoomLabCase, execution: RoomLabExecution): string => {
    const structuralSignatures =
        execution.variants.length > 0
            ? execution.variants.map((variant) =>
                  getLayoutStructureSignature(roomCase.room, variant.placements),
              )
            : execution.status === "success"
              ? [getLayoutStructureSignature(roomCase.room, execution.placements)]
              : [];

    return JSON.stringify({
        status: execution.status,
        placements: execution.placements,
        structuralSignatures,
        removed: execution.removedInstances.map((instance) => instance.instanceId).sort(),
        removalResultStatus: execution.removalResultStatus,
    });
};

const evaluateBlockCoherence = (
    predicate: RoomLabPredicate,
    context: RoomLabPredicateContext,
    kind: "living" | "sleep" | "work",
): RoomLabPredicateResult => {
    const successFailure = requireSuccess(predicate, context.execution);
    if (successFailure) return successFailure;

    const blocks = getFunctionalBlocks(
        context.roomCase.instances,
        context.roomCase.preferences,
    ).filter((block) => block.kind === kind);
    if (blocks.length === 0) return fail(predicate, `В кейсе нет блока ${kind}.`);

    const placedIds = new Set(
        context.execution.placements.map((placement) => placement.instanceId),
    );
    const complete = blocks.every(
        (block) =>
            placedIds.has(block.anchorInstanceId) &&
            block.memberInstanceIds.every((instanceId) => placedIds.has(instanceId)),
    );
    if (!complete) return fail(predicate, `Не все участники блока ${kind} размещены.`);

    if (kind === "living") {
        const score = scoreLivingComposition(context.execution.placements);
        return score > 0
            ? pass(predicate, `Гостиная композиция подтверждена (score=${score}).`)
            : fail(predicate, "Диван и выбранные участники не образуют одну композицию.");
    }

    const anchorDefinitionIds = kind === "sleep" ? ["single-bed", "double-bed"] : ["desk"];
    const supportDefinitionIds = kind === "sleep" ? ["dresser"] : ["bookcase"];
    const anchors = context.execution.placements.filter((placement) =>
        anchorDefinitionIds.includes(placement.definitionId),
    );
    const supports = context.execution.placements.filter((placement) =>
        supportDefinitionIds.includes(placement.definitionId),
    );
    const distantSupport = supports.find((support) => {
        const gap = nearestGap(support, anchors);
        return gap === null || gap > 3000;
    });

    return distantSupport
        ? fail(
              predicate,
              `${distantSupport.definitionId} находится дальше 3000 мм от anchor блока ${kind}.`,
          )
        : pass(predicate, `Все участники блока ${kind} размещены и поддержка не дальше 3000 мм.`);
};

export const evaluateRoomLabPredicate = (
    predicate: RoomLabPredicate,
    context: RoomLabPredicateContext,
): RoomLabPredicateResult => {
    const { roomCase, execution } = context;

    switch (predicate.kind) {
        case "layout-valid": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const validation = validateLayout(
                roomCase.room,
                execution.placements,
                roomCase.preferences,
            );
            return validation.valid
                ? pass(predicate, "validateLayout не нашёл нарушений.")
                : fail(
                      predicate,
                      `validateLayout: ${validation.issues.map((issue) => issue.code).join(", ")}.`,
                  );
        }
        case "all-selected-items-placed": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const expected = roomCase.instances.map((instance) => instance.instanceId).sort();
            const actual = execution.placements.map((placement) => placement.instanceId).sort();
            const unique = new Set(actual);
            const complete =
                expected.length === actual.length &&
                unique.size === actual.length &&
                expected.every((instanceId, index) => instanceId === actual[index]);
            return complete
                ? pass(predicate, `Размещены все ${expected.length} выбранных предмета(ов).`)
                : fail(
                      predicate,
                      `Ожидались [${expected.join(", ")}], получены [${actual.join(", ")}].`,
                  );
        }
        case "connected-access": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const analysis = analyzeConnectedAccess(roomCase.room, execution.placements);
            const thresholdMatches = analysis.minimumPassageWidth >= predicate.minimumMm;
            return analysis.connected && thresholdMatches
                ? pass(
                      predicate,
                      `Связный проход подтверждён для ${analysis.minimumPassageWidth} мм.`,
                  )
                : fail(
                      predicate,
                      `Проход не подтверждён: connected=${analysis.connected}, minimum=${analysis.minimumPassageWidth}.`,
                  );
        }
        case "living-block-coherent":
            return evaluateBlockCoherence(predicate, context, "living");
        case "sleep-block-coherent":
            return evaluateBlockCoherence(predicate, context, "sleep");
        case "work-block-coherent":
            return evaluateBlockCoherence(predicate, context, "work");
        case "desk-near-window": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const desks = execution.placements.filter(
                (placement) => placement.definitionId === "desk",
            );
            const near =
                desks.length > 0 &&
                desks.every((desk) => isPlacementNearPreferredWindow(desk, roomCase.room));
            return near && predicate.maximumMm >= 600
                ? pass(predicate, `Стол находится в оконной зоне до ${predicate.maximumMm} мм.`)
                : fail(
                      predicate,
                      `Стол не подтверждён у подходящего окна до ${predicate.maximumMm} мм.`,
                  );
        }
        case "dresser-away-from-window": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const dressers = execution.placements.filter(
                (placement) => placement.definitionId === "dresser",
            );
            const conflicts = dressers.filter((dresser) =>
                roomCase.room.windows.some((window) => {
                    const exclusion = getWindowCurtainObstacle(
                        window,
                        roomCase.room,
                        predicate.minimumMm,
                    );
                    return getWorldBodyRects(dresser).some((body) =>
                        rectsIntersect(body, exclusion),
                    );
                }),
            );
            return dressers.length > 0 && conflicts.length === 0
                ? pass(predicate, `Комод не пересекает оконный конверт ${predicate.minimumMm} мм.`)
                : fail(predicate, "Комод отсутствует или попал в оконный конверт.");
        }
        case "tv-faces-target": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const televisions = execution.placements.filter(
                (placement) => placement.definitionId === "tv",
            );
            const targets = execution.placements.filter((placement) => {
                const definition = getFurniture(placement.definitionId);
                return (
                    definition.category === predicate.target &&
                    (predicate.target !== "living" || definition.id !== "coffee-table")
                );
            });
            const faces =
                televisions.length > 0 &&
                targets.length > 0 &&
                televisions.every((television) =>
                    targets.some((target) => tvFacesTarget(television, target, predicate.target)),
                );
            return faces
                ? pass(predicate, `ТВ направлен на цель ${predicate.target}.`)
                : fail(predicate, `ТВ не подтверждён напротив цели ${predicate.target}.`);
        }
        case "tv-on-long-wall": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const longWalls =
                roomCase.room.width >= roomCase.room.depth
                    ? new Set(["top", "bottom"])
                    : new Set(["left", "right"]);
            const televisions = execution.placements.filter(
                (placement) => placement.definitionId === "tv",
            );
            return televisions.length > 0 &&
                televisions.every((television) => longWalls.has(wallForBack(television.rotation)))
                ? pass(predicate, "ТВ установлен вдоль длинной стены.")
                : fail(predicate, "ТВ не установлен вдоль длинной стены.");
        }
        case "zones-separated": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const firstCenter = zoneCenter(zonePlacements(execution.placements, predicate.first));
            const secondCenter = zoneCenter(zonePlacements(execution.placements, predicate.second));
            if (!firstCenter || !secondCenter) {
                return fail(predicate, "Одна из сравниваемых зон отсутствует.");
            }
            const distance = Math.hypot(
                firstCenter.x - secondCenter.x,
                firstCenter.y - secondCenter.y,
            );
            return distance >= predicate.minimumMm
                ? pass(
                      predicate,
                      `Центры зон разнесены на ${Math.round(distance)} мм (минимум ${predicate.minimumMm}).`,
                  )
                : fail(
                      predicate,
                      `Центры зон разнесены только на ${Math.round(distance)} мм (минимум ${predicate.minimumMm}).`,
                  );
        }
        case "variants-structurally-unique": {
            const successFailure = requireSuccess(predicate, execution);
            if (successFailure) return successFailure;
            const signatures = new Set(
                execution.variants.map((variant) =>
                    getLayoutStructureSignature(roomCase.room, variant.placements),
                ),
            );
            return signatures.size >= predicate.minimumCount
                ? pass(predicate, `Получено ${signatures.size} структурно разных варианта(ов).`)
                : fail(
                      predicate,
                      `Получено ${signatures.size}, требуется ${predicate.minimumCount} структурно разных варианта(ов).`,
                  );
        }
        case "deterministic": {
            const secondExecution = context.runAgain();
            return stableExecutionSignature(roomCase, execution) ===
                stableExecutionSignature(roomCase, secondExecution)
                ? pass(predicate, "Повторный запуск дал тот же статус и structural signature.")
                : fail(
                      predicate,
                      "Повторный запуск изменил статус, состав или structural signature.",
                  );
        }
        case "maximum-runtime":
            return execution.durationMs <= predicate.milliseconds
                ? pass(
                      predicate,
                      `Время ${execution.durationMs} мс не превышает ${predicate.milliseconds} мс.`,
                  )
                : fail(
                      predicate,
                      `Время ${execution.durationMs} мс превышает ${predicate.milliseconds} мс.`,
                  );
    }
};
