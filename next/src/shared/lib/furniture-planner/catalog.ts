import {
    ClearanceZone,
    CurtainBufferPolicy,
    FurnitureCategory,
    FurnitureBodyEdge,
    FurnitureCatalogSource,
    FurnitureDefinition,
    FurnitureInstance,
    FurnitureSelection,
    FurnitureShape,
    FurnitureSize,
    RelationTemplate,
    Rotation,
    SchematicFurnitureCatalogSource,
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
    requirement: "hard",
});

const preferredFrontExtension = (
    width: number,
    bodyDepth: number,
    hardDepth: number,
    preferredDepth: number,
): ClearanceZone => ({
    x: 0,
    y: bodyDepth + hardDepth,
    width,
    depth: Math.max(0, preferredDepth - hardDepth),
    label: "Желательный дополнительный запас",
    requirement: "preferred",
});

const NIGHTSTAND_HEAD_POCKET = 350;
const COFFEE_TABLE_POCKET = 600;

const bedSideZone = (
    x: number,
    width: number,
    bodyDepth: number,
    label: string,
    requirement: ClearanceZone["requirement"] = "hard",
): ClearanceZone => ({
    x,
    y: NIGHTSTAND_HEAD_POCKET,
    width,
    depth: bodyDepth - NIGHTSTAND_HEAD_POCKET,
    label,
    requirement,
});

const sofaAccessZones = (width: number, bodyDepth: number): ClearanceZone[] => {
    const sideWidth = (width - COFFEE_TABLE_POCKET) / 2;

    return [
        {
            x: 0,
            y: bodyDepth,
            width: sideWidth,
            depth: 700,
            label: "Боковой проход",
            requirement: "hard",
        },
        {
            x: sideWidth + COFFEE_TABLE_POCKET,
            y: bodyDepth,
            width: sideWidth,
            depth: 700,
            label: "Боковой проход",
            requirement: "hard",
        },
    ];
};

/** Keeps an independently standing table usable from every side. */
const allSidesAccessZones = (width: number, depth: number, clearance: number): ClearanceZone[] => [
    {
        x: 0,
        y: -clearance,
        width,
        depth: clearance,
        label: "Проход у стола",
        requirement: "hard",
    },
    {
        x: 0,
        y: depth,
        width,
        depth: clearance,
        label: "Проход у стола",
        requirement: "hard",
    },
    {
        x: -clearance,
        y: 0,
        width: clearance,
        depth,
        label: "Проход у стола",
        requirement: "hard",
    },
    {
        x: width,
        y: 0,
        width: clearance,
        depth,
        label: "Проход у стола",
        requirement: "hard",
    },
];

/**
 * The chaise already makes the sofa a real L-shaped body. Do not turn its
 * concave corner into a hidden rectangular clearance: that space is part of
 * the room and the user may use it for any other item. General body gaps and
 * the connected-passage check still apply to furniture placed there.
 */
const cornerSofaAccessZones = (): ClearanceZone[] => [];

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

export const PROVISIONAL_CURTAIN_BUFFER_MM = 150;
export const DRESSER_WINDOW_EXCLUSION_MM = 600;
export const TV_VIEWING_DISTANCE_MIN_MM = 1400;
export const TV_VIEWING_DISTANCE_MAX_MM = 4500;

/**
 * The designer specified a 150 mm curtain offset but did not identify its
 * axis. Until that is confirmed, geometry uses a conservative 2D envelope:
 * 150 mm on both ends along the wall and 150 mm into the room. Keeping the
 * provisional status in runtime data prevents the approximation from being
 * presented as approved designer truth.
 */
const provisionalCurtainBuffer = (): CurtainBufferPolicy => ({
    distance: PROVISIONAL_CURTAIN_BUFFER_MM,
    model: "conservative-envelope",
    appliesAlongWall: true,
    appliesIntoRoom: true,
    verification: "provisional",
    note: "Направление отступа 150 мм требует подтверждения дизайнера; временно используется консервативный 2D-конверт.",
});

const wallPlacement = (
    centerAllowed: boolean,
    requiredWallContact: boolean,
    allowedWallContactEdges: FurnitureBodyEdge[],
    windowPolicy: FurnitureDefinition["placement"]["windowPolicy"],
    windowExclusionDistance = PROVISIONAL_CURTAIN_BUFFER_MM,
): FurnitureDefinition["placement"] => ({
    centerAllowed,
    requiredWallContact,
    allowedWallContactEdges,
    windowPolicy,
    curtainBuffer: provisionalCurtainBuffer(),
    windowExclusionDistance,
});

