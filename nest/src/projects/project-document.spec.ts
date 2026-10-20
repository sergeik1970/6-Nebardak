import {
    MAX_PROJECT_DOCUMENT_BYTES,
    MAX_PROJECT_DOCUMENT_DEPTH,
    findProjectDocumentProblem,
} from "./project-document";

const valid = {
    version: 4,
    updatedAt: 1,
    questionnaire: { items: [] },
    planner: { room: { width: 4000, depth: 3000 } },
};

describe("project document envelope", () => {
    it("accepts the documents the planner writes", () => {
        expect(findProjectDocumentProblem(valid)).toBeNull();
        expect(
            findProjectDocumentProblem({ ...valid, version: 5, drawing: {} }),
        ).toBeNull();
    });

    it.each([null, [], "text", 4])("rejects a non-object %p", (document) => {
        expect(findProjectDocumentProblem(document)).toBe("not-object");
    });

    it.each([undefined, 3, 6, "4"])(
        "rejects version %p the frontend never writes",
        (version) => {
            expect(findProjectDocumentProblem({ ...valid, version })).toBe(
                "unsupported-version",
            );
        },
    );

    it("rejects unknown top-level sections", () => {
        expect(findProjectDocumentProblem({ ...valid, payload: "x" })).toBe(
            "unknown-section",
        );
    });

    it("bounds the serialized size", () => {
        const big = "x".repeat(MAX_PROJECT_DOCUMENT_BYTES);
        expect(
            findProjectDocumentProblem({ ...valid, planner: { note: big } }),
        ).toBe("too-large");
    });

    it("bounds nesting so validation and storage stay cheap", () => {
        let nested: Record<string, unknown> = {};
        const root = nested;
        for (
            let index = 0;
            index < MAX_PROJECT_DOCUMENT_DEPTH + 1;
            index += 1
        ) {
            nested.child = {};
            nested = nested.child as Record<string, unknown>;
        }
        expect(findProjectDocumentProblem({ ...valid, planner: root })).toBe(
            "too-deep",
        );
    });

    it("rejects prototype-pollution keys anywhere in the tree", () => {
        const document = JSON.parse(
            '{"version":4,"planner":{"layout":[{"__proto__":{"admin":true}}]}}',
        );
        expect(findProjectDocumentProblem(document)).toBe("forbidden-key");
    });
});
