import {
    FURNITURE_CATALOG,
    type FurnitureDefinition,
    type RoomKind,
} from "@/shared/lib/furniture-planner";
import { KITCHEN_BATH_DESIGN_ENABLED, isFurnitureOffered } from "./room-availability";

export interface FurnitureMenuGroup {
    label: string;
    ids: string[];
}

export interface FurnitureMenuSection {
    id: string;
    label: string;
    /** The piece whose symbol stands for the section in the catalogue rail. */
    icon: string;
    groups: FurnitureMenuGroup[];
}

/**
 * The furniture catalogue as a two-level menu, like Remplanner's: a section
 * of the home, then groups of similar pieces. Every catalogue piece appears
 * exactly once.
 */
export const FURNITURE_MENU: FurnitureMenuSection[] = [
    {
        id: "living-bedroom",
        label: "Гостиная и спальня",
        icon: "double-bed",
        groups: [
            { label: "Кровати", ids: ["single-bed", "double-bed"] },
            { label: "Диваны", ids: ["sofa-two", "sofa-three", "sofa-four-left", "sofa-bed"] },
            { label: "Кресла и пуфы", ids: ["armchair", "pouf"] },
            { label: "Столики", ids: ["coffee-table", "coffee-table-rect", "dressing-table"] },
            { label: "Комоды и тумбы", ids: ["dresser", "bedside-table"] },
        ],
    },
    {
        id: "kitchen-dining",
        label: "Кухня и столовая",
        icon: "dining-round-four",
        groups: [
            {
                label: "Напольные шкафы",
                ids: ["kitchen-base-600", "kitchen-base-400", "kitchen-sink"],
            },
            {
                label: "Навесные шкафы",
                ids: ["kitchen-upper-600", "kitchen-upper-400", "kitchen-hood"],
            },
            { label: "Шкафы-пеналы", ids: ["kitchen-tall"] },
            { label: "Кухонные острова", ids: ["kitchen-island"] },
            {
                label: "Обеденные столы",
                ids: [
                    "dining-round-four",
                    "dining-square-four",
                    "dining-oval-six",
                    "dining-rect-six",
                    "dining-table",
                ],
            },
            { label: "Стулья", ids: ["dining-chair"] },
        ],
    },
    {
        id: "appliances",
        label: "Бытовая техника",
        icon: "kitchen-cooker",
        groups: [
            { label: "Холодильники", ids: ["kitchen-fridge", "kitchen-fridge-wide"] },
            { label: "Плиты", ids: ["kitchen-cooker"] },
            { label: "Стирка и посуда", ids: ["kitchen-washer", "kitchen-dishwasher"] },
            { label: "ТВ и мультимедиа", ids: ["tv", "tv-console"] },
        ],
    },
    {
        id: "wardrobe-hallway",
        label: "Гардероб и прихожая",
        icon: "wardrobe-medium",
        groups: [
            {
                label: "Шкафы для одежды",
                ids: ["wardrobe-small", "wardrobe-medium", "wardrobe-large", "wardrobe-corner"],
            },
            {
                label: "Гардеробные",
                ids: [
                    "walk-in-u",
                    "walk-in-l",
                    "walk-in-rows",
                    "walk-in-wardrobes",
                    "walk-in-dressers",
                ],
            },
        ],
    },
    {
        id: "children",
        label: "Детская",
        icon: "cradle",
        groups: [{ label: "Кровати", ids: ["child-bed", "cradle"] }],
    },
    {
        id: "office",
        label: "Кабинет и офис",
        icon: "desk",
        groups: [
            { label: "Столы", ids: ["desk", "desk-pedestal"] },
            {
                label: "Угловые столы",
                ids: [
                    "desk-corner-narrow",
                    "desk-corner-1200",
                    "desk-corner-1600",
                    "desk-corner-1600-1400",
                    "desk-corner-1800",
                ],
            },
            { label: "Стеллажи", ids: ["bookcase"] },
        ],
    },
    {
        id: "pets",
        label: "Для питомцев",
        icon: "pet-bed",
        groups: [{ label: "Питомцы и аквариумы", ids: ["pet-bed", "litter-box", "aquarium"] }],
    },
];

/** Sections that change once kitchen units are out of the menu. */
const SECTIONS_WITHOUT_KITCHEN: Record<string, Pick<FurnitureMenuSection, "label" | "icon">> = {
    "kitchen-dining": { label: "Столовая", icon: "dining-round-four" },
    appliances: { label: "ТВ и мультимедиа", icon: "tv" },
};

/** The menu as people see it: {@link FURNITURE_MENU} less what is not offered yet. */
export const OFFERED_FURNITURE_MENU: FurnitureMenuSection[] = KITCHEN_BATH_DESIGN_ENABLED
    ? FURNITURE_MENU
    : FURNITURE_MENU.map((section) => ({
          ...section,
          ...SECTIONS_WITHOUT_KITCHEN[section.id],
          groups: section.groups
              .map((group) => ({ ...group, ids: group.ids.filter(isFurnitureOffered) }))
              .filter((group) => group.ids.length > 0),
      }));

const KIND_SECTIONS: Record<RoomKind, string[]> = {
    bedroom: ["living-bedroom", "wardrobe-hallway", "office"],
    living: ["living-bedroom", "appliances", "wardrobe-hallway"],
    kitchen: ["kitchen-dining", "appliances"],
    children: ["children", "living-bedroom", "wardrobe-hallway", "office"],
    office: ["office", "living-bedroom", "wardrobe-hallway"],
    hallway: ["wardrobe-hallway", "living-bedroom"],
    bathroom: ["appliances"],
    other: [],
};

/** Menu sections for a room: what suits its kind first, the rest after. */
export function furnitureMenuOrder(kind?: RoomKind): FurnitureMenuSection[] {
    const preferred = kind ? KIND_SECTIONS[kind] : [];
    const rank = (section: FurnitureMenuSection) => {
        const index = preferred.indexOf(section.id);
        return index === -1 ? preferred.length : index;
    };
    return [...OFFERED_FURNITURE_MENU].sort((first, second) => rank(first) - rank(second));
}

const byId = new Map(FURNITURE_CATALOG.map((definition) => [definition.id, definition]));

export const menuGroupDefinitions = (group: FurnitureMenuGroup): FurnitureDefinition[] =>
    group.ids.map((id) => byId.get(id)!);

/** Pieces whose name matches the query, in menu order. */
export function searchFurnitureMenu(query: string): FurnitureDefinition[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return OFFERED_FURNITURE_MENU.flatMap((section) =>
        section.groups.flatMap(menuGroupDefinitions),
    ).filter((definition) => definition.label.toLowerCase().includes(needle));
}
