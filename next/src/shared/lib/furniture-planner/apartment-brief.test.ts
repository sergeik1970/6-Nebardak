import { describe, expect, it } from "vitest";
import {
    allocateApartmentBrief,
    normalizeApartmentBrief,
    storageNeeds,
    wardrobesFor,
    type BriefRoom,
} from "./apartment-brief";
import { selectionLadderFrom } from "./furniture-selection";

const room = (signature: string, kind: BriefRoom["kind"], areaM2: number): BriefRoom => ({
    signature,
    kind,
    areaM2,
});

const ids = (pieces: { definitionId: string; count: number }[] = []) =>
    pieces.flatMap((item) => Array(item.count).fill(item.definitionId));

describe("apartment brief", () => {
    const flat = [
        room("big", "bedroom", 15),
        room("small", "bedroom", 11),
        room("kids", "children", 12),
        room("living", "living", 19),
    ];

    it("gives an ordinary family a double bed, bedside tables and a TV by default", () => {
        const { pieces, notes } = allocateApartmentBrief(flat);

        expect(ids(pieces.get("big"))).toEqual(
            expect.arrayContaining(["double-bed", "bedside-table", "bedside-table"]),
        );
        expect(ids(pieces.get("living"))).toEqual(expect.arrayContaining(["tv", "tv-console"]));
        expect(notes).toEqual([]);
    });

    it("puts two adults per bedroom, the largest first, and children two to a room", () => {
        const { pieces } = allocateApartmentBrief(flat, {
            version: 1,
            adults: 3,
            children: 3,
        });

        expect(ids(pieces.get("big"))[0]).toBe("double-bed");
        expect(ids(pieces.get("small"))[0]).toBe("double-bed");
        expect(ids(pieces.get("kids")).filter((id) => id === "single-bed")).toHaveLength(2);
        expect(pieces.get("kids")?.[0].size).toEqual({ width: 1400, depth: 2000 });
    });

    it("names the people who found no bed", () => {
        const { notes } = allocateApartmentBrief(flat, { version: 1, adults: 2, children: 4 });

        expect(notes).toEqual(["Не хватило комнат: 1 ребёнку нужно ещё место для сна."]);
    });

    it("puts a cot in the children's room, then with the parents", () => {
        const { pieces } = allocateApartmentBrief(flat, { version: 1, babies: 2 });

        expect(ids(pieces.get("kids"))).toContain("cradle");
        expect(ids(pieces.get("big"))).toContain("cradle");
    });

    it("follows the sofa, armchair, TV, desk, dressing table and bedside answers", () => {
        const { pieces } = allocateApartmentBrief(flat, {
            version: 1,
            sofaSeats: 4,
            armchairs: 2,
            tv: "none",
            desks: 2,
            dressingTable: true,
            bedsideTables: "one",
        });

        expect(pieces.get("living")?.[0].definitionId).toBe("sofa-four-left");
        expect(ids(pieces.get("living")).filter((id) => id === "armchair")).toHaveLength(2);
        expect(ids(pieces.get("living"))).not.toContain("tv");
        // Desks: the children's room first, then the main bedroom.
        expect(ids(pieces.get("kids"))).toContain("desk");
        expect(ids(pieces.get("big"))).toEqual(expect.arrayContaining(["desk", "dressing-table"]));
        expect(ids(pieces.get("big")).filter((id) => id === "bedside-table")).toHaveLength(1);
    });

    it("gives way first in what the person ranked lowest", () => {
        const pieces = allocateApartmentBrief([room("big", "bedroom", 15)]).pieces.get("big")!;
        const firstChange = (priorities: Parameters<typeof selectionLadderFrom>[2]) =>
            selectionLadderFrom("bedroom", pieces, priorities)[1].changes[0];

        // By default the bed shrinks first; a person who ranks the bed first keeps it.
        expect(firstChange(undefined)).toMatchObject({ definitionId: "double-bed" });
        expect(firstChange(["bed", "storage"])).toMatchObject({
            kind: "left-out",
            definitionId: "dresser",
        });
        expect(firstChange(["storage", "bed"])).toMatchObject({ definitionId: "double-bed" });
    });

    it("reads saved answers back safely", () => {
        expect(normalizeApartmentBrief(undefined)).toBeUndefined();
        expect(normalizeApartmentBrief({ version: 2, adults: 2 })).toBeUndefined();
        expect(
            normalizeApartmentBrief({
                version: 1,
                adults: 99,
                children: -3,
                babies: "two",
                sofaSeats: 5,
                tv: "large",
                bedsideTables: "per-sleeper",
                dressingTable: true,
                priorities: ["bed", "bed", "sleep", "tv"],
                storage: { longHangers: "20-40", shoePairs: "lots", shortHangers: 999 },
                extra: "ignored",
            }),
        ).toEqual({
            version: 1,
            adults: 8,
            children: 0,
            tv: "large",
            bedsideTables: "per-sleeper",
            dressingTable: true,
            priorities: ["bed", "tv"],
            storage: { longHangers: "20-40", shortHangers: 300 },
        });
    });

    describe("storage", () => {
        it("follows the designer's numbers", () => {
            // 20 coats = 2.4 m of rail in one tier; 20 pairs = a 1 m section; 0–2 bulky = 40 cm.
            expect(
                storageNeeds({ longHangers: "10-20", shoePairs: "10-20", bulkyItems: "0-2" }),
            ).toMatchObject({ hallway: 2400 + 1000 + 400, hallwayTwoTiers: 1200 + 1000 + 400 });
            // 30 shirts in two tiers = 0.6 m, one shelf block = 0.4 m; 5+ m of books = 2 bookcases.
            expect(
                storageNeeds({ shortHangers: 30, shelfBlocks: 1, bookMeters: "5+" }),
            ).toMatchObject({ clothes: 600 + 400, bookcases: 2 });
        });

        it("turns a length into wardrobes of that length", () => {
            expect(wardrobesFor(1000)).toEqual([
                { definitionId: "wardrobe-medium", count: 1, size: { width: 1000, depth: 600 } },
            ]);
            expect(wardrobesFor(620)[0]).toMatchObject({
                definitionId: "wardrobe-small",
                size: { width: 650, depth: 500 },
            });
            expect(wardrobesFor(3800)[0]).toMatchObject({
                definitionId: "wardrobe-large",
                count: 2,
                size: { width: 1900 },
            });
            expect(wardrobesFor(0)).toEqual([]);
        });

        const withHall = [...flat, room("hall", "hallway", 6)];

        it("sizes the hallway wardrobe and gives way to two tiers first", () => {
            const { pieces, hallwayStorage } = allocateApartmentBrief(withHall, {
                version: 1,
                storage: { longHangers: "10-20", shoePairs: "10-20", bulkyItems: "0-2" },
            });

            const [wardrobe] = pieces.get("hall")!;
            expect(wardrobe).toMatchObject({ definitionId: "wardrobe-large", count: 2 });
            expect(wardrobe.smaller?.[0]).toMatchObject({
                reason: "верхняя одежда в два яруса",
                size: { width: 1300 },
            });
            expect(hallwayStorage).toEqual({
                signature: "hall",
                lengthMm: 3800,
                overflowTo: "big",
            });
        });

        it("shares clothes by who sleeps where, and sends coats to a bedroom without a hallway", () => {
            const { pieces, notes } = allocateApartmentBrief(flat, {
                version: 1,
                adults: 2,
                children: 2,
                storage: { shortHangers: 60, shelfBlocks: 2, longHangers: "none" },
            });
            const wardrobe = (signature: string) =>
                pieces.get(signature)!.find((item) => item.definitionId.startsWith("wardrobe-"));

            // 60 × 4 cm in two tiers + 2 × 40 cm = 2 m, half for the parents, half for the children;
            // without a hallway the parents also take 20 pairs of shoes (1 m) and 0.4 m of bulky things.
            expect(wardrobe("big")?.size?.width).toBe(1000 + 1000 + 400);
            expect(wardrobe("kids")?.size?.width).toBe(1000);
            expect(notes).toContain(
                "В квартире нет прихожей: верхняя одежда и обувь — в шкафу спальни.",
            );
        });

        it("puts bookcases where the books need them", () => {
            const { pieces } = allocateApartmentBrief([...flat, room("study", "office", 9)], {
                version: 1,
                storage: { bookMeters: "5+" },
            });
            const has = (signature: string) => ids(pieces.get(signature)).includes("bookcase");

            expect(has("living")).toBe(true);
            expect(has("study")).toBe(true);
            expect(has("kids")).toBe(false);
        });
    });
});
