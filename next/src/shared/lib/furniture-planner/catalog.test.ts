import { describe, expect, it } from "vitest";

import {
    DRESSER_WINDOW_EXCLUSION_MM,
    FURNITURE_CATALOG,
    PROVISIONAL_CURTAIN_BUFFER_MM,
    TV_VIEWING_DISTANCE_MAX_MM,
    TV_VIEWING_DISTANCE_MIN_MM,
    buildFurnitureInstances,
    getFurniture,
    relationTargetsDefinition,
} from "./catalog";
import { getBounds, getRotatedGeometry } from "./geometry";
import {
    ClearanceZone,
    FurnitureBodyEdge,
    FurnitureCategory,
    Rect,
    RelationTemplate,
    Rotation,
} from "./types";

const BODY_MANIFEST: Record<string, Rect[]> = {
    "single-bed": [{ x: 0, y: 0, width: 900, depth: 2000 }],
    "double-bed": [{ x: 0, y: 0, width: 1800, depth: 2000 }],
    cradle: [{ x: 0, y: 0, width: 640, depth: 1200 }],
    bookcase: [{ x: 0, y: 0, width: 800, depth: 300 }],
    "wardrobe-small": [{ x: 0, y: 0, width: 700, depth: 500 }],
    "wardrobe-medium": [{ x: 0, y: 0, width: 1500, depth: 600 }],
    "wardrobe-large": [{ x: 0, y: 0, width: 2000, depth: 600 }],
    desk: [
        { x: 0, y: 0, width: 1200, depth: 600 },
        { x: 375, y: 850, width: 450, depth: 450 },
    ],
    "bedside-table": [{ x: 0, y: 0, width: 400, depth: 350 }],
    dresser: [{ x: 0, y: 0, width: 600, depth: 400 }],
    "coffee-table": [{ x: 0, y: 0, width: 500, depth: 500 }],
    tv: [{ x: 0, y: 0, width: 750, depth: 100 }],
    "sofa-two": [{ x: 0, y: 0, width: 1600, depth: 950 }],
    "sofa-three": [{ x: 0, y: 0, width: 2200, depth: 950 }],
    "sofa-four-left": [
        { x: 0, y: 0, width: 2200, depth: 950 },
        { x: 0, y: 950, width: 730, depth: 550 },
    ],
    "dining-table": [{ x: 0, y: 0, width: 1200, depth: 800 }],
    "dining-chair": [{ x: 0, y: 0, width: 450, depth: 500 }],
    armchair: [{ x: 0, y: 0, width: 900, depth: 900 }],
    "tv-console": [{ x: 0, y: 0, width: 1400, depth: 450 }],
    pouf: [{ x: 0, y: 0, width: 500, depth: 500 }],
};

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const WINDOW_ALLOWED = ["single-bed", "double-bed", "desk", "bedside-table", "coffee-table"];
const WALL_EDGE_MANIFEST: Record<string, FurnitureBodyEdge[]> = {
    "single-bed": ["back", "front", "left"],
    "double-bed": ["back"],
    cradle: ["back", "front", "left"],
    bookcase: ["back", "right", "left"],
    "wardrobe-small": ["back", "right", "left"],
    "wardrobe-medium": ["back", "right", "left"],
    "wardrobe-large": ["back", "right", "left"],
    desk: ["back", "right", "left"],
    "bedside-table": ["back", "right", "left"],
    dresser: ["back", "right", "left"],
    "coffee-table": ["back", "right", "front", "left"],
    tv: ["back"],
    "sofa-two": ["back", "right", "left"],
    "sofa-three": ["back", "right", "left"],
    "sofa-four-left": ["back", "right", "left"],
    "dining-table": ["back", "right", "front", "left"],
    "dining-chair": ["back", "right", "front", "left"],
    armchair: ["back", "right", "left"],
    "tv-console": ["back", "right", "left"],
    pouf: ["back", "right", "front", "left"],
};
const CLEARANCE_MANIFEST: Record<string, ClearanceZone[]> = {
    "single-bed": [
        {
            x: 900,
            y: 350,
            width: 700,
            depth: 1650,
            label: "Проход у кровати",
            requirement: "hard",
        },
    ],
    "double-bed": [
        {
            x: -700,
            y: 350,
            width: 700,
            depth: 1650,
            label: "Левый проход",
            requirement: "one-of",
        },
        {
            x: 1800,
            y: 350,
            width: 700,
            depth: 1650,
            label: "Правый проход",
            requirement: "one-of",
        },
        {
            x: 0,
            y: 2000,
            width: 1800,
            depth: 700,
            label: "Проход в ногах",
            requirement: "hard",
        },
    ],
    cradle: [
        {
            x: 640,
            y: 0,
            width: 700,
            depth: 1200,
            label: "Доступ к люльке",
            requirement: "hard",
        },
    ],
    bookcase: [
        {
            x: 0,
            y: 300,
            width: 800,
            depth: 700,
            label: "Зона доступа",
            requirement: "hard",
        },
    ],
    "wardrobe-small": [
        {
            x: 0,
            y: 500,
            width: 700,
            depth: 800,
            label: "Зона доступа",
            requirement: "hard",
        },
        {
            x: 0,
            y: 1300,
            width: 700,
            depth: 200,
            label: "Желательный дополнительный запас",
            requirement: "preferred",
        },
    ],
    "wardrobe-medium": [
        {
            x: 0,
            y: 600,
            width: 1500,
            depth: 800,
            label: "Зона доступа",
            requirement: "hard",
        },
        {
            x: 0,
            y: 1400,
            width: 1500,
            depth: 200,
            label: "Желательный дополнительный запас",
            requirement: "preferred",
        },
    ],
    "wardrobe-large": [
        {
            x: 0,
            y: 600,
            width: 2000,
            depth: 800,
            label: "Зона доступа",
            requirement: "hard",
        },
        {
            x: 0,
            y: 1400,
            width: 2000,
            depth: 200,
            label: "Желательный дополнительный запас",
            requirement: "preferred",
        },
    ],
    desk: [
        {
            x: 0,
            y: 600,
            width: 1200,
            depth: 700,
            label: "Рабочая зона",
            requirement: "hard",
        },
    ],
    "bedside-table": [
        {
            x: 0,
            y: 350,
            width: 400,
            depth: 700,
            label: "Зона доступа",
            requirement: "hard",
        },
    ],
    dresser: [
        {
            x: 0,
            y: 400,
            width: 600,
            depth: 700,
            label: "Зона доступа",
            requirement: "hard",
        },
        {
            x: 0,
            y: 1100,
            width: 600,
            depth: 300,
            label: "Желательный дополнительный запас",
            requirement: "preferred",
        },
    ],
    "coffee-table": [],
    tv: [],
    "sofa-two": [
        {
            x: 0,
            y: 950,
            width: 500,
            depth: 700,
            label: "Боковой проход",
            requirement: "hard",
        },
        {
            x: 1100,
            y: 950,
            width: 500,
            depth: 700,
            label: "Боковой проход",
            requirement: "hard",
        },
    ],
    "sofa-three": [
        {
            x: 0,
            y: 950,
            width: 800,
            depth: 700,
            label: "Боковой проход",
            requirement: "hard",
        },
        {
            x: 1400,
            y: 950,
            width: 800,
            depth: 700,
            label: "Боковой проход",
            requirement: "hard",
        },
    ],
    "sofa-four-left": [],
    "dining-table": [
        {
            x: 0,
            y: -700,
            width: 1200,
            depth: 700,
            label: "Проход у стола",
            requirement: "hard",
        },
        {
            x: 0,
            y: 800,
            width: 1200,
            depth: 700,
            label: "Проход у стола",
            requirement: "hard",
        },
        {
            x: -700,
            y: 0,
            width: 700,
            depth: 800,
            label: "Проход у стола",
            requirement: "hard",
        },
        {
            x: 1200,
            y: 0,
            width: 700,
            depth: 800,
            label: "Проход у стола",
            requirement: "hard",
        },
    ],
    "dining-chair": [
        {
            x: 0,
            y: 500,
            width: 450,
            depth: 500,
            label: "Зона доступа",
            requirement: "hard",
        },
    ],
    armchair: [
        {
            x: 0,
            y: 900,
            width: 900,
            depth: 700,
            label: "Зона доступа",
            requirement: "hard",
        },
    ],
    "tv-console": [
        {
            x: 0,
            y: 450,
            width: 1400,
            depth: 700,
            label: "Зона доступа",
            requirement: "hard",
        },
    ],
    pouf: [],
};
const MAX_COUNT_MANIFEST: Record<string, number> = {
    "single-bed": 1,
    "double-bed": 1,
    cradle: 1,
    bookcase: 1,
    "wardrobe-small": 2,
    "wardrobe-medium": 2,
    "wardrobe-large": 2,
    desk: 1,
    "bedside-table": 2,
    dresser: 1,
    "coffee-table": 1,
    tv: 1,
    "sofa-two": 1,
    "sofa-three": 1,
    "sofa-four-left": 1,
    "dining-table": 1,
    "dining-chair": 6,
    armchair: 2,
    "tv-console": 1,
    pouf: 2,
};
const VISUAL_KIND_MANIFEST: Record<string, string> = {
    "single-bed": "fabric",
    "double-bed": "fabric",
    cradle: "nursery",
    bookcase: "wood",
    "wardrobe-small": "wood",
    "wardrobe-medium": "wood",
    "wardrobe-large": "wood",
    desk: "surface",
    "bedside-table": "wood",
    dresser: "wood",
    "coffee-table": "surface",
    tv: "screen",
    "sofa-two": "fabric",
    "sofa-three": "fabric",
    "sofa-four-left": "fabric",
    "dining-table": "surface",
    "dining-chair": "wood",
    armchair: "fabric",
    "tv-console": "wood",
    pouf: "fabric",
};
const RELATION_MANIFEST: Record<string, RelationTemplate[]> = {
    "single-bed": [],
    "double-bed": [],
    cradle: [
        {
            kind: "aligned-side",
            targetCategory: "sleep",
            targetDefinitionIds: ["double-bed"],
            required: false,
            minGap: 750,
            maxGap: 800,
        },
    ],
    bookcase: [],
    "wardrobe-small": [],
    "wardrobe-medium": [],
    "wardrobe-large": [],
    desk: [],
    "bedside-table": [
        {
            kind: "adjacent",
            targetCategory: "sleep",
            required: true,
            minGap: 50,
            maxGap: 100,
            clearanceOverlapException: "target-clearance",
        },
    ],
    dresser: [],
    "coffee-table": [
        {
            kind: "front-gap",
            targetCategory: "living",
            required: false,
            minGap: 350,
            maxGap: 450,
            clearanceOverlapException: "target-clearance",
        },
    ],
    tv: [
        {
            kind: "faces",
            targetCategory: "living",
            required: false,
            minGap: TV_VIEWING_DISTANCE_MIN_MM,
            maxGap: TV_VIEWING_DISTANCE_MAX_MM,
        },
        {
            kind: "faces",
            targetCategory: "sleep",
            required: false,
            minGap: TV_VIEWING_DISTANCE_MIN_MM,
            maxGap: TV_VIEWING_DISTANCE_MAX_MM,
        },
    ],
    "sofa-two": [],
    "sofa-three": [],
    "sofa-four-left": [],
    "dining-table": [],
    "dining-chair": [],
    armchair: [],
    "tv-console": [],
    pouf: [],
};
const DEFINITION_METADATA_MANIFEST: Record<
    string,
    {
        label: string;
        shortLabel: string;
        category: FurnitureCategory;
        centerAllowed: boolean;
        requiredWallContact: boolean;
        removalPriority: number;
    }
