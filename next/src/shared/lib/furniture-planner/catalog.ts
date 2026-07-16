import {
    ClearanceZone,
    FurnitureCategory,
    FurnitureDefinition,
    FurnitureInstance,
    FurnitureSelection,
    FurnitureShape,
    RelationTemplate,
} from "./types";

const rectShape = (width: number, depth: number): FurnitureShape => ({
    kind: "rects",
    rects: [{ x: 0, y: 0, width, depth }],
});

const circleShape = (diameter: number): FurnitureShape => ({
    kind: "circle",
    rects: [{ x: 0, y: 0, width: diameter, depth: diameter }],
});

const frontZone = (width: number, bodyDepth: number, depth: number): ClearanceZone => ({
    x: 0,
    y: bodyDepth,
    width,
    depth,
    label: "Зона доступа",
});

const NIGHTSTAND_HEAD_POCKET = 350;
const COFFEE_TABLE_POCKET = 600;

const bedSideZone = (
    x: number,
    width: number,
    bodyDepth: number,
    label: string,
): ClearanceZone => ({
    x,
    y: NIGHTSTAND_HEAD_POCKET,
    width,
    depth: bodyDepth - NIGHTSTAND_HEAD_POCKET,
    label,
});

const sofaAccessZones = (width: number, bodyDepth: number): ClearanceZone[] => {
    const sideWidth = (width - COFFEE_TABLE_POCKET) / 2;

    return [
        { x: 0, y: bodyDepth, width: sideWidth, depth: 700, label: "Боковой проход" },
        {
            x: sideWidth + COFFEE_TABLE_POCKET,
            y: bodyDepth,
            width: sideWidth,
            depth: 700,
            label: "Боковой проход",
        },
    ];
};

const relation = (
    kind: RelationTemplate["kind"],
    targetCategory: FurnitureCategory,
    options: Partial<RelationTemplate> = {},
): RelationTemplate => ({
    kind,
    targetCategory,
    required: true,
    ...options,
});

