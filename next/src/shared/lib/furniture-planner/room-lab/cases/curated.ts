import type { FurnitureInstance, FurniturePriority, Room } from "../../types";
import { applyRoomGeometry, createLRoomGeometry } from "../../room-geometry";
import type { RoomLabCase, RoomLabPredicate } from "../types";

const emptyRoom = (width: number, depth: number): Room => ({
    width,
    depth,
    doors: [],
    windows: [],
    radiators: [],
});

const lRoom = (side: "left" | "right" = "right"): Room =>
    applyRoomGeometry(emptyRoom(6000, 4600), createLRoomGeometry(6000, 4600, side));

const item = (
    definitionId: string,
    priority: FurniturePriority = "required",
    ordinal = 1,
): FurnitureInstance => ({
    instanceId: `${definitionId}-${ordinal}`,
    definitionId,
    priority,
    required: priority === "required",
});

const VALID_AND_COMPLETE: RoomLabPredicate[] = [
    { kind: "layout-valid" },
    { kind: "all-selected-items-placed" },
];

const positiveCase = (
    roomCase: Omit<RoomLabCase, "source" | "requestedVariants" | "expectation"> & {
        requestedVariants?: 1 | 2 | 3;
        predicates?: RoomLabPredicate[];
    },
): RoomLabCase => {
    const { requestedVariants = 1, predicates = [], ...definition } = roomCase;

    return {
        ...definition,
        source: "curated",
        requestedVariants,
        expectation: {
            allowedStatuses: ["success"],
            requiredPredicates: [...VALID_AND_COMPLETE, ...predicates],
        },
    };
};

/**
 * Stable, product-level fixtures. They assert useful outcomes rather than
 * incidental x/y coordinates, so solver ranking can evolve without rewriting
 * every case.
 */
