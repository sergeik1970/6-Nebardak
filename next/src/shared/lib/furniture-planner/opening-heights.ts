import type { DoorOpening, WindowOpening } from "./types";

/** The drawing has a single ceiling height for every room. */
export const CEILING_HEIGHT_MM = 2700;

export const DEFAULT_DOOR_HEIGHT_MM = 2100;
export const DEFAULT_WINDOW_HEIGHT_MM = 1500;
export const DEFAULT_WINDOW_SILL_MM = 850;
export const DEFAULT_PANORAMIC_WINDOW_HEIGHT_MM = 2400;

export const DOOR_HEIGHT_RANGE_MM = { minimum: 1500, maximum: CEILING_HEIGHT_MM } as const;
export const WINDOW_HEIGHT_RANGE_MM = { minimum: 300, maximum: CEILING_HEIGHT_MM } as const;
export const WINDOW_SILL_RANGE_MM = { minimum: 0, maximum: 2400 } as const;

export const getDoorHeight = (door: Pick<DoorOpening, "height">): number =>
    door.height ?? DEFAULT_DOOR_HEIGHT_MM;

export const getWindowHeight = (window: Pick<WindowOpening, "height" | "windowKind">): number =>
    window.height ??
    (window.windowKind === "floor-to-ceiling"
        ? DEFAULT_PANORAMIC_WINDOW_HEIGHT_MM
        : DEFAULT_WINDOW_HEIGHT_MM);

/** A panoramic window starts at the floor whatever an older draft stored. */
export const getWindowSillHeight = (
    window: Pick<WindowOpening, "sillHeight" | "windowKind">,
): number =>
    window.windowKind === "floor-to-ceiling" ? 0 : window.sillHeight ?? DEFAULT_WINDOW_SILL_MM;

const inRange = (value: number, range: { minimum: number; maximum: number }) =>
    Number.isFinite(value) && value >= range.minimum && value <= range.maximum;

/** Why a door height cannot be used, or null when it can. */
export const getDoorHeightError = (height: number): string | null =>
    inRange(height, DOOR_HEIGHT_RANGE_MM)
        ? null
        : `Высота двери — от ${DOOR_HEIGHT_RANGE_MM.minimum} до ${DOOR_HEIGHT_RANGE_MM.maximum} мм.`;

/** Why a window's height and sill cannot be used together, or null when they can. */
export const getWindowHeightError = (height: number, sillHeight: number): string | null => {
    if (!inRange(height, WINDOW_HEIGHT_RANGE_MM)) {
        return `Высота окна — от ${WINDOW_HEIGHT_RANGE_MM.minimum} до ${WINDOW_HEIGHT_RANGE_MM.maximum} мм.`;
    }
    if (!inRange(sillHeight, WINDOW_SILL_RANGE_MM)) {
        return `Высота подоконника — от ${WINDOW_SILL_RANGE_MM.minimum} до ${WINDOW_SILL_RANGE_MM.maximum} мм.`;
    }
    if (height + sillHeight > CEILING_HEIGHT_MM) {
        return `Окно с подоконником не выше потолка: вместе не больше ${CEILING_HEIGHT_MM} мм.`;
    }
    return null;
};
