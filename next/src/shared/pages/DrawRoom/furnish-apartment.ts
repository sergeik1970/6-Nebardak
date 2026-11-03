import {
    getFurniture,
    isFurnishableRoomKind,
    roomKindLabel,
    suggestRoomKinds,
    type DrawRoomRegion,
    type FurnishableRoomKind,
    type FurnishResult,
    type Rect,
    type Room,
    type RoomBrief,
    type RoomKind,
} from "@/shared/lib/furniture-planner";
import {
    buildRegionSolverRoom,
    solvedToDrawFurniture,
    solverFixedFurniture,
    withFixedFurniture,
} from "./auto-layout";
import { furnitureBelongsToRoom, type DrawFurniture, type FurnitureRoom } from "./furniture";

type Point = { x: number; y: number };

/** One room of the drawn apartment, as the planner already knows it. */
export interface ApartmentRoom {
    signature: string;
    name: string;
    /** Set by the person; missing means the system suggests one. */
    kind?: RoomKind;
    areaSquareMillimeters: number;
    region: Pick<DrawRoomRegion, "clearEdges" | "clearRects" | "bounds">;
    /** The building the room belongs to, and where it stands in the apartment. */
    building: Room;
    origin: Point;
    /** The room as furniture checks see it, in apartment coordinates. */
    furnitureRoom: FurnitureRoom;
}

export interface FurnishApartmentInput {
    rooms: ApartmentRoom[];
    furniture: DrawFurniture[];
    /** Rooms that already hold unpinned furniture are left as they are. */
    keepFurnishedRooms: boolean;
    brief?: RoomBrief;
    /** Lays out one cut-out room; in the planner it runs in a worker. */
    furnish: (room: Room, kind: FurnishableRoomKind, brief: RoomBrief) => Promise<FurnishResult>;
    /** The apartment-wide check a hand-placed piece must pass as well. */
    fits: (piece: DrawFurniture, all: DrawFurniture[], room: FurnitureRoom) => boolean;
    onProgress?: (done: number, total: number, roomName: string) => void;
    signal?: AbortSignal;
    idPrefix?: string;
}

export interface RoomOutcome {
    signature: string;
    name: string;
    kind?: RoomKind;
    /** The kind came from the system's suggestion, not from the person. */
    suggested: boolean;
    status: "furnished" | "partial" | "skipped";
    /** One line for the person: what happened and, if anything was given up, why. */
    message: string;
    /** A kitchen-living room's reserved kitchen run, in apartment coordinates. */
    kitchenZone?: { run: Rect; passage: Rect };
}

export interface FurnishApartmentResult {
    /** The whole apartment's furniture: applied at once, so one undo takes it back. */
    furniture: DrawFurniture[];
    rooms: RoomOutcome[];
    cancelled: boolean;
}

const shift = (rect: Rect, offset: Point): Rect => ({
    ...rect,
    x: rect.x + offset.x,
    y: rect.y + offset.y,
});

const pieceName = (definitionId: string) => getFurniture(definitionId).shortLabel.toLowerCase();

const changeText = (result: FurnishResult): string =>
    result.step.changes
        .map((change) =>
            change.kind === "smaller"
                ? `${change.to} вместо «${change.from}»: ${change.reason}`
                : `без предмета «${pieceName(change.definitionId)}»: ${change.reason}`,
        )
        .join("; ");

/** Kinds for rooms the person has not named: a first guess, shown as such. */
const kindsFor = (rooms: ApartmentRoom[], cut: Map<string, Room | null>) => {
    const suggestions = suggestRoomKinds(
        rooms.map((room) => {
            const width = room.region.bounds.right - room.region.bounds.left;
            const depth = room.region.bounds.bottom - room.region.bounds.top;
            return {
                signature: room.signature,
                areaM2: room.areaSquareMillimeters / 1_000_000,
                windowCount: cut.get(room.signature)?.windows.length ?? 0,
                shortSideMm: Math.min(width, depth),
                longSideMm: Math.max(width, depth),
                kind: room.kind,
            };
        }),
    );
    return new Map(suggestions.map((item) => [item.signature, item.kind]));
};

