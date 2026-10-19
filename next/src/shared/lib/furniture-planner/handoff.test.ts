import { describe, expect, it } from "vitest";
import { normalizeQuestionnairePlannerInput } from "./handoff";

const inputWithItem = (item: {
    definitionId: string;
    count: number;
    required: boolean;
    priority?: "required" | "preferred" | "optional";
}) => ({
    version: 1,
    source: "questionnaire",
    createdAt: 1_750_000_000_000,
    items: [item],
});

describe("questionnaire handoff priorities", () => {
    it("accepts a user-selected optional priority for any furniture class", () => {
        const result = normalizeQuestionnairePlannerInput(
            inputWithItem({
                definitionId: "double-bed",
                count: 1,
                required: false,
                priority: "optional",
            }),
        );

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.value.items[0]).toMatchObject({
                definitionId: "double-bed",
                required: false,
                priority: "optional",
            });
        }
    });

    it("migrates a legacy boolean-only item to a priority", () => {
        const result = normalizeQuestionnairePlannerInput(
            inputWithItem({ definitionId: "single-bed", count: 1, required: true }),
        );

        expect(result.status).toBe("success");
        if (result.status === "success") {
            expect(result.value.items[0].priority).toBe("required");
        }
    });

    it("rejects contradictory required and priority values", () => {
        expect(
            normalizeQuestionnairePlannerInput(
                inputWithItem({
                    definitionId: "single-bed",
                    count: 1,
                    required: true,
                    priority: "preferred",
                }),
            ),
        ).toEqual({ status: "invalid", reason: "invalid-required" });
    });
});
