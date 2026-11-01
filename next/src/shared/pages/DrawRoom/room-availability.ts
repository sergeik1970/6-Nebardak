import type { RoomKind } from "@/shared/lib/furniture-planner";

/**
 * Kitchen and bathroom design is built but not offered yet. The rooms can
 * still be marked for the drawing's room list; only designing them is off.
 * Setting NEXT_PUBLIC_KITCHEN_BATH_DESIGN=on at build time brings it back.
 */
export const KITCHEN_BATH_DESIGN_ENABLED = process.env.NEXT_PUBLIC_KITCHEN_BATH_DESIGN === "on";

export const ROOM_DESIGN_UNAVAILABLE_TITLE = "Кухня и ванная пока недоступны";

export const ROOM_DESIGN_UNAVAILABLE_MESSAGE =
    "Проектирование кухни и ванной пока недоступно: сейчас мы работаем с жилыми комнатами и гостиными.";

export const isRoomDesignAvailable = (kind?: RoomKind) =>
    KITCHEN_BATH_DESIGN_ENABLED || (kind !== "kitchen" && kind !== "bathroom");

export const isFurnitureOffered = (id: string) =>
    KITCHEN_BATH_DESIGN_ENABLED || !id.startsWith("kitchen-");
