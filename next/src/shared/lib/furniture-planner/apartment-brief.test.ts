import { describe, expect, it } from "vitest";
import { allocateApartmentBrief, type BriefRoom } from "./apartment-brief";
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
});
