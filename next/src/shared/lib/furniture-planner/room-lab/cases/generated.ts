import { buildFurnitureInstances } from "../../catalog";
import { applyRoomGeometry, createLRoomGeometry, getRoomArea } from "../../room-geometry";
import type {
    DoorOpening,
    FurnitureInstance,
    FurnitureSelection,
    RadiatorObstacle,
    Room,
    Wall,
    WindowOpening,
} from "../../types";
import type { RoomLabCase } from "../types";

export const ROOM_BENCHMARK_KINDS = ["bedroom", "living", "children", "office"] as const;
export type RoomBenchmarkKind = (typeof ROOM_BENCHMARK_KINDS)[number];

export const ROOM_BENCHMARK_SCENARIOS = [
    "facing",
    "side-door",
    "corner-door",
    "long-window",
    "radiator",
    "two-windows",
    "l-shape",
] as const;
export type RoomBenchmarkScenario = (typeof ROOM_BENCHMARK_SCENARIOS)[number];

const SIZES: Record<RoomBenchmarkKind, [width: number, depth: number][]> = {
    bedroom: [
        [2800, 3600],
        [3000, 4200],
        [3300, 3900],
        [3200, 4800],
        [3600, 4500],
        [3900, 5100],
        [4200, 5400],
    ],
    living: [
        [3300, 4800],
        [3600, 5000],
        [3800, 5600],
        [3200, 6800],
        [4000, 6000],
        [4500, 5500],
        [5000, 6000],
    ],
    children: [
        [2700, 3300],
        [2800, 3900],
        [3000, 4000],
        [3200, 4200],
        [3500, 4000],
        [3600, 4800],
        [4000, 5000],
    ],
    office: [
        [2400, 3000],
        [2600, 3400],
        [2400, 4500],
        [2800, 3600],
        [3000, 4000],
        [3200, 4200],
        [3600, 4200],
    ],
};

/**
 * What each room is asked to hold. A measuring stick only, deliberately
 * unchanged by later work: the real choice of furniture is a separate module,
 * and moving these sets would make old and new figures incomparable. The
 * first piece is the one the room is for, as in the planner.
 */
const furnitureSet = (kind: RoomBenchmarkKind, areaM2: number): Record<string, number> => {
    switch (kind) {
        case "bedroom":
            if (areaM2 < 11) return { "double-bed": 1, "bedside-table": 2, "wardrobe-small": 1 };
            if (areaM2 < 14) return { "double-bed": 1, "bedside-table": 2, "wardrobe-medium": 1 };
            return { "double-bed": 1, "bedside-table": 2, "wardrobe-large": 1, dresser: 1 };
        case "living": {
            const set: Record<string, number> = {
                "sofa-three": 1,
                tv: 1,
                "tv-console": 1,
                "coffee-table": 1,
                bookcase: 1,
            };
            if (areaM2 >= 20) set.armchair = 1;
            if (areaM2 >= 26) set["dining-square-four"] = 1;
            return set;
        }
        case "children":
            return areaM2 < 11
                ? { "single-bed": 1, desk: 1, "wardrobe-small": 1 }
                : { "single-bed": 1, desk: 1, "wardrobe-medium": 1, bookcase: 1 };
        case "office":
            return areaM2 < 12
                ? { desk: 1, bookcase: 1 }
                : { desk: 1, bookcase: 1, "wardrobe-small": 1, "sofa-two": 1 };
    }
};

const buildInstances = (set: Record<string, number>): FurnitureInstance[] => {
    const ids = Object.keys(set);
    const selection: FurnitureSelection = Object.fromEntries(
        ids.map((id, index) => [
            id,
            {
                count: set[id],
                required: index === 0,
                priority: index === 0 ? "required" : "preferred",
            },
        ]),
    );
    return buildFurnitureInstances(selection);
};

/** FNV-1a: turns a case id into a seed, so a case never depends on its neighbours. */
const hashText = (text: string): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
};

/** Mulberry32, seeded: the same id gives the same openings on every machine. */
const randomFrom = (seed: number) => {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
};

const snap = (value: number): number => Math.round(value / 50) * 50;

const clampOffset = (offset: number, wallLength: number, width: number, margin: number): number =>
    snap(Math.max(margin, Math.min(wallLength - width - margin, offset)));