/**
 * Furnishes every room it can, one after another. Pinned pieces stay where
 * they are and the rest of a room is laid out around them; with
 * `keepFurnishedRooms`, a room that already holds furniture is left alone.
 * Each new plan must pass the same apartment check as a hand-placed piece,
 * or the room keeps what it had. Rooms it cannot do say why.
 */
export async function furnishApartment(
    input: FurnishApartmentInput,
): Promise<FurnishApartmentResult> {
    const { rooms, keepFurnishedRooms, brief = {}, furnish, fits, onProgress, signal } = input;
    const idPrefix = input.idPrefix ?? `furniture-auto-${Date.now()}`;
    const cuts = new Map(
        rooms.map((room) => [room.signature, buildRegionSolverRoom(room.building, room.region)]),
    );
    const suggested = kindsFor(
        rooms,
        new Map(
            Array.from(cuts, ([signature, cut]) => [
                signature,
                cut.status === "ready" ? cut.room : null,
            ]),
        ),
    );
    let furniture = [...input.furniture];
    const outcomes: RoomOutcome[] = [];

    for (let index = 0; index < rooms.length; index += 1) {
        const room = rooms[index];
        if (signal?.aborted)
            return { furniture: input.furniture, rooms: outcomes, cancelled: true };
        onProgress?.(index, rooms.length, room.name);
        const kind = room.kind ?? suggested.get(room.signature);
        const base = {
            signature: room.signature,
            name: room.name,
            kind,
            suggested: !room.kind && kind !== undefined,
        };
        const skip = (message: string) => outcomes.push({ ...base, status: "skipped", message });

        const own = furniture.filter((item) => furnitureBelongsToRoom(item, room.furnitureRoom));
        const pinned = own.filter((item) => item.locked);
        const movable = own.filter((item) => !item.locked);
        if (!kind) {
            skip("Укажите тип комнаты, чтобы подобрать мебель.");
            continue;
        }
        if (!isFurnishableRoomKind(kind)) {
            skip(`${roomKindLabel(kind)}: обставляется вручную.`);
            continue;
        }
        if (keepFurnishedRooms && movable.length > 0) {
            skip("Уже обставлена, оставлена как есть.");
            continue;
        }
        const cut = cuts.get(room.signature);
        if (!cut || cut.status !== "ready") {
            skip(cut?.message ?? "Эту комнату не удалось подготовить к подбору.");
            continue;
        }

        const offset = { x: room.origin.x + cut.origin.x, y: room.origin.y + cut.origin.y };
        const solverRoom = withFixedFurniture(cut.room, solverFixedFurniture(pinned, offset));
        const result = await furnish(solverRoom, kind, brief);
        if (signal?.aborted)
            return { furniture: input.furniture, rooms: outcomes, cancelled: true };

        const pieces = solvedToDrawFurniture(result.placements, offset, `${idPrefix}-${index + 1}`);
        const others = furniture.filter((item) => !movable.includes(item));
        const all = [...others, ...pieces];
        if (!pieces.length || !pieces.every((piece) => fits(piece, all, room.furnitureRoom))) {
            skip(
                pieces.length
                    ? "План не прошёл проверку по всей квартире, мебель оставлена как была."
                    : "Ни один предмет не нашёл места, мебель оставлена как была.",
            );
            continue;
        }
        furniture = all;

        const kitchenZone = result.kitchenZone
            ? {
                  run: shift(result.kitchenZone.run, offset),
                  passage: shift(result.kitchenZone.passage, offset),
              }
            : undefined;
        const given = changeText(result);
        if (result.status === "furnished") {
            outcomes.push({
                ...base,
                status: "furnished",
                message: given ? `Обставлена: ${given}.` : "Обставлена полным набором.",
                ...(kitchenZone ? { kitchenZone } : {}),
            });
        } else {
            const missing = Array.from(
                new Set(result.unplaced.map((instance) => pieceName(instance.definitionId))),
            ).join(", ");
            outcomes.push({
                ...base,
                status: "partial",
                message: `Не поместилось: ${missing}.${given ? ` Уже уступили: ${given}.` : ""}`,
                ...(kitchenZone ? { kitchenZone } : {}),
            });
        }
    }

    onProgress?.(rooms.length, rooms.length, "");
    return { furniture, rooms: outcomes, cancelled: false };
}