const NO_EQUIVALENT_ROTATIONS: Rotation[][] = [];
const ROUND_EQUIVALENT_ROTATIONS: Rotation[][] = [[0, 90, 180, 270]];

const designerSource = (): FurnitureCatalogSource => ({
    drawing: {
        file: "Мебель набор-Лист1.pdf",
        sha256: "a51f5e4b64b615c0ba2df4ee3532241022ac7a4fa3c27a8850904f16c5f3627d",
    },
    rules: {
        file: "Нюансы мебелт.docx",
        sha256: "e5c4545cbc94266fa095978edc80dd61599367fab05db31b000399b6b57dc45a",
    },
    versionPolicy: "sha256-content-addressed",
});

const schematicSource = (): SchematicFurnitureCatalogSource => ({
    kind: "schematic-default",
    version: "2026-08-10-v1",
    note: "Типовой размер для подбора габаритов; перед покупкой требуется сверка с фактической моделью.",
});

/**
 * Standard sizes from the designer's AutoCAD sheets of 2026-10-25: Гардероб.pdf
 * (dfa0e959…), Диваны.pdf (ce28c6a9…), Кровати.pdf (00f0c983…), Столы
 * обеденные.pdf (0d345a09…) and Туалетные и рабочие столы.pdf (e68bde22…).
 */
const size = (width: number, depth: number): FurnitureSize => ({ width, depth });

export const isSchematicFurnitureSource = (
    source: FurnitureDefinition["source"],
): source is SchematicFurnitureCatalogSource =>
    "kind" in source && source.kind === "schematic-default";