export const FURNITURE_CATALOG: FurnitureDefinition[] = [
    {
        id: "single-bed",
        label: "Односпальная кровать",
        shortLabel: "Кровать 1-местная",
        category: "sleep",
        body: rectShape(900, 2000),
        clearanceZones: [bedSideZone(900, 700, 2000, "Проход у кровати")],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [],
        removalPriority: 90,
        assetKey: "single-bed",
        visualKind: "fabric",
    },
    {
        id: "double-bed",
        label: "Двуспальная кровать",
        shortLabel: "Кровать 2-местная",
        category: "sleep",
        body: rectShape(1800, 2000),
        clearanceZones: [
            bedSideZone(-700, 700, 2000, "Левый проход"),
            bedSideZone(1800, 700, 2000, "Правый проход"),
            { x: 0, y: 2000, width: 1800, depth: 700, label: "Проход в ногах" },
        ],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: true,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [],
        removalPriority: 95,
        assetKey: "double-bed",
        visualKind: "fabric",
    },
    {
        id: "cradle",
        label: "Детская люлька",
        shortLabel: "Люлька",
        category: "children",
        body: rectShape(640, 1200),
        clearanceZones: [{ x: 640, y: 0, width: 700, depth: 1200, label: "Доступ к люльке" }],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [relation("aligned-side", "sleep", { minGap: 750, maxGap: 800 })],
        removalPriority: 88,
        assetKey: "cradle",
        visualKind: "nursery",
    },
    {
        id: "bookcase",
        label: "Книжный шкаф",
        shortLabel: "Книжный шкаф",
        category: "storage",
        body: rectShape(800, 300),
        clearanceZones: [frontZone(800, 300, 700)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "forbidden",
        },
        relations: [],
        removalPriority: 50,
        assetKey: "bookcase",
        visualKind: "wood",
    },
    {
        id: "wardrobe-small",
        label: "Шкаф для одежды, малый",
        shortLabel: "Шкаф 700 мм",
        category: "storage",
        body: rectShape(700, 500),
        clearanceZones: [frontZone(700, 500, 800)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "forbidden",
        },
        relations: [],
        removalPriority: 80,
        assetKey: "wardrobe-small",
        visualKind: "wood",
    },
    {
        id: "wardrobe-medium",
        label: "Шкаф для одежды, средний",
        shortLabel: "Шкаф 1500 мм",
        category: "storage",
        body: rectShape(1500, 600),
        clearanceZones: [frontZone(1500, 600, 800)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "forbidden",
        },
        relations: [],
        removalPriority: 82,
        assetKey: "wardrobe-medium",
        visualKind: "wood",
    },
    {
        id: "wardrobe-large",
        label: "Шкаф для одежды, большой",
        shortLabel: "Шкаф 2000 мм",
        category: "storage",
        body: rectShape(2000, 600),
        clearanceZones: [frontZone(2000, 600, 800)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "forbidden",
        },
        relations: [],
        removalPriority: 84,
        assetKey: "wardrobe-large",
        visualKind: "wood",
    },
    {
        id: "desk",
        label: "Письменный стол со стулом",
        shortLabel: "Письменный стол",
        category: "work",
        body: {
            kind: "rects",
            rects: [
                { x: 0, y: 0, width: 1200, depth: 600 },
                { x: 375, y: 850, width: 450, depth: 450 },
            ],
        },
        clearanceZones: [{ x: 0, y: 600, width: 1200, depth: 700, label: "Рабочая зона" }],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: true,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "preferred",
        },
        relations: [],
        removalPriority: 60,
        assetKey: "desk",
        visualKind: "surface",
    },
    {
        id: "bedside-table",
        label: "Прикроватная тумба",
        shortLabel: "Тумба",
        category: "storage",
        body: rectShape(400, 350),
        clearanceZones: [frontZone(400, 350, 700)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [relation("adjacent", "sleep", { minGap: 50, maxGap: 100 })],
        removalPriority: 20,
        assetKey: "bedside-table",
        visualKind: "wood",
    },
    {
        id: "dresser",
        label: "Комод",
        shortLabel: "Комод",
        category: "storage",
        body: rectShape(600, 400),
        clearanceZones: [frontZone(600, 400, 700)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [],
        removalPriority: 30,
        assetKey: "dresser",
        visualKind: "wood",
    },
    {
        id: "coffee-table",
        label: "Кофейный столик",
        shortLabel: "Кофейный столик",
        category: "living",
        body: circleShape(500),
        clearanceZones: [frontZone(500, 500, 700)],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: true,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [relation("front-gap", "living", { minGap: 350, maxGap: 450 })],
        removalPriority: 10,
        assetKey: "coffee-table",
        visualKind: "surface",
    },
    {
        id: "tv",
        label: "Телевизор",
        shortLabel: "ТВ",
        category: "media",
        body: rectShape(750, 100),
        clearanceZones: [],
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: false,
            requiredWallContact: true,
            wallSide: "back",
            windowPolicy: "forbidden",
        },
        relations: [relation("faces", "living", { required: false })],
        removalPriority: 40,
        assetKey: "tv",
        visualKind: "screen",
    },
    {
        id: "sofa-two",
        label: "Диван на двоих",
        shortLabel: "Диван на 2 места",
        category: "living",
        body: rectShape(1600, 950),
        clearanceZones: sofaAccessZones(1600, 950),
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: true,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [],
        removalPriority: 70,
        assetKey: "sofa-two",
        visualKind: "fabric",
    },
    {
        id: "sofa-three",
        label: "Диван на троих",
        shortLabel: "Диван на 3 места",
        category: "living",
        body: rectShape(2200, 950),
        clearanceZones: sofaAccessZones(2200, 950),
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: true,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [],
        removalPriority: 72,
        assetKey: "sofa-three",
        visualKind: "fabric",
    },
    {
        id: "sofa-four-left",
        label: "Угловой диван на четверых, левый",
        shortLabel: "Угловой диван",
        category: "living",
        body: {
            kind: "rects",
            rects: [
                { x: 0, y: 0, width: 2200, depth: 950 },
                { x: 0, y: 950, width: 730, depth: 1250 },
            ],
        },
        clearanceZones: sofaAccessZones(2200, 2200),
        rotations: [0, 90, 180, 270],
        placement: {
            centerAllowed: true,
            requiredWallContact: false,
            wallSide: "back",
            windowPolicy: "allowed",
        },
        relations: [],
        removalPriority: 74,
        assetKey: "sofa-four-left",
        visualKind: "fabric",
    },
];

export const FURNITURE_BY_ID = new Map(
    FURNITURE_CATALOG.map((definition) => [definition.id, definition]),
);

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
    sleep: "Сон",
    storage: "Хранение",
    work: "Работа",
    living: "Гостиная",
    media: "Медиа",
    children: "Детская",
};

export const CATEGORY_ORDER: FurnitureCategory[] = [
    "sleep",
    "storage",
    "work",
    "living",
    "media",
    "children",
];

export const getFurniture = (definitionId: string): FurnitureDefinition => {
    const definition = FURNITURE_BY_ID.get(definitionId);

    if (!definition) {
        throw new Error(`Unknown furniture definition: ${definitionId}`);
    }

    return definition;
};

export const getMaximumFurnitureCount = (definitionId: string): number =>
    definitionId === "bedside-table" || definitionId.startsWith("wardrobe-") ? 2 : 1;

export const buildFurnitureInstances = (selection: FurnitureSelection): FurnitureInstance[] =>
    FURNITURE_CATALOG.flatMap((definition) => {
        const selected = selection[definition.id];
        const count = Math.max(
            0,
            Math.min(getMaximumFurnitureCount(definition.id), selected?.count ?? 0),
        );

        return Array.from({ length: count }, (_, index) => ({
            instanceId: `${definition.id}-${index + 1}`,
            definitionId: definition.id,
            required: selected?.required ?? false,
        }));
    });