> = {
    "single-bed": {
        label: "Односпальная кровать",
        shortLabel: "Кровать 1-местная",
        category: "sleep",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 90,
    },
    "double-bed": {
        label: "Двуспальная кровать",
        shortLabel: "Кровать 2-местная",
        category: "sleep",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 95,
    },
    cradle: {
        label: "Детская люлька",
        shortLabel: "Люлька",
        category: "children",
        centerAllowed: false,
        requiredWallContact: false,
        removalPriority: 88,
    },
    bookcase: {
        label: "Книжный шкаф",
        shortLabel: "Книжный шкаф",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 50,
    },
    "wardrobe-small": {
        label: "Шкаф для одежды, малый",
        shortLabel: "Шкаф 700 мм",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 80,
    },
    "wardrobe-medium": {
        label: "Шкаф для одежды, средний",
        shortLabel: "Шкаф 1500 мм",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 82,
    },
    "wardrobe-large": {
        label: "Шкаф для одежды, большой",
        shortLabel: "Шкаф 2000 мм",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 84,
    },
    desk: {
        label: "Письменный стол со стулом",
        shortLabel: "Письменный стол",
        category: "work",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 60,
    },
    "bedside-table": {
        label: "Прикроватная тумба",
        shortLabel: "Тумба",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: false,
        removalPriority: 20,
    },
    dresser: {
        label: "Комод",
        shortLabel: "Комод",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 30,
    },
    "coffee-table": {
        label: "Кофейный столик",
        shortLabel: "Кофейный столик",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 10,
    },
    tv: {
        label: "Телевизор",
        shortLabel: "ТВ",
        category: "media",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 40,
    },
    "sofa-two": {
        label: "Диван на двоих",
        shortLabel: "Диван на 2 места",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 70,
    },
    "sofa-three": {
        label: "Диван на троих",
        shortLabel: "Диван на 3 места",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 72,
    },
    "sofa-four-left": {
        label: "Угловой диван на четверых, левый",
        shortLabel: "Угловой диван",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 74,
    },
    "dining-table": {
        label: "Обеденный стол, схема 1200 × 800 мм",
        shortLabel: "Обеденный стол",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 65,
    },
    "dining-chair": {
        label: "Обеденный стул, схема 450 × 500 мм",
        shortLabel: "Стул",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 15,
    },
    armchair: {
        label: "Кресло, схема 900 × 900 мм",
        shortLabel: "Кресло",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 55,
    },
    "tv-console": {
        label: "Тумба под ТВ, схема 1400 × 450 мм",
        shortLabel: "Тумба под ТВ",
        category: "storage",
        centerAllowed: false,
        requiredWallContact: true,
        removalPriority: 35,
    },
    pouf: {
        label: "Пуф, схема Ø500 мм",
        shortLabel: "Пуф",
        category: "living",
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: 10,
    },
};
// Planning defaults for the supplied September image set. Dimensions include chairs.
const suppliedFurniture: [string, string, number, number, FurnitureCategory, string][] = [
    ["dining-square-four", "Квадратный стол и 4 стула", 2000, 2000, "living", "wood"],
    ["dining-round-four", "Круглый стол и 4 стула", 2100, 2100, "living", "wood"],
    ["dining-oval-six", "Овальный стол и 6 стульев", 2800, 1900, "living", "wood"],
    ["dining-rect-six", "Прямоугольный стол и 6 стульев", 2800, 1900, "living", "wood"],
    ["coffee-table-rect", "Журнальный столик", 1000, 550, "living", "wood"],
    ["aquarium", "Аквариум с тумбой", 1000, 600, "living", "wood"],
    ["pet-bed", "Лежанка для питомца", 800, 600, "living", "fabric"],
    ["litter-box", "Кошачий лоток", 550, 400, "living", "wood"],
    ["child-bed", "Детская кровать", 800, 1600, "children", "fabric"],
];
for (const [id, label, width, depth, category, visualKind] of suppliedFurniture) {
    BODY_MANIFEST[id] = [{ x: 0, y: 0, width, depth }];
    WALL_EDGE_MANIFEST[id] = ["back", "right", "left"];
    CLEARANCE_MANIFEST[id] = id.startsWith("dining-")
        ? [
              { x: 0, y: -600, width, depth: 600 },
              { x: 0, y: depth, width, depth: 600 },
              { x: -600, y: 0, width: 600, depth },
              { x: width, y: 0, width: 600, depth },
          ].map((rect) => ({ ...rect, label: "Проход у стола", requirement: "hard" }))
        : [{ x: 0, y: depth, width, depth: 600, label: "Зона доступа", requirement: "hard" }];
    DEFINITION_METADATA_MANIFEST[id] = {
        label,
        shortLabel: label,
        category,
        centerAllowed: true,
        requiredWallContact: false,
        removalPriority: id === "child-bed" ? 80 : 25,
    };
    RELATION_MANIFEST[id] = [];
    MAX_COUNT_MANIFEST[id] = id === "child-bed" ? 2 : 1;
    VISUAL_KIND_MANIFEST[id] = visualKind;
}