export const FURNITURE_CATALOG: FurnitureDefinition[] = [
    {
        id: "single-bed",
        label: "Односпальная кровать",
        shortLabel: "Кровать 1-местная",
        category: "sleep",
        body: rectShape(900, 2000),
        clearanceZones: [bedSideZone(900, 700, 2000, "Проход у кровати")],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back", "front", "left"], "allowed"),
        relations: [],
        maxCount: 1,
        removalPriority: 90,
        assetKey: "single-bed",
        visualKind: "fabric",
        sizes: [size(900, 2000), size(1000, 1800)],
        source: designerSource(),
    },
    {
        id: "double-bed",
        label: "Двуспальная кровать",
        shortLabel: "Кровать 2-местная",
        category: "sleep",
        body: rectShape(1800, 2000),
        clearanceZones: [
            bedSideZone(-700, 700, 2000, "Левый проход", "one-of"),
            bedSideZone(1800, 700, 2000, "Правый проход", "one-of"),
            {
                x: 0,
                y: 2000,
                width: 1800,
                depth: 700,
                label: "Проход в ногах",
                requirement: "hard",
            },
        ],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back"], "allowed"),
        relations: [],
        maxCount: 1,
        removalPriority: 95,
        assetKey: "double-bed",
        visualKind: "fabric",
        sizes: [size(1400, 2000), size(1600, 2000), size(1800, 2000)],
        source: designerSource(),
    },
    {
        id: "cradle",
        label: "Детская люлька",
        shortLabel: "Люлька",
        category: "children",
        body: rectShape(640, 1200),
        clearanceZones: [
            {
                x: 640,
                y: 0,
                width: 700,
                depth: 1200,
                label: "Доступ к люльке",
                requirement: "hard",
            },
        ],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, false, ["back", "front", "left"], "forbidden"),
        relations: [
            relation("aligned-side", "sleep", {
                targetDefinitionIds: ["double-bed"],
                // A cradle is often close to the parents' bed, but it may
                // also stand safely in another part of the room. Keep this
                // as an auto-layout preference, not a manual-placement ban.
                required: false,
                minGap: 750,
                maxGap: 800,
            }),
        ],
        maxCount: 1,
        removalPriority: 88,
        assetKey: "cradle",
        visualKind: "nursery",
        source: designerSource(),
    },
    {
        id: "bookcase",
        label: "Книжный шкаф",
        shortLabel: "Книжный шкаф",
        category: "storage",
        body: rectShape(800, 300),
        clearanceZones: [frontZone(800, 300, 700)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 1,
        removalPriority: 50,
        assetKey: "bookcase",
        visualKind: "wood",
        source: designerSource(),
    },
    {
        id: "wardrobe-small",
        label: "Шкаф для одежды, малый",
        shortLabel: "Шкаф малый",
        category: "storage",
        body: rectShape(700, 500),
        clearanceZones: [frontZone(700, 500, 800), preferredFrontExtension(700, 500, 800, 1000)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 2,
        removalPriority: 80,
        assetKey: "wardrobe-small",
        visualKind: "wood",
        sizes: [size(600, 450), size(700, 500)],
        source: designerSource(),
    },
    {
        id: "wardrobe-medium",
        label: "Шкаф для одежды, средний",
        shortLabel: "Шкаф средний",
        category: "storage",
        body: rectShape(1500, 600),
        clearanceZones: [frontZone(1500, 600, 800), preferredFrontExtension(1500, 600, 800, 1000)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 2,
        removalPriority: 82,
        assetKey: "wardrobe-medium",
        visualKind: "wood",
        sizes: [size(900, 600), size(1350, 600), size(1500, 600)],
        source: designerSource(),
    },
    {
        id: "wardrobe-large",
        label: "Шкаф для одежды, большой",
        shortLabel: "Шкаф большой",
        category: "storage",
        body: rectShape(2000, 600),
        clearanceZones: [frontZone(2000, 600, 800), preferredFrontExtension(2000, 600, 800, 1000)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 2,
        removalPriority: 84,
        assetKey: "wardrobe-large",
        visualKind: "wood",
        source: designerSource(),
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
        clearanceZones: [
            {
                x: 0,
                y: 600,
                width: 1200,
                depth: 700,
                label: "Рабочая зона",
                requirement: "hard",
            },
        ],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "left"], "preferred"),
        relations: [],
        maxCount: 1,
        removalPriority: 60,
        assetKey: "desk",
        visualKind: "surface",
        source: designerSource(),
    },
    {
        id: "bedside-table",
        label: "Прикроватная тумба",
        shortLabel: "Тумба",
        category: "storage",
        body: rectShape(400, 350),
        clearanceZones: [frontZone(400, 350, 700)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, false, ["back", "right", "left"], "allowed"),
        relations: [
            relation("adjacent", "sleep", {
                minGap: 50,
                maxGap: 100,
                clearanceOverlapException: "target-clearance",
            }),
        ],
        maxCount: 2,
        removalPriority: 20,
        assetKey: "bedside-table",
        visualKind: "wood",
        source: designerSource(),
    },
    {
        id: "dresser",
        label: "Комод",
        shortLabel: "Комод",
        category: "storage",
        body: rectShape(600, 400),
        clearanceZones: [frontZone(600, 400, 700), preferredFrontExtension(600, 400, 700, 1000)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(
            false,
            true,
            ["back", "right", "left"],
            "forbidden",
            DRESSER_WINDOW_EXCLUSION_MM,
        ),
        relations: [],
        maxCount: 1,
        removalPriority: 30,
        assetKey: "dresser",
        visualKind: "wood",
        sizes: [size(600, 400), size(900, 400)],
        source: designerSource(),
    },
    {
        id: "coffee-table",
        label: "Кофейный столик",
        shortLabel: "Кофейный столик",
        category: "living",
        body: circleShape(500),
        clearanceZones: [],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: ROUND_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "front", "left"], "allowed"),
        relations: [
            relation("front-gap", "living", {
                required: false,
                minGap: 350,
                maxGap: 450,
                clearanceOverlapException: "target-clearance",
            }),
        ],
        maxCount: 1,
        removalPriority: 10,
        assetKey: "coffee-table",
        visualKind: "surface",
        source: designerSource(),
    },
    {
        id: "tv",
        label: "Телевизор",
        shortLabel: "ТВ",
        category: "media",
        body: rectShape(750, 100),
        clearanceZones: [],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back"], "forbidden"),
        relations: [
            relation("faces", "living", {
                required: false,
                minGap: TV_VIEWING_DISTANCE_MIN_MM,
                maxGap: TV_VIEWING_DISTANCE_MAX_MM,
            }),
            relation("faces", "sleep", {
                required: false,
                minGap: TV_VIEWING_DISTANCE_MIN_MM,
                maxGap: TV_VIEWING_DISTANCE_MAX_MM,
            }),
        ],
        maxCount: 1,
        removalPriority: 40,
        assetKey: "tv",
        visualKind: "screen",
        source: designerSource(),
    },
    {
        id: "sofa-two",
        label: "Диван на двоих",
        shortLabel: "Диван на 2 места",
        category: "living",
        body: rectShape(1600, 950),
        clearanceZones: sofaAccessZones(1600, 950),
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 1,
        removalPriority: 70,
        assetKey: "sofa-two",
        visualKind: "fabric",
        sizes: [size(1600, 950), size(1800, 1000), size(2000, 1000)],
        source: designerSource(),
    },
    {
        id: "sofa-three",
        label: "Диван на троих",
        shortLabel: "Диван на 3 места",
        category: "living",
        body: rectShape(2200, 950),
        clearanceZones: sofaAccessZones(2200, 950),
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 1,
        removalPriority: 72,
        assetKey: "sofa-three",
        visualKind: "fabric",
        sizes: [size(2200, 950), size(2500, 1200), size(2700, 1200)],
        source: designerSource(),
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
                { x: 0, y: 950, width: 730, depth: 550 },
            ],
        },
        clearanceZones: cornerSofaAccessZones(),
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 1,
        removalPriority: 74,
        assetKey: "sofa-four-left",
        visualKind: "fabric",
        source: designerSource(),
    },
    {
        id: "dining-table",
        label: "Обеденный стол, схема 1200 × 800 мм",
        shortLabel: "Обеденный стол",
        category: "living",
        body: rectShape(1200, 800),
        clearanceZones: allSidesAccessZones(1200, 800, 700),
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "front", "left"], "forbidden"),
        relations: [],
        maxCount: 1,
        removalPriority: 65,
        visualKind: "surface",
        source: schematicSource(),
    },
    {
        id: "dining-chair",
        label: "Обеденный стул, схема 450 × 500 мм",
        shortLabel: "Стул",
        category: "living",
        body: rectShape(450, 500),
        clearanceZones: [frontZone(450, 500, 500)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "front", "left"], "forbidden"),
        relations: [],
        maxCount: 6,
        removalPriority: 15,
        visualKind: "wood",
        source: schematicSource(),
    },
    {
        id: "armchair",
        label: "Кресло, схема 900 × 900 мм",
        shortLabel: "Кресло",
        category: "living",
        body: rectShape(900, 900),
        clearanceZones: [frontZone(900, 900, 700)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 2,
        removalPriority: 55,
        visualKind: "fabric",
        sizes: [size(800, 790), size(1000, 950)],
        source: schematicSource(),
    },
    {
        id: "tv-console",
        label: "Тумба под ТВ, схема 1400 × 450 мм",
        shortLabel: "Тумба под ТВ",
        category: "storage",
        body: rectShape(1400, 450),
        clearanceZones: [frontZone(1400, 450, 700)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: NO_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(false, true, ["back", "right", "left"], "forbidden"),
        relations: [],
        maxCount: 1,
        removalPriority: 35,
        visualKind: "wood",
        sizes: [925, 1165, 1325, 1435, 1655, 1875].map((width) => size(width, 400)),
        source: schematicSource(),
    },
    {
        id: "pouf",
        label: "Пуф, схема Ø500 мм",
        shortLabel: "Пуф",
        category: "living",
        body: circleShape(500),
        clearanceZones: [],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: ROUND_EQUIVALENT_ROTATIONS,
        placement: wallPlacement(true, false, ["back", "right", "front", "left"], "forbidden"),
        relations: [],
        maxCount: 2,
        removalPriority: 10,
        visualKind: "fabric",
        source: schematicSource(),
    },
];

/**
 * Editable planning defaults. Dining groups include their chairs: the envelopes
 * are the designer's dashed outlines, measured at the sheet's scale.
 */
export const ADDITIONAL_FURNITURE_CATALOG: FurnitureDefinition[] = [
    {
        id: "dining-square-four",
        label: "Квадратный стол и 4 стула",
        width: 2340,
        depth: 2340,
        category: "living" as const,
    },
    {
        id: "dining-round-four",
        label: "Круглый стол и 4 стула",
        width: 2260,
        depth: 2260,
        category: "living" as const,
    },
    {
        id: "dining-oval-six",
        label: "Овальный стол и 6 стульев",
        width: 2960,
        depth: 2090,
        category: "living" as const,
    },
    {
        id: "dining-rect-six",
        label: "Прямоугольный стол и 6 стульев",
        width: 3000,
        depth: 2200,
        category: "living" as const,
    },
    {
        id: "coffee-table-rect",
        label: "Журнальный столик",
        width: 1000,
        depth: 550,
        category: "living" as const,
    },
    {
        id: "aquarium",
        label: "Аквариум с тумбой",
        width: 1000,
        depth: 600,
        category: "living" as const,
    },
    {
        id: "pet-bed",
        label: "Лежанка для питомца",
        width: 800,
        depth: 600,
        category: "living" as const,
    },
    {
        id: "litter-box",
        label: "Кошачий лоток",
        width: 550,
        depth: 400,
        category: "living" as const,
    },
    {
        id: "child-bed",
        label: "Детская кровать",
        width: 800,
        depth: 1600,
        category: "children" as const,
    },
    {
        id: "dressing-table",
        label: "Туалетный столик",
        width: 900,
        depth: 400,
        category: "work" as const,
        sizes: [size(900, 350), size(900, 400), size(950, 450), size(1100, 450)],
    },
    {
        id: "sofa-bed",
        label: "Диван-кровать",
        width: 2000,
        depth: 1000,
        category: "living" as const,
        sizes: [size(1400, 1000), size(2000, 1000)],
        // The designer drew the unfolded berth as deep as the sofa itself.
        frontZone: { depth: 1000, label: "Зона раскладывания" },
    },
].map(({ id, label, width, depth, category, sizes, frontZone: front }) => ({
    id,
    label,
    shortLabel: label,
    category,
    body: rectShape(width, depth),
    // Dining dimensions include the chairs; reserve space outside the entire group.
    clearanceZones: id.startsWith("dining-")
        ? allSidesAccessZones(width, depth, 600)
        : [
              front
                  ? { ...frontZone(width, depth, front.depth), label: front.label }
                  : frontZone(width, depth, 600),
          ],
    rotations: [0, 90, 180, 270],
    equivalentRotationGroups: [],
    placement: wallPlacement(true, false, ["back", "right", "left"], "forbidden"),
    relations: [],
    maxCount: id === "child-bed" ? 2 : 1,
    removalPriority: id === "child-bed" ? 80 : 25,
    visualKind: ["child-bed", "pet-bed", "sofa-bed"].includes(id) ? "fabric" : "wood",
    source: schematicSource(),
    ...(sizes ? { sizes } : {}),
}));

FURNITURE_CATALOG.push(...ADDITIONAL_FURNITURE_CATALOG);

/**
 * Kitchen units in common Russian module sizes: 60 cm deep worktop run,
 * 35 cm deep upper units. Placed by hand on the drawing; the automatic
 * layout does not offer them yet (see CATEGORY_ORDER).
 */
export const KITCHEN_FURNITURE_CATALOG: FurnitureDefinition[] = [
    {
        id: "kitchen-base-600",
        label: "Напольный шкаф 60 см",
        short: "Шкаф 60",
        width: 600,
        depth: 600,
        max: 12,
    },
    {
        id: "kitchen-base-400",
        label: "Напольный шкаф 40 см",
        short: "Шкаф 40",
        width: 400,
        depth: 600,
        max: 8,
    },
    {
        id: "kitchen-sink",
        label: "Мойка с тумбой 80 см",
        short: "Мойка",
        width: 800,
        depth: 600,
        max: 2,
        window: "allowed" as const,
    },
    {
        id: "kitchen-cooker",
        label: "Плита с духовкой 60 см",
        short: "Плита",
        width: 600,
        depth: 600,
        max: 2,
    },
    {
        id: "kitchen-dishwasher",
        label: "Посудомоечная машина 60 см",
        short: "ПММ",
        width: 600,
        depth: 600,
        max: 1,
    },
    {
        id: "kitchen-washer",
        label: "Стиральная машина",
        short: "Стир. маш.",
        width: 600,
        depth: 600,
        max: 1,
    },
    {
        id: "kitchen-fridge",
        label: "Холодильник",
        short: "Холодильник",
        width: 600,
        depth: 650,
        max: 2,
        tall: true,
    },
    {
        id: "kitchen-fridge-wide",
        label: "Холодильник двухдверный",
        short: "Холодильник",
        width: 900,
        depth: 700,
        max: 1,
        tall: true,
    },
    {
        id: "kitchen-tall",
        label: "Шкаф-пенал 60 см",
        short: "Пенал",
        width: 600,
        depth: 600,
        max: 4,
        tall: true,
    },
    {
        id: "kitchen-island",
        label: "Кухонный остров",
        short: "Остров",
        width: 1200,
        depth: 900,
        max: 1,
        island: true,
    },
    {
        id: "kitchen-upper-600",
        label: "Навесной шкаф 60 см",
        short: "Навесной 60",
        width: 600,
        depth: 350,
        max: 12,
        upper: true,
    },
    {
        id: "kitchen-upper-400",
        label: "Навесной шкаф 40 см",
        short: "Навесной 40",
        width: 400,
        depth: 350,
        max: 8,
        upper: true,
    },
    {
        id: "kitchen-hood",
        label: "Вытяжка 60 см",
        short: "Вытяжка",
        width: 600,
        depth: 500,
        max: 1,
        upper: true,
    },
].map(
    ({
        id,
        label,
        short,
        width,
        depth,
        max,
        window,
        tall,
        island,
        upper,
    }: {
        id: string;
        label: string;
        short: string;
        width: number;
        depth: number;
        max: number;
        window?: "allowed";
        tall?: boolean;
        island?: boolean;
        upper?: boolean;
    }): FurnitureDefinition => ({
        id,
        label,
        shortLabel: short,
        category: "kitchen",
        body: rectShape(width, depth),
        // A cook needs room to open doors and stand at the worktop.
        clearanceZones: upper
            ? []
            : island
              ? allSidesAccessZones(width, depth, 900)
              : [frontZone(width, depth, 900)],
        rotations: [0, 90, 180, 270],
        equivalentRotationGroups: [],
        placement: island
            ? wallPlacement(true, false, [], "allowed")
            : wallPlacement(
                  false,
                  true,
                  ["back"],
                  window ?? (tall || upper ? "forbidden" : "allowed"),
              ),
        relations: [],
        maxCount: max,
        removalPriority: 30,
        visualKind: upper || tall ? "wood" : "surface",
        source: schematicSource(),
        ...(upper ? { mounting: "upper" as const } : {}),
    }),
);

FURNITURE_CATALOG.push(...KITCHEN_FURNITURE_CATALOG);

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
    kitchen: "Кухня",
};

