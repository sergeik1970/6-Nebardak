import { reachMetrikaGoal } from "./metrika";

/**
 * Goal ids as they are registered in Yandex Metrika («JavaScript-событие»).
 * Renaming one breaks its history there.
 */
export type AnalyticsGoal =
    | "test_start"
    | "test_complete"
    | "questionnaire_complete"
    | "room_drawn"
    | "layout_generated"
    | "layout_failed"
    | "plan_png_export"
    | "plan_print"
    | "drawing_file_save"
    | "signup"
    | "login"
    | "project_created";

/** Only product facts go here — never names, emails or ids of people or projects. */
export type AnalyticsGoalParams = Record<string, string | number | boolean>;

/** Does nothing until the visitor allows analytics and a counter is configured. */
export const trackGoal = (goal: AnalyticsGoal, params?: AnalyticsGoalParams): void => {
    try {
        reachMetrikaGoal(goal, params);
    } catch {
        // Analytics must never break the product flow.
    }
};
