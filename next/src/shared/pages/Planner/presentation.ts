export const PLANNER_MEASUREMENT_DISCLAIMER =
    "Перед покупкой перепроверьте фактические замеры и инженерные выводы.";

export const PLANNER_DOOR_ENVELOPE_CAVEAT =
    "Сектор открывания двери проверяется консервативным прямоугольным конвертом, а не точной дугой полотна.";

export const PLANNER_CIRCULAR_FURNITURE_CAVEAT =
    "Круглая мебель проверяется по ограничивающему квадрату, поэтому расчёт может оставлять дополнительный запас.";

export interface PlannerCaveatApplicability {
    hasDoorOpening?: boolean;
    hasCircularFurniture?: boolean;
}

export const buildPlannerCaveats = (
    resultNotes: string[],
    betaEnabled: boolean,
    applicability: PlannerCaveatApplicability = {},
): string[] => [
    ...resultNotes,
    "Расстановка рассчитана для прямоугольной комнаты и введённых пользователем размеров.",
    ...(applicability.hasDoorOpening ? [PLANNER_DOOR_ENVELOPE_CAVEAT] : []),
    ...(applicability.hasCircularFurniture ? [PLANNER_CIRCULAR_FURNITURE_CAVEAT] : []),
    ...(betaEnabled ? ["Планировщик работает в бета-режиме."] : []),
    PLANNER_MEASUREMENT_DISCLAIMER,
];
