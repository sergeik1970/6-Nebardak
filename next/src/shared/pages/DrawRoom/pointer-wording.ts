/**
 * Phones and tablets have no cursor, hover, Esc or Shift, so the planner's
 * hints speak of a finger there. Read when a hint is shown: the editor only
 * renders in the browser.
 */
export const isTouchFirst = (): boolean =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

/** The mouse wording, or the touch one on a touch-first screen. */
export const byPointer = (mouse: string, touch: string): string => (isTouchFirst() ? touch : mouse);