const buildRoom = (
    width: number,
    depth: number,
    scenario: RoomBenchmarkScenario,
    random: () => number,
): Room => {
    const wallLength = (wall: Wall) => (wall === "top" || wall === "bottom" ? width : depth);

    const door = (wall: Wall, offset: number): DoorOpening => {
        const doorWidth = random() < 0.5 ? 800 : 900;
        return {
            id: "door",
            wall,
            offset: clampOffset(offset, wallLength(wall), doorWidth, 100),
            width: doorWidth,
            clearanceDepth: 900,
            hinge: random() < 0.5 ? "start" : "end",
            swingDirection: "inward",
            doorKind: "room",
        };
    };

    const window = (wall: Wall, id = "window"): WindowOpening => {
        const length = wallLength(wall);
        const windowWidth = snap(Math.min(1800, Math.max(1000, length - 1200)));
        const shift = (random() - 0.5) * 600;
        return {
            id,
            wall,
            offset: clampOffset((length - windowWidth) / 2 + shift, length, windowWidth, 150),
            width: windowWidth,
            windowKind: "standard",
        };
    };

    const radiatorUnder = (opening: WindowOpening): RadiatorObstacle => {
        const radiatorWidth = snap(Math.min(opening.width, 1000 + random() * 400));
        return {
            id: "radiator",
            wall: opening.wall,
            offset: snap(opening.offset + (opening.width - radiatorWidth) / 2),
            width: radiatorWidth,
            depth: 100,
            clearanceDepth: 300,
        };
    };

    const shell = (
        doors: DoorOpening[],
        windows: WindowOpening[],
        radiators: RadiatorObstacle[] = [],
    ): Room => ({ width, depth, partitions: [], doors, windows, radiators });

    const anywhere = (wall: Wall) => 300 + random() * (wallLength(wall) - 1400);

    switch (scenario) {
        case "facing":
            return shell([door("bottom", anywhere("bottom"))], [window("top")]);
        case "side-door":
            return shell([door("left", anywhere("left"))], [window("top")]);
        case "corner-door":
            return shell([door("left", depth - 1100)], [window("top")]);
        case "long-window":
            return shell([door("top", anywhere("top"))], [window("right")]);
        case "radiator": {
            const main = window("top");
            return shell([door("bottom", anywhere("bottom"))], [main], [radiatorUnder(main)]);
        }
        case "two-windows":
            return shell(
                [door("bottom", 300 + random() * 300)],
                [window("top"), window("right", "window-side")],
            );
        case "l-shape":
            return applyRoomGeometry(
                shell([door("bottom", anywhere("bottom"))], [window("left")]),
                createLRoomGeometry(width, depth, random() < 0.5 ? "left" : "right"),
            );
    }
};

const createCase = (
    kind: RoomBenchmarkKind,
    [width, depth]: [number, number],
    scenario: RoomBenchmarkScenario,
): RoomLabCase => {
    const id = `GEN-${kind}-${width}x${depth}-${scenario}`;
    const room = buildRoom(width, depth, scenario, randomFrom(hashText(id)));
    const areaM2 = getRoomArea(room) / 1_000_000;
    return {
        id,
        title: `${kind} ${width}×${depth}, ${scenario}`,
        description: "Сгенерированная комната для замера авторасстановки.",
        source: "generated",
        tags: [kind, scenario],
        room,
        instances: buildInstances(furnitureSet(kind, areaM2)),
        preferences: kind === "living" ? { tvTargetCategory: "living" } : {},
        requestedVariants: 3,
        // The benchmark judges results as a whole against its baseline, not case by case.
        expectation: {
            allowedStatuses: ["success", "proven-impossible", "search-exhausted"],
            requiredPredicates: [],
        },
    };
};

/**
 * The fixed set of rooms the auto layout is measured on: every kind, size and
 * opening layout. Ids are built from these parameters, so a new case cannot
 * shift an existing one.
 */
export const ROOM_LAB_GENERATED_CASES: RoomLabCase[] = ROOM_BENCHMARK_KINDS.flatMap((kind) =>
    SIZES[kind].flatMap((size) =>
        ROOM_BENCHMARK_SCENARIOS.map((scenario) => createCase(kind, size, scenario)),
    ),
);