const area = (rects: Rect[]) => rects.reduce((total, rect) => total + rect.width * rect.depth, 0);

describe("furniture catalog golden manifest", () => {
    it("keeps every designer and schematic body definition in the golden manifest", () => {
        expect(FURNITURE_CATALOG.map((definition) => definition.id)).toEqual(
            Object.keys(BODY_MANIFEST),
        );

        for (const definition of FURNITURE_CATALOG) {
            expect(definition.body.rects, definition.id).toEqual(BODY_MANIFEST[definition.id]);
            expect(definition.rotations, definition.id).toEqual(ROTATIONS);
        }
    });

    it("keeps the corner sofa's concave corner free for other furniture", () => {
        const sofa = getFurniture("sofa-four-left");
        const geometry = getRotatedGeometry(sofa, 0);

        expect(geometry.bodyRects).toEqual(BODY_MANIFEST["sofa-four-left"]);
        expect(getBounds(geometry.bodyRects)).toEqual({ x: 0, y: 0, width: 2200, depth: 1500 });
        expect(geometry.clearanceRects).toEqual([]);
        expect(getBounds(geometry.bodyRects)).toEqual({
            x: 0,
            y: 0,
            width: 2200,
            depth: 1500,
        });
    });

    it.each(ROTATIONS)("preserves every body and clearance area at %i degrees", (rotation) => {
        for (const definition of FURNITURE_CATALOG) {
            const geometry = getRotatedGeometry(definition, rotation);
            const originalBounds = getBounds(definition.body.rects);
            const expectedWidth =
                rotation === 90 || rotation === 270 ? originalBounds.depth : originalBounds.width;
            const expectedDepth =
                rotation === 90 || rotation === 270 ? originalBounds.width : originalBounds.depth;

            expect(area(geometry.bodyRects), definition.id).toBe(area(definition.body.rects));
            expect(area(geometry.clearanceRects), definition.id).toBe(
                area(definition.clearanceZones),
            );
            expect(geometry.width, definition.id).toBe(expectedWidth);
            expect(geometry.depth, definition.id).toBe(expectedDepth);
        }
    });

    it("targets a cradle relation only at the double bed definition", () => {
        const cradleRelation = getFurniture("cradle").relations[0];

        expect(cradleRelation.required).toBe(false);
        expect(cradleRelation.targetCategory).toBe("sleep");
        expect(cradleRelation.targetDefinitionIds).toEqual(["double-bed"]);
        expect(relationTargetsDefinition(cradleRelation, getFurniture("double-bed"))).toBe(true);
        expect(relationTargetsDefinition(cradleRelation, getFurniture("single-bed"))).toBe(false);
        expect(relationTargetsDefinition(cradleRelation, getFurniture("sofa-two"))).toBe(false);
    });

    it("locks every non-dotted wall-contact edge from the designer drawing", () => {
        expect(Object.keys(WALL_EDGE_MANIFEST)).toEqual(
            FURNITURE_CATALOG.map((definition) => definition.id),
        );

        for (const definition of FURNITURE_CATALOG) {
            expect(definition.placement.allowedWallContactEdges, definition.id).toEqual(
                WALL_EDGE_MANIFEST[definition.id],
            );
        }
    });

    it("locks exact clearances, relation exceptions, counts, symmetry and source metadata", () => {
        for (const definition of FURNITURE_CATALOG) {
            const metadata = DEFINITION_METADATA_MANIFEST[definition.id];

            expect(definition.clearanceZones, definition.id).toEqual(
                CLEARANCE_MANIFEST[definition.id],
            );
            expect(
                {
                    label: definition.label,
                    shortLabel: definition.shortLabel,
                    category: definition.category,
                    centerAllowed: definition.placement.centerAllowed,
                    requiredWallContact: definition.placement.requiredWallContact,
                    removalPriority: definition.removalPriority,
                },
                definition.id,
            ).toEqual(metadata);
            expect(definition.relations, definition.id).toEqual(RELATION_MANIFEST[definition.id]);
            expect(definition.maxCount, definition.id).toBe(MAX_COUNT_MANIFEST[definition.id]);
            expect(definition.equivalentRotationGroups, definition.id).toEqual(
                ["coffee-table", "pouf"].includes(definition.id) ? [[0, 90, 180, 270]] : [],
            );
            if ("kind" in definition.source) {
                expect(definition.source, definition.id).toEqual({
                    kind: "schematic-default",
                    version: "2026-08-10-v1",
                    note: "Типовой размер для подбора габаритов; перед покупкой требуется сверка с фактической моделью.",
                });
                expect(definition.assetKey, definition.id).toBeUndefined();
            } else {
                expect(definition.source, definition.id).toEqual({
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
                expect(definition.assetKey, definition.id).toBe(definition.id);
            }
            expect(definition.visualKind, definition.id).toBe(VISUAL_KIND_MANIFEST[definition.id]);
        }
    });

    it("locks the source-document window permission matrix", () => {
        for (const definition of FURNITURE_CATALOG) {
            const expected = WINDOW_ALLOWED.includes(definition.id)
                ? definition.id === "desk"
                    ? "preferred"
                    : "allowed"
                : "forbidden";

            expect(definition.placement.windowPolicy, definition.id).toBe(expected);
        }
    });

    it("keeps the 150 mm curtain direction explicit and provisional", () => {
        for (const definition of FURNITURE_CATALOG) {
            expect(definition.placement.curtainBuffer, definition.id).toEqual(
                expect.objectContaining({
                    distance: PROVISIONAL_CURTAIN_BUFFER_MM,
                    model: "conservative-envelope",
                    appliesAlongWall: true,
                    appliesIntoRoom: true,
                    verification: "provisional",
                }),
            );
            expect(definition.placement.curtainBuffer.note, definition.id).toContain(
                "подтверждения дизайнера",
            );
        }
    });

    it("stores furniture-specific window exclusions in the runtime catalog", () => {
        for (const definition of FURNITURE_CATALOG) {
            expect(definition.placement.windowExclusionDistance, definition.id).toBe(
                definition.id === "dresser"
                    ? DRESSER_WINDOW_EXCLUSION_MM
                    : PROVISIONAL_CURTAIN_BUFFER_MM,
            );
        }
    });

    it("does not invent clearance for the round coffee table and declares rotation symmetry", () => {
        const coffeeTable = getFurniture("coffee-table");

        expect(coffeeTable.clearanceZones).toEqual([]);
        expect(coffeeTable.equivalentRotationGroups).toEqual([[0, 90, 180, 270]]);
    });

    it("propagates all three user priorities and derives only a safe legacy default", () => {
        const instances = buildFurnitureInstances({
            "single-bed": { count: 1, required: true, priority: "required" },
            bookcase: { count: 1, required: false, priority: "preferred" },
            dresser: { count: 1, required: false, priority: "optional" },
            desk: { count: 1, required: false },
        });

        expect(
            instances.map(({ definitionId, priority, required }) => ({
                definitionId,
                priority,
                required,
            })),
        ).toEqual([
            { definitionId: "single-bed", priority: "required", required: true },
            { definitionId: "bookcase", priority: "preferred", required: false },
            { definitionId: "desk", priority: "preferred", required: false },
            { definitionId: "dresser", priority: "optional", required: false },
        ]);
    });
});
