import {
    ROOM_KINDS,
    type DrawWallSegment,
    type DoorOpening,
    type WindowOpening,
    type Room,
} from "@/shared/lib/furniture-planner";
import { readFurniture, type DrawFurniture } from "./furniture";

export interface DrawingProjectScene {
    segments: DrawWallSegment[];
    doors: DoorOpening[];
    windows: WindowOpening[];
    furniture?: DrawFurniture[];
    wallThickness?: Room["wallThickness"];
    regions?: Room["regions"];
}
const record = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const point = (v: unknown) => record(v) && finite(v.x) && finite(v.y);
const optionalEnum = (v: unknown, values: string[]) =>
    v === undefined || (typeof v === "string" && values.includes(v));
const unique = (items: unknown[]) => {
    const ids = items.map((v) => (record(v) ? v.id : null));
    return (
        ids.every((id) => typeof id === "string" && id.length > 0) &&
        new Set(ids).size === ids.length
    );
};
const opening = (v: unknown) =>
    record(v) &&
    typeof v.id === "string" &&
    ["top", "right", "bottom", "left"].includes(String(v.wall)) &&
    finite(v.offset) &&
    v.offset >= 0 &&
    finite(v.width) &&
    v.width > 0 &&
    ["drawingHostId", "segmentId", "partitionId"].every(
        (key) => v[key] === undefined || typeof v[key] === "string",
    );

export function serializeDrawingProject(scene: DrawingProjectScene): string {
    return JSON.stringify({ format: "stylefinder-drawing", version: 1, scene }, null, 2);
}

/** Reject damaged files as a whole rather than silently dropping user objects. */
export function parseDrawingProject(text: string): DrawingProjectScene {
    const fail = () => {
        throw new Error("Файл чертежа повреждён или имеет неподдерживаемый формат.");
    };
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return fail();
    }
    if (
        !record(value) ||
        value.format !== "stylefinder-drawing" ||
        value.version !== 1 ||
        !record(value.scene)
    )
        return fail();
    const s = value.scene;
    if (!Array.isArray(s.segments) || !Array.isArray(s.doors) || !Array.isArray(s.windows))
        return fail();
    if (![s.segments, s.doors, s.windows].every(unique)) return fail();
    if (!s.segments.every((v) => record(v) && point(v.start) && point(v.end))) return fail();
    if (
        !s.doors.every(
            (v) =>
                opening(v) &&
                finite(v.clearanceDepth) &&
                v.clearanceDepth >= 0 &&
                optionalEnum(v.doorKind, [
                    "room",
                    "balcony",
                    "swing-double",
                    "sliding-single",
                    "sliding-double",
                ]) &&
                optionalEnum(v.hinge, ["start", "end"]) &&
                optionalEnum(v.swingDirection, ["inward", "outward"]) &&
                optionalEnum(v.slidingMount, ["inward", "outward", "pocket"]) &&
                optionalEnum(v.slidingDirection, ["start", "end"]),
        )
    )
        return fail();
    if (
        !s.windows.every(
            (v) => opening(v) && optionalEnum(v.windowKind, ["standard", "floor-to-ceiling"]),
        )
    )
        return fail();
    if (s.wallThickness !== undefined && s.wallThickness !== 50 && s.wallThickness !== 100)
        return fail();
    if (
        s.regions !== undefined &&
        (!record(s.regions) ||
            s.regions.version !== 1 ||
            !Array.isArray(s.regions.items) ||
            !s.regions.items.every(
                (v) =>
                    record(v) &&
                    typeof v.signature === "string" &&
                    typeof v.name === "string" &&
                    (v.kind === undefined || ROOM_KINDS.some((item) => item.kind === v.kind)),
            ))
    )
        return fail();
    const furniture = readFurniture(s.furniture);
    if (
        s.furniture !== undefined &&
        (!Array.isArray(s.furniture) || furniture.length !== s.furniture.length)
    )
        return fail();
    return { ...s, furniture } as unknown as DrawingProjectScene;
}
