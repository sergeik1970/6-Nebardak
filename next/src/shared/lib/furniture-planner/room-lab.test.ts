import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FURNITURE_ASSETS } from "./assets";
import {
    ROOM_LAB_CURATED_CASES,
    createRoomLabReport,
    evaluateRoomLabCase,
    renderRoomLabContactSheet,
    renderRoomLabMarkdown,
} from "./room-lab";
import type { RoomLabAssetDataUrls, RoomLabCaseResult } from "./room-lab";

const results: RoomLabCaseResult[] = [];

const describeFailure = (result: RoomLabCaseResult): string => {
    const failedPredicates = result.predicates
        .filter((predicate) => !predicate.passed)
        .map((predicate) => `${predicate.predicate.kind}: ${predicate.message}`);
    return [
        `status=${result.execution.status}`,
        `statusAllowed=${result.statusAllowed}`,
        `removalAllowed=${result.removalAllowed}`,
        ...failedPredicates,
    ].join("\n");
};

describe("planner room lab", () => {
    it("contains exactly 33 stable unique curated cases", () => {
        expect(ROOM_LAB_CURATED_CASES).toHaveLength(33);
        expect(new Set(ROOM_LAB_CURATED_CASES.map((roomCase) => roomCase.id)).size).toBe(33);
    });

    ROOM_LAB_CURATED_CASES.forEach((roomCase) => {
        it(`${roomCase.id}: ${roomCase.title}`, () => {
            const result = evaluateRoomLabCase(roomCase);
            results.push(result);
            expect(result.passed, describeFailure(result)).toBe(true);
        });
    });
});

afterAll(() => {
    if (process.env.PLANNER_LAB_WRITE_REPORT !== "1") return;

    const orderedResults = [...results].sort((first, second) =>
        first.caseId.localeCompare(second.caseId),
    );
    const report = createRoomLabReport(orderedResults);
    const outputDirectory = path.join(process.cwd(), "test-results", "planner-room-lab", "latest");
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(outputDirectory, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(outputDirectory, "summary.md"), renderRoomLabMarkdown(report));

    if (process.env.PLANNER_LAB_RENDER !== "1") return;

    const assetDataUrls = Object.entries(FURNITURE_ASSETS).reduce<RoomLabAssetDataUrls>(
        (urls, [assetKey, asset]) => {
            const assetPath = path.join(process.cwd(), "public", asset.src.replace(/^\//, ""));
            urls[assetKey as keyof RoomLabAssetDataUrls] =
                `data:image/webp;base64,${fs.readFileSync(assetPath).toString("base64")}`;
            return urls;
        },
        {},
    );
    fs.writeFileSync(
        path.join(outputDirectory, "contact-sheet.html"),
        renderRoomLabContactSheet(ROOM_LAB_CURATED_CASES, orderedResults, report, assetDataUrls),
    );

    const resultByCaseId = new Map(orderedResults.map((result) => [result.caseId, result]));
    ROOM_LAB_CURATED_CASES.forEach((roomCase) => {
        const caseDirectory = path.join(outputDirectory, "cases", roomCase.id);
        fs.mkdirSync(caseDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(caseDirectory, "input.json"),
            `${JSON.stringify(roomCase, null, 2)}\n`,
        );
        fs.writeFileSync(
            path.join(caseDirectory, "result.json"),
            `${JSON.stringify(resultByCaseId.get(roomCase.id), null, 2)}\n`,
        );
    });
});