/** Categories the automatic layout offers; kitchen units are placed by hand for now. */
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

export const relationTargetsDefinition = (
    relationTemplate: RelationTemplate,
    targetDefinition: FurnitureDefinition,
): boolean =>
    targetDefinition.category === relationTemplate.targetCategory &&
    (relationTemplate.targetDefinitionIds === undefined ||
        relationTemplate.targetDefinitionIds.includes(targetDefinition.id));

export const getViewingDistanceRange = (
    definition: FurnitureDefinition,
    targetCategory: "sleep" | "living",
): { minimum: number; maximum: number } => {
    const relation = definition.relations.find(
        (candidate) => candidate.kind === "faces" && candidate.targetCategory === targetCategory,
    );

    return {
        minimum: relation?.minGap ?? 0,
        maximum: relation?.maxGap ?? Number.POSITIVE_INFINITY,
    };
};

export const getMaximumFurnitureCount = (definitionId: string): number =>
    getFurniture(definitionId).maxCount;

export const buildFurnitureInstances = (selection: FurnitureSelection): FurnitureInstance[] =>
    FURNITURE_CATALOG.flatMap((definition) => {
        const selected = selection[definition.id];
        const count = Math.max(
            0,
            Math.min(getMaximumFurnitureCount(definition.id), selected?.count ?? 0),
        );

        const priority =
            selected?.priority ?? (selected?.required === true ? "required" : "preferred");

        return Array.from({ length: count }, (_, index) => ({
            instanceId: `${definition.id}-${index + 1}`,
            definitionId: definition.id,
            priority,
            required: priority === "required",
        }));
    });
