import type { RoomLabCaseResult, RoomLabReport } from "./types";

export const createRoomLabReport = (
    cases: RoomLabCaseResult[],
    generatedAt = new Date().toISOString(),
): RoomLabReport => {
    const passed = cases.filter((roomCase) => roomCase.passed).length;
    const findingCounts = cases
        .flatMap((roomCase) => roomCase.findings)
        .reduce<RoomLabReport["summary"]["findingCounts"]>((counts, finding) => {
            counts[finding.code] = (counts[finding.code] ?? 0) + 1;
            return counts;
        }, {});
    return {
        schemaVersion: 3,
        generatedAt,
        summary: {
            total: cases.length,
            passed,
            failed: cases.length - passed,
            totalDurationMs:
                Math.round(
                    cases.reduce((total, roomCase) => total + roomCase.execution.durationMs, 0) *
                        100,
                ) / 100,
            casesWithFindings: cases.filter((roomCase) => roomCase.findings.length > 0).length,
            findingCounts,
        },
        cases,
    };
};

const resultIcon = (passed: boolean): string => (passed ? "✅" : "❌");

export const renderRoomLabMarkdown = (report: RoomLabReport): string => {
    const lines = [
        "# Planner Room Lab",
        "",
        `Generated: ${report.generatedAt}`,
        "",
        `Result: ${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed} failed; ${report.summary.totalDurationMs} ms total.`,
        "",
        "| Case | Result | Status | Findings | Time | Nodes |",
        "| --- | --- | --- | --- | ---: | ---: |",
        ...report.cases.map(
            (roomCase) =>
                `| ${roomCase.caseId} | ${resultIcon(roomCase.passed)} | ${roomCase.execution.status} | ${roomCase.findings.map((finding) => finding.code).join(", ") || "—"} | ${roomCase.execution.durationMs} ms | ${roomCase.execution.exploredNodes} |`,
        ),
        "",
    ];

    report.cases
        .filter((roomCase) => !roomCase.passed || roomCase.findings.length > 0)
        .forEach((roomCase) => {
            lines.push(
                `## ${roomCase.caseId}: ${roomCase.title}`,
                "",
                `- Status allowed: ${roomCase.statusAllowed}`,
                `- Removal allowed: ${roomCase.removalAllowed}`,
                `- Solver message: ${roomCase.execution.message || "—"}`,
                ...roomCase.predicates
                    .filter((predicate) => !predicate.passed)
                    .map(
                        (predicate) =>
                            `- Failed \`${predicate.predicate.kind}\`: ${predicate.message}`,
                    ),
                ...roomCase.findings.map(
                    (finding) =>
                        `- ${finding.severity === "warning" ? "Warning" : "Info"} \`${finding.code}\`: ${finding.message}`,
                ),
                "",
            );
        });

    return `${lines.join("\n")}\n`;
};
