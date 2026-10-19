import { describe, expect, it } from "vitest";

import {
    answersFromDraft,
    getDefaultPriority,
    getPlannerInputsSignature,
    getQueryString,
    getWardrobeItems,
    getWardrobeTotal,
    INITIAL_ANSWERS,
    pluralizeFurniture,
} from "./model";

describe("questionnaire model", () => {
    it("reconstructs mutually exclusive choices and bounded bedside-table count", () => {
        expect(
            answersFromDraft(
                [
                    { definitionId: "double-bed", count: 1 },
                    { definitionId: "sofa-three", count: 1 },
                    { definitionId: "wardrobe-medium", count: 1 },
                    { definitionId: "bedside-table", count: 7 },
                    { definitionId: "tv", count: 1 },
                ],
                "living",
            ),
        ).toMatchObject({
            bed: "double-bed",
            sofa: "sofa-three",
            wardrobes: {
                "wardrobe-small": 0,
                "wardrobe-medium": 1,
                "wardrobe-large": 0,
            },
            bedsideTableCount: 2,
            tv: true,
            tvTargetCategory: "living",
        });
    });

    it("round-trips two wardrobe types from a planner draft without dropping either", () => {
        const answers = answersFromDraft([
            { definitionId: "wardrobe-small", count: 1 },
            { definitionId: "wardrobe-large", count: 1 },
        ]);

        expect(answers.wardrobes).toEqual({
            "wardrobe-small": 1,
            "wardrobe-medium": 0,
            "wardrobe-large": 1,
        });
        expect(getWardrobeTotal(answers.wardrobes)).toBe(2);
        expect(getWardrobeItems(answers.wardrobes)).toEqual([
            { definitionId: "wardrobe-small", count: 1 },
            { definitionId: "wardrobe-large", count: 1 },
        ]);
    });

    it("round-trips two wardrobes of one type and keeps legacy single-item drafts", () => {
        const doubleWardrobe = answersFromDraft([{ definitionId: "wardrobe-medium", count: 2 }]);
        const legacySingleWardrobe = answersFromDraft([
            { definitionId: "wardrobe-medium", count: 1 },
        ]);

        expect(getWardrobeItems(doubleWardrobe.wardrobes)).toEqual([
            { definitionId: "wardrobe-medium", count: 2 },
        ]);
        expect(getWardrobeItems(legacySingleWardrobe.wardrobes)).toEqual([
            { definitionId: "wardrobe-medium", count: 1 },
        ]);
    });

    it("defensively limits malformed wardrobe inputs to the editable total of two", () => {
        const answers = answersFromDraft([
            { definitionId: "wardrobe-small", count: 2 },
            { definitionId: "wardrobe-large", count: 2 },
        ]);

        expect(getWardrobeTotal(answers.wardrobes)).toBe(2);
        expect(getWardrobeItems(answers.wardrobes)).toEqual([
            { definitionId: "wardrobe-small", count: 2 },
        ]);
    });

    it("drops orphan dependent answers instead of reviving them after a parent is selected", () => {
        const answers = answersFromDraft(
            [
                { definitionId: "cradle", count: 1 },
                { definitionId: "bedside-table", count: 2 },
                { definitionId: "coffee-table", count: 1 },
                { definitionId: "tv", count: 1 },
            ],
            "living",
        );

        expect(answers).toMatchObject({
            bed: "none",
            sofa: "none",
            cradle: false,
            bedsideTableCount: 0,
            coffeeTable: false,
            tv: false,
        });
        expect(answers.tvTargetCategory).toBeUndefined();
    });

    it("normalizes television target and cradle against the restored parent choice", () => {
        const singleBed = answersFromDraft(
            [
                { definitionId: "single-bed", count: 1 },
                { definitionId: "cradle", count: 1 },
                { definitionId: "tv", count: 1 },
            ],
            "living",
        );
        const sofa = answersFromDraft(
            [
                { definitionId: "sofa-two", count: 1 },
                { definitionId: "tv", count: 1 },
            ],
            "sleep",
        );

        expect(singleBed.cradle).toBe(false);
        expect(singleBed.tvTargetCategory).toBe("sleep");
        expect(sofa.tvTargetCategory).toBe("living");
    });

    it("treats every item chosen in the questionnaire as required by default", () => {
        const answers = { ...INITIAL_ANSWERS, bed: "single-bed" as const };

        expect(getDefaultPriority("single-bed", answers)).toBe("required");
        expect(getDefaultPriority("dresser", answers)).toBe("required");
    });

    it("normalizes query metadata and Russian item labels", () => {
        expect(getQueryString("  Прованс  ", 5)).toBe("Прова");
        expect(getQueryString(["Прованс"], 20)).toBeUndefined();
        expect([1, 2, 5, 11, 21].map(pluralizeFurniture)).toEqual([
            "1 предмет",
            "2 предмета",
            "5 предметов",
            "11 предметов",
            "21 предмет",
        ]);
    });

    it("compares planner inputs independently from item order", () => {
        const first = getPlannerInputsSignature(
            [
                { definitionId: "dresser", count: 1, priority: "optional" },
                { definitionId: "double-bed", count: 1, priority: "required" },
            ],
            { tvTargetCategory: "sleep" },
        );
        const second = getPlannerInputsSignature(
            [
                { definitionId: "double-bed", count: 1, priority: "required" },
                { definitionId: "dresser", count: 1, priority: "optional" },
            ],
            { tvTargetCategory: "sleep" },
        );

        expect(first).toBe(second);
        expect(
            getPlannerInputsSignature(
                [{ definitionId: "double-bed", count: 1, priority: "required" }],
                { tvTargetCategory: "sleep" },
            ),
        ).not.toBe(first);
    });
});
