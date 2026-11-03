import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    ROOM_LAB_GENERATED_CASES,
    compareRoomBenchmark,
    createRoomBenchmarkReport,
    createRoomLabReport,
    renderRoomBenchmarkMarkdown,
    renderRoomLabContactSheet,
    runRoomBenchmarkCase,
} from "./room-lab";
import type { RoomBenchmarkReport, RoomBenchmarkRun } from "./room-lab";
import { loadRoomLabAssetDataUrls } from "./room-lab/load-asset-data-urls";

const BASELINE_PATH = path.join(
    process.cwd(),
    "src/shared/lib/furniture-planner/room-lab/benchmark-baseline.json",
);
const OUTPUT_DIRECTORY = path.join(process.cwd(), "test-results", "planner-benchmark", "latest");

/** One case per line: a change of results reads as a change of lines in review. */
const serializeBaseline = ({ cases, ...summary }: RoomBenchmarkReport): string => {
    const head = JSON.stringify(summary, null, 2).replace(/\n}$/, "");
    const rows = cases.map((record) => `    ${JSON.stringify(record)}`).join(",\n");
    return `${head},\n  "cases": [\n${rows}\n  ]\n}\n`;
};

const mode = process.env.PLANNER_BENCHMARK;

// The whole set takes minutes, so `npm test` skips it: see `planner:benchmark`.
describe.runIf(mode === "check" || mode === "update")("room benchmark", () => {
    it("holds against its baseline", { timeout: 3_600_000 }, async () => {
        const runs: RoomBenchmarkRun[] = [];
        for (const roomCase of ROOM_LAB_GENERATED_CASES) {
            runs.push(runRoomBenchmarkCase(roomCase));
            // Solving blocks the worker; without a pause vitest loses its connection to it.
            await new Promise((resolve) => setImmediate(resolve));
        }
        const report = createRoomBenchmarkReport(runs);
        const baseline = fs.existsSync(BASELINE_PATH)
            ? (JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as RoomBenchmarkReport)
            : null;
        const comparison = baseline ? compareRoomBenchmark(baseline, report) : undefined;

        fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
        fs.writeFileSync(
            path.join(OUTPUT_DIRECTORY, "report.json"),
            `${JSON.stringify(report, null, 2)}\n`,
        );
        fs.writeFileSync(
            path.join(OUTPUT_DIRECTORY, "summary.md"),
            renderRoomBenchmarkMarkdown(report, comparison),
        );

        if (process.env.PLANNER_LAB_RENDER === "1") {
            const results = runs.map((run) => run.result);
            fs.writeFileSync(
                path.join(OUTPUT_DIRECTORY, "contact-sheet.html"),
                renderRoomLabContactSheet(
                    ROOM_LAB_GENERATED_CASES,
                    results,
                    createRoomLabReport(results),
                    loadRoomLabAssetDataUrls(),
                ),
            );
            // The sheet links each card to its result.
            results.forEach((result) => {
                const caseDirectory = path.join(OUTPUT_DIRECTORY, "cases", result.caseId);
                fs.mkdirSync(caseDirectory, { recursive: true });
                fs.writeFileSync(
                    path.join(caseDirectory, "result.json"),
                    `${JSON.stringify(result, null, 2)}\n`,
                );
            });
        }

        if (mode === "update") {
            fs.writeFileSync(BASELINE_PATH, serializeBaseline(report));
            return;
        }
        expect(baseline, "Нет эталона: запустите npm run planner:benchmark:update").not.toBeNull();
        expect(comparison?.regressions).toEqual([]);
    });
});