export const ROOM_LAB_CURATED_CASES: RoomLabCase[] = [
    positiveCase({
        id: "BR-01",
        title: "Компактная спальня",
        description: "Двуспальная кровать с обязательными проходами в небольшой комнате.",
        tags: ["bedroom", "compact", "migrated-golden"],
        room: emptyRoom(4200, 3400),
        instances: [item("double-bed")],
    }),
    positiveCase({
        id: "BR-02",
        title: "Кровать и две тумбы",
        description: "Обе прикроватные тумбы должны сохранить обязательную связь с кроватью.",
        tags: ["bedroom", "relation", "pair"],
        room: emptyRoom(6500, 5000),
        instances: [
            item("double-bed"),
            item("bedside-table"),
            item("bedside-table", "required", 2),
        ],
        predicates: [{ kind: "sleep-block-coherent" }],
    }),
    positiveCase({
        id: "BR-03",
        title: "Спальня с хранением и окном",
        description:
            "Комод не попадает в оконный конверт; близость к кровати не является условием packing-first режима.",
        tags: ["bedroom", "window", "storage", "migrated-golden"],
        room: {
            ...emptyRoom(6500, 5000),
            windows: [{ id: "window", wall: "top", offset: 2550, width: 1400 }],
        },
        instances: [item("double-bed"), item("bedside-table"), item("dresser")],
        predicates: [{ kind: "dresser-away-from-window", minimumMm: 600 }],
    }),
    positiveCase({
        id: "BR-04",
        title: "Спальня с дверью у угла",
        description: "Кровать и шкаф не перекрывают связный проход от угловой двери.",
        tags: ["bedroom", "door", "access"],
        room: {
            ...emptyRoom(6500, 5000),
            doors: [
                {
                    id: "door",
                    wall: "left",
                    offset: 0,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
        },
        instances: [item("double-bed"), item("wardrobe-medium")],
        predicates: [{ kind: "connected-access", minimumMm: 700 }],
    }),
    positiveCase({
        id: "BR-05",
        title: "Узкая спальня",
        description: "Односпальная кровать и малый шкаф не получают ложный отказ.",
        tags: ["bedroom", "narrow", "storage"],
        room: emptyRoom(3500, 5500),
        instances: [item("single-bed"), item("wardrobe-small")],
    }),
    positiveCase({
        id: "BR-06",
        title: "Кровать и люлька",
        description: "Люлька размещается в обязательном допустимом диапазоне от кровати.",
        tags: ["bedroom", "nursery", "relation"],
        room: emptyRoom(7000, 5500),
        instances: [item("double-bed"), item("cradle")],
        predicates: [{ kind: "sleep-block-coherent" }],
    }),
    positiveCase({
        id: "LV-01",
        title: "Полная ТВ-зона",
        description: "Диван, телевизор и кофейный столик образуют одну композицию.",
        tags: ["living", "tv", "composition", "migrated-golden"],
        room: emptyRoom(6000, 5000),
        instances: [item("sofa-two"), item("coffee-table"), item("tv")],
        preferences: { tvTargetCategory: "living" },
        predicates: [
            { kind: "living-block-coherent" },
            { kind: "tv-faces-target", target: "living" },
        ],
    }),
    positiveCase({
        id: "LV-02",
        title: "Вытянутая гостиная",
        description: "ТВ-зона использует длинную стену вытянутой комнаты.",
        tags: ["living", "tv", "long-room", "migrated-golden"],
        room: emptyRoom(8000, 4000),
        instances: [item("sofa-three"), item("tv")],
        preferences: { tvTargetCategory: "living" },
        predicates: [
            { kind: "living-block-coherent" },
            { kind: "tv-faces-target", target: "living" },
            { kind: "tv-on-long-wall" },
        ],
    }),
    positiveCase({
        id: "LV-03",
        title: "Квадратная гостиная",
        description: "Решатель отдаёт несколько структурно разных полезных топологий.",
        tags: ["living", "variants", "square"],
        room: emptyRoom(6500, 6500),
        instances: [item("sofa-two"), item("coffee-table"), item("tv")],
        preferences: { tvTargetCategory: "living" },
        requestedVariants: 3,
        predicates: [
            { kind: "living-block-coherent" },
            { kind: "variants-structurally-unique", minimumCount: 2 },
        ],
    }),
    positiveCase({
        id: "LV-04",
        title: "Гостиная с угловым диваном",
        description: "Составная геометрия углового дивана участвует в цельной ТВ-зоне.",
        tags: ["living", "tv", "compound-shape"],
        room: emptyRoom(7500, 6000),
        instances: [item("sofa-four-left"), item("coffee-table"), item("tv")],
        preferences: { tvTargetCategory: "living" },
        predicates: [
            { kind: "living-block-coherent" },
            { kind: "tv-faces-target", target: "living" },
        ],
    }),
    positiveCase({
        id: "LV-05",
        title: "Гостиная с окнами и радиатором",
        description: "ТВ-композиция не блокирует окно, радиатор или его сервисную зону.",
        tags: ["living", "window", "radiator"],
        room: {
            ...emptyRoom(8000, 6000),
            windows: [
                { id: "window-1", wall: "top", offset: 700, width: 1400 },
                { id: "window-2", wall: "top", offset: 5200, width: 1400 },
            ],
            radiators: [
                {
                    id: "radiator",
                    wall: "top",
                    offset: 5350,
                    width: 1100,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        },
        instances: [item("sofa-two"), item("coffee-table"), item("tv")],
        preferences: { tvTargetCategory: "living" },
        predicates: [{ kind: "living-block-coherent" }],
    }),
    positiveCase({
        id: "LV-06",
        title: "Большая гостиная с полным набором",
        description: "Функциональная группа остаётся собранной и не превращается в угловую свалку.",
        tags: ["living", "large", "storage"],
        room: emptyRoom(9000, 7000),
        instances: [
            item("sofa-three"),
            item("coffee-table"),
            item("tv"),
            item("bookcase"),
            item("dresser"),
        ],
        preferences: { tvTargetCategory: "living" },
        predicates: [{ kind: "living-block-coherent" }],
    }),
    positiveCase({
        id: "WK-01",
        title: "Рабочее место у окна",
        description:
            "Стол и книжный шкаф размещаются без конфликта с окном; свет остаётся дополнительным сценарием, а не условием packing-first режима.",
        tags: ["work", "window", "storage", "migrated-golden"],
        room: {
            ...emptyRoom(5000, 4000),
            windows: [{ id: "window", wall: "top", offset: 1700, width: 1600 }],
        },
        instances: [item("desk"), item("bookcase")],
        predicates: [{ kind: "work-block-coherent" }],
    }),
    positiveCase({
        id: "WK-02",
        title: "Кабинет с двумя окнами",
        description: "Стол и шкаф размещаются без конфликта с двумя окнами.",
        tags: ["work", "two-windows"],
        room: {
            ...emptyRoom(7000, 5000),
            windows: [
                { id: "window-1", wall: "top", offset: 500, width: 1300 },
                { id: "window-2", wall: "right", offset: 2600, width: 1300 },
            ],
        },
        instances: [item("desk"), item("bookcase")],
        predicates: [{ kind: "work-block-coherent" }],
    }),
    positiveCase({
        id: "WK-03",
        title: "Рабочее место рядом с радиатором",
        description:
            "Стол и шкаф не заходят в сервисную зону радиатора; близость к окну не обязательна для packing-first режима.",
        tags: ["work", "window", "radiator"],
        room: {
            ...emptyRoom(7000, 5000),
            windows: [{ id: "window", wall: "top", offset: 1800, width: 2600 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "top",
                    offset: 3100,
                    width: 800,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        },
        instances: [item("desk"), item("bookcase")],
        predicates: [{ kind: "work-block-coherent" }],
    }),
    positiveCase({
        id: "WK-04",
        title: "Узкий кабинет",
        description: "Стол и книжный шкаф образуют компактную зону, сохраняя проход.",
        tags: ["work", "narrow", "storage"],
        room: {
            ...emptyRoom(3800, 6000),
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 1450,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
        },
        instances: [item("desk"), item("bookcase")],
        predicates: [{ kind: "connected-access", minimumMm: 700 }, { kind: "work-block-coherent" }],
    }),
    positiveCase({
        id: "MX-01",
        title: "Спальня-гостиная",
        description:
            "Полный набор спальни-гостиной помещается без конфликтов; зонирование остаётся дополнительным вариантом.",
        tags: ["studio", "zoning", "migrated-golden"],
        room: emptyRoom(8000, 6000),
        instances: [item("double-bed"), item("sofa-two")],
        requestedVariants: 3,
        predicates: [{ kind: "variants-structurally-unique", minimumCount: 2 }],
    }),
    positiveCase({
        id: "MX-02",
        title: "Студия с ТВ для гостиной",
        description: "При двух возможных целях телевизор однозначно относится к дивану.",
        tags: ["studio", "tv", "preference"],
        room: emptyRoom(9000, 6500),
        instances: [item("double-bed"), item("sofa-two"), item("tv")],
        preferences: { tvTargetCategory: "living" },
        predicates: [{ kind: "tv-faces-target", target: "living" }],
    }),
    positiveCase({
        id: "MX-03",
        title: "Студия с ТВ для спальни",
        description: "При двух возможных целях телевизор однозначно относится к кровати.",
        tags: ["studio", "tv", "preference"],
        room: emptyRoom(9000, 6500),
        instances: [item("double-bed"), item("sofa-two"), item("tv")],
        preferences: { tvTargetCategory: "sleep" },
        predicates: [{ kind: "tv-faces-target", target: "sleep" }],
    }),
    positiveCase({
        id: "MX-04",
        title: "Студия с рабочим местом",
        description:
            "Сон, отдых и работа помещаются без конфликтов; дневной свет и зонирование остаются дополнительными вариантами.",
        tags: ["studio", "work", "zoning"],
        room: {
            ...emptyRoom(10000, 7000),
            windows: [{ id: "window", wall: "top", offset: 4200, width: 1800 }],
        },
        instances: [item("double-bed"), item("sofa-two"), item("desk")],
        predicates: [
            { kind: "zones-separated", first: "sleep", second: "living", minimumMm: 2000 },
        ],
    }),
    positiveCase({
        id: "MX-05",
        title: "Студия с полным набором",
        description: "Основные зоны и поддерживающее хранение не превращаются в случайных сирот.",
        tags: ["studio", "large", "storage", "composition"],
        room: emptyRoom(9000, 7000),
        instances: [
            item("double-bed"),
            item("bedside-table"),
            item("dresser"),
            item("sofa-two"),
            item("desk"),
            item("bookcase"),
        ],
        predicates: [
            { kind: "sleep-block-coherent" },
            { kind: "work-block-coherent" },
            { kind: "zones-separated", first: "sleep", second: "living", minimumMm: 2500 },
        ],
    }),
    positiveCase({
        id: "OP-01",
        title: "Дверь у угла",
        description: "Мебель не пересекает сектор двери и сохраняет связный проход.",
        tags: ["opening", "door", "corner", "migrated-golden"],
        room: {
            ...emptyRoom(5000, 4000),
            doors: [
                {
                    id: "door",
                    wall: "left",
                    offset: 0,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
        },
        instances: [item("bookcase")],
        predicates: [{ kind: "connected-access", minimumMm: 700 }],
    }),
    positiveCase({
        id: "OP-02",
        title: "Дверь шириной 700 мм",
        description: "Граничная ширина двери остаётся доверенной для проверки прохода.",
        tags: ["opening", "door", "boundary"],
        room: {
            ...emptyRoom(5000, 4000),
            doors: [
                {
                    id: "door",
                    wall: "bottom",
                    offset: 2150,
                    width: 700,
                    clearanceDepth: 700,
                },
            ],
        },
        instances: [item("bookcase")],
        predicates: [{ kind: "connected-access", minimumMm: 700 }],
    }),
    positiveCase({
        id: "OP-03",
        title: "Два окна и комод",
        description: "Комод соблюдает увеличенные исключения сразу для двух окон.",
        tags: ["opening", "window", "dresser", "migrated-golden"],
        room: {
            ...emptyRoom(7000, 5000),
            windows: [
                { id: "window-1", wall: "top", offset: 500, width: 1200 },
                { id: "window-2", wall: "top", offset: 3200, width: 1200 },
            ],
        },
        instances: [item("bookcase"), item("dresser")],
        predicates: [{ kind: "dresser-away-from-window", minimumMm: 600 }],
    }),
    positiveCase({
        id: "OP-04",
        title: "Радиатор под окном",
        description: "Корпус мебели не пересекает радиатор и его сервисный конверт.",
        tags: ["opening", "window", "radiator", "migrated-golden"],
        room: {
            ...emptyRoom(6000, 4500),
            windows: [{ id: "window", wall: "top", offset: 2000, width: 1500 }],
            radiators: [
                {
                    id: "radiator",
                    wall: "top",
                    offset: 2200,
                    width: 1000,
                    depth: 100,
                    clearanceDepth: 300,
                },
            ],
        },
        instances: [item("bookcase")],
    }),
    positiveCase({
        id: "OP-05",
        title: "Препятствия на соседних стенах",
        description: "Проёмы рядом с углом не создают двумерного конфликта и не зажимают мебель.",
        tags: ["opening", "corner", "two-dimensional"],
        room: {
            ...emptyRoom(6000, 5000),
            doors: [
                {
                    id: "door",
                    wall: "left",
                    offset: 0,
                    width: 900,
                    clearanceDepth: 900,
                    hinge: "start",
                },
            ],
            windows: [{ id: "window", wall: "top", offset: 1400, width: 1400 }],
        },
        instances: [item("bookcase"), item("wardrobe-small")],
        predicates: [{ kind: "connected-access", minimumMm: 700 }],
    }),
    positiveCase({
        id: "OR-01",
        title: "Г-образная комната справа",
        description: "Шкаф примыкает к реальному сегменту и не попадает в вырез контура.",
        tags: ["orthogonal", "l-room", "wall-contact"],
        room: lRoom("right"),
        instances: [item("dresser")],
        predicates: [{ kind: "deterministic" }],
    }),
    positiveCase({
        id: "OR-02",
        title: "Г-образная комната слева",
        description: "Центральный предмет и хранение размещаются только в полезной площади.",
        tags: ["orthogonal", "l-room", "concave"],
        room: lRoom("left"),
        instances: [item("coffee-table"), item("dresser")],
        predicates: [{ kind: "deterministic" }],
    }),
    {
        id: "OR-03",
        title: "Невалидный ортогональный контур",
        description: "Диагональная стена отклоняется до запуска поиска расстановки.",
        source: "curated",
        tags: ["orthogonal", "negative", "invalid-room"],
        room: {
            ...emptyRoom(6000, 4600),
            geometry: {
                version: 1,
                kind: "orthogonal",
                vertices: [
                    { id: "v1", x: 0, y: 0 },
                    { id: "v2", x: 3600, y: 50 },
                    { id: "v3", x: 3600, y: 1800 },
                    { id: "v4", x: 6000, y: 1800 },
                    { id: "v5", x: 6000, y: 4600 },
                    { id: "v6", x: 0, y: 4600 },
                ],
            },
        },
        instances: [item("dresser")],
        requestedVariants: 1,
        expectation: {
            allowedStatuses: ["invalid-room"],
            requiredPredicates: [{ kind: "deterministic" }],
        },
    },
    {
        id: "NG-01",
        title: "Пересекающиеся проёмы",
        description: "Перекрывающиеся дверь и окно отклоняются как некорректная геометрия комнаты.",
        source: "curated",
        tags: ["negative", "invalid-room"],
        room: {
            ...emptyRoom(5000, 4000),
            doors: [
                {
                    id: "door",
                    wall: "top",
                    offset: 1000,
                    width: 900,
                    clearanceDepth: 900,
                },
            ],
            windows: [{ id: "window", wall: "top", offset: 1500, width: 1200 }],
        },
        instances: [item("bookcase")],
        requestedVariants: 1,
        expectation: {
            allowedStatuses: ["invalid-room"],
            requiredPredicates: [{ kind: "deterministic" }],
        },
    },
    {
        id: "NG-02",
        title: "Минимальное удаление",
        description: "Непомещающийся optional-предмет удаляется только после доказанного отказа.",
        source: "curated",
        tags: ["negative", "proven-impossible", "automatic-removal"],
        room: emptyRoom(2400, 2400),
        instances: [item("double-bed", "optional")],
        requestedVariants: 1,
        expectation: {
            allowedStatuses: ["proven-impossible"],
            requiredPredicates: [{ kind: "deterministic" }],
            expectedRemoval: {
                allowedDefinitionIds: ["double-bed"],
                maximumCount: 1,
            },
        },
    },
    {
        id: "NG-03",
        title: "Телевизор без цели",
        description: "ТВ без дивана или кровати отклоняется как некорректный запрос.",
        source: "curated",
        tags: ["negative", "invalid-request", "tv"],
        room: emptyRoom(6000, 5000),
        instances: [item("tv")],
        requestedVariants: 1,
        expectation: {
            allowedStatuses: ["invalid-request"],
            requiredPredicates: [{ kind: "deterministic" }],
        },
    },
    {
        id: "NG-04",
        title: "Операционный лимит поиска",
        description: "Нулевой node budget даёт только search-exhausted, а не ложную невозможность.",
        source: "curated",
        tags: ["negative", "search-exhausted", "budget"],
        room: emptyRoom(5000, 4000),
        instances: [item("bookcase")],
        requestedVariants: 1,
        expectation: {
            allowedStatuses: ["search-exhausted"],
            requiredPredicates: [{ kind: "deterministic" }],
        },
        solverOptions: { maxSearchNodes: 0 },
    },
];

export const getRoomLabCase = (id: string): RoomLabCase => {
    const roomCase = ROOM_LAB_CURATED_CASES.find((candidate) => candidate.id === id);
    if (!roomCase) throw new Error(`Unknown room-lab case: ${id}`);
    return roomCase;
};
