import { isTvApartFromStand, validateLayout } from "../geometry";
import { getRoomArea } from "../room-geometry";
import { solveWithPreferredPlacementFallback } from "../solver";
import type { LayoutPreferences, Placement, Room } from "../types";
import { evaluateRoomLabCase } from "./evaluate";
import type {
    RoomLabCase,
    RoomLabCaseResult,
    RoomLabExpectedStatus,
    RoomLabFindingCode,
} from "./types";

export const ROOM_BENCHMARK_VERSION = 1;

/** Variants are promised from this area up: smaller rooms rarely have a real choice. */
export const ROOM_BENCHMARK_VARIANT_MIN_AREA_M2 = 12;

/** What was found for one room. Everything here repeats exactly on any machine. */
export interface RoomBenchmarkRecord {
    id: string;
    /** Fingerprint of the room and its set: results compare only on equal inputs. */
    input: string;
    kind: string;
    scenario: string;
    areaM2: number;
    requested: number;
    /** Every piece must fit, as `solveRoomVariants` asks. */
    strict: {
        status: RoomLabExpectedStatus;
        variants: number;
        distinctVariants: number;
        nodes: number;
        layout: string | null;
        valid: boolean;
    };
    /** What the planner shows: the strict plan, or else what the fallback could place. */
    planner: {
        status: RoomLabExpectedStatus;
        placed: number;
        missing: string[];
        nodes: number;
        layout: string | null;
        valid: boolean;
        /** A TV hangs away from its stand: the designer wants it over the stand. */
        tvApart: boolean;
    };
    findings: RoomLabFindingCode[];
}

export interface RoomBenchmarkTotals {
    rooms: number;
    /** The strict search placed the whole set. */
    strictFull: number;
    /** The planner showed the whole set, by either of its two steps. */
    plannerFull: number;
    /** Rooms of the promised area, and how many of them got two different plans. */
    variantRooms: number;
    variantRoomsWithChoice: number;
    /** Plans `validateLayout` rejects. Must stay zero. */
    invalidLayouts: number;
    /** Planner plans with the TV away from its stand. */
    tvApart: number;
    searchExhausted: number;
    provenImpossible: number;
    maximumNodes: number;
    totalNodes: number;
}

export interface RoomBenchmarkTiming {
    medianMs: number;
    p95Ms: number;
    maximumMs: number;
}

/** Reference only: it depends on the machine, so it never fails a check. */
export interface RoomBenchmarkTimings {
    /** Three variants with every piece required. */
    strict: RoomBenchmarkTiming;
    /** Both of the planner's steps: what a person actually waits for. */
    planner: RoomBenchmarkTiming;
}

export interface RoomBenchmarkReport {
    version: typeof ROOM_BENCHMARK_VERSION;
    totals: RoomBenchmarkTotals;
    byKind: Record<string, RoomBenchmarkTotals>;
    findingCounts: Partial<Record<RoomLabFindingCode, number>>;
    timing: RoomBenchmarkTimings;
    cases: RoomBenchmarkRecord[];
}

export interface RoomBenchmarkRun {
    record: RoomBenchmarkRecord;
    /** The lab's result, kept for the contact sheet. */
    result: RoomLabCaseResult;
    strictMs: number;
    plannerMs: number;
}

export interface RoomBenchmarkComparison {
    /** Worse than the baseline: fails the check. */
    regressions: string[];
    /** Better than the baseline: worth recording with a baseline update. */
    improvements: string[];
    /** Same quality, different plan: neither better nor worse by these measures. */
    changedLayouts: string[];
}

const hashText = (text: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
};

/** A short fingerprint of a plan: any moved piece changes it. */
const layoutFingerprint = (placements: Placement[]): string | null => {
    if (placements.length === 0) return null;
    return hashText(
        placements
            .map(
                (placement) =>
                    `${placement.instanceId}:${placement.x}:${placement.y}:${placement.rotation}`,
            )
            .sort()
            .join("|"),
    );
};

const isValid = (room: Room, placements: Placement[], preferences?: LayoutPreferences): boolean =>
    placements.length === 0 || validateLayout(room, placements, preferences).valid;

const round = (value: number): number => Math.round(value * 100) / 100;

const scenarioOf = (roomCase: RoomLabCase): string => roomCase.tags[1] ?? "";

/**
 * Measures one room as the planner solves it: the strict search first, and
 * the fallback only when that finds nothing.
 */
export const runRoomBenchmarkCase = (roomCase: RoomLabCase): RoomBenchmarkRun => {
    const result = evaluateRoomLabCase(roomCase);
    const { execution, metrics, findings } = result;
    const strictPassed = execution.status === "success";
    const fallbackStartedAt = performance.now();
    const fallback = strictPassed
        ? null
        : solveWithPreferredPlacementFallback(
              roomCase.room,
              roomCase.instances,
              roomCase.preferences,
          );
    const fallbackMs = round(performance.now() - fallbackStartedAt);
    const plannerPlacements = fallback ? fallback.result.placements : execution.placements;

    return {
        result,
        strictMs: execution.durationMs,
        plannerMs: round(execution.durationMs + fallbackMs),
        record: {
            id: roomCase.id,
            input: hashText(
                JSON.stringify([roomCase.room, roomCase.instances, roomCase.preferences]),
            ),
            kind: roomCase.tags[0] ?? "",
            scenario: scenarioOf(roomCase),
            areaM2: round(getRoomArea(roomCase.room) / 1_000_000),
            requested: roomCase.instances.length,
            strict: {
                status: execution.status,
                variants: execution.variants.length,
                distinctVariants: metrics.variantTopologyCount.value ?? 0,
                nodes: execution.exploredNodes,
                layout: layoutFingerprint(execution.placements),
                valid: execution.variants.every((variant) =>
                    isValid(roomCase.room, variant.placements, roomCase.preferences),
                ),
            },
            planner: {
                status:
                    !fallback || fallback.result.status === "success"
                        ? "success"
                        : fallback.result.reason,
                placed: plannerPlacements.length,
                missing: (fallback?.unplacedInstances ?? [])
                    .map((instance) => instance.definitionId)
                    .sort(),
                nodes: execution.exploredNodes + (fallback?.result.exploredNodes ?? 0),
                layout: layoutFingerprint(plannerPlacements),
                valid: isValid(roomCase.room, plannerPlacements, roomCase.preferences),
                tvApart: isTvApartFromStand(plannerPlacements),
            },
            findings: Array.from(new Set(findings.map((finding) => finding.code))).sort(),
        },
    };
};

const isStrictFull = (record: RoomBenchmarkRecord): boolean => record.strict.status === "success";

const isPlannerFull = (record: RoomBenchmarkRecord): boolean =>
    record.planner.status === "success" && record.planner.missing.length === 0;

const totalsOf = (records: RoomBenchmarkRecord[]): RoomBenchmarkTotals => {
    const variantRooms = records.filter(
        (record) => record.areaM2 >= ROOM_BENCHMARK_VARIANT_MIN_AREA_M2,
    );
    return {
        rooms: records.length,
        strictFull: records.filter(isStrictFull).length,
        plannerFull: records.filter(isPlannerFull).length,
        variantRooms: variantRooms.length,
        variantRoomsWithChoice: variantRooms.filter((record) => record.strict.distinctVariants >= 2)
            .length,
        invalidLayouts: records.reduce(
            (count, record) => count + Number(!record.strict.valid) + Number(!record.planner.valid),
            0,
        ),
        tvApart: records.filter((record) => record.planner.tvApart).length,
        searchExhausted: records.filter((record) => record.strict.status === "search-exhausted")
            .length,
        provenImpossible: records.filter((record) => record.strict.status === "proven-impossible")
            .length,
        maximumNodes: records.reduce(
            (maximum, record) => Math.max(maximum, record.strict.nodes, record.planner.nodes),
            0,
        ),
        totalNodes: records.reduce(
            (total, record) => total + record.strict.nodes + record.planner.nodes,
            0,
        ),
    };
};

const percentile = (sorted: number[], share: number): number =>
    sorted.length === 0
        ? 0
        : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1)];

const timingOf = (durations: number[]): RoomBenchmarkTiming => {
    const sorted = [...durations].sort((first, second) => first - second);
    return {
        medianMs: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        maximumMs: sorted.at(-1) ?? 0,
    };
};

export const createRoomBenchmarkReport = (
    runs: Pick<RoomBenchmarkRun, "record" | "strictMs" | "plannerMs">[],
): RoomBenchmarkReport => {
    const records = runs.map((run) => run.record);
    const kinds = Array.from(new Set(records.map((record) => record.kind)));
    return {
        version: ROOM_BENCHMARK_VERSION,
        totals: totalsOf(records),
        byKind: Object.fromEntries(
            kinds.map((kind) => [kind, totalsOf(records.filter((record) => record.kind === kind))]),
        ),
        findingCounts: records
            .flatMap((record) => record.findings)
            .reduce<RoomBenchmarkReport["findingCounts"]>((counts, code) => {
                counts[code] = (counts[code] ?? 0) + 1;
                return counts;
            }, {}),
        timing: {
            strict: timingOf(runs.map((run) => run.strictMs)),
            planner: timingOf(runs.map((run) => run.plannerMs)),
        },
        cases: records,
    };
};

export const compareRoomBenchmark = (
    baseline: RoomBenchmarkReport,
    current: RoomBenchmarkReport,
): RoomBenchmarkComparison => {
    const regressions: string[] = [];
    const improvements: string[] = [];
    const changedLayouts: string[] = [];
    if (baseline.version !== current.version)
        regressions.push(`Версия отчёта: ${baseline.version} → ${current.version}.`);

    const currentById = new Map(current.cases.map((record) => [record.id, record]));
    const baselineIds = new Set(baseline.cases.map((record) => record.id));
    current.cases
        .filter((record) => !baselineIds.has(record.id))
        .forEach((record) => regressions.push(`${record.id}: комнаты нет в эталоне.`));

    baseline.cases.forEach((before) => {
        const after = currentById.get(before.id);
        if (!after) {
            regressions.push(`${before.id}: комната пропала из набора.`);
            return;
        }
        if (before.input !== after.input) {
            regressions.push(`${before.id}: комната или набор мебели изменились.`);
            return;
        }
        const compare = (
            label: string,
            was: number,
            now: number,
            describe: (value: number) => string = String,
        ) => {
            if (now < was)
                regressions.push(`${before.id}: ${label} ${describe(was)} → ${describe(now)}.`);
            if (now > was)
                improvements.push(`${before.id}: ${label} ${describe(was)} → ${describe(now)}.`);
        };
        const yesNo = (value: number) => (value ? "да" : "нет");
        compare("строгий поиск, полный набор", +isStrictFull(before), +isStrictFull(after), yesNo);
        compare("предметов в продукте", before.planner.placed, after.planner.placed);
        compare("разных вариантов", before.strict.distinctVariants, after.strict.distinctVariants);
        compare("план допустим", +before.strict.valid, +after.strict.valid, yesNo);
        compare("план продукта допустим", +before.planner.valid, +after.planner.valid, yesNo);
        compare(
            "ТВ над тумбой",
            +!(before.planner.tvApart ?? false),
            +!after.planner.tvApart,
            yesNo,
        );

        if (
            before.strict.layout !== after.strict.layout ||
            before.planner.layout !== after.planner.layout
        )
            changedLayouts.push(before.id);
    });

    if (current.totals.invalidLayouts > 0)
        regressions.push(`Недопустимых планов: ${current.totals.invalidLayouts}.`);

    return { regressions, improvements, changedLayouts };
};

const share = (part: number, whole: number): string =>
    whole === 0 ? "—" : `${part}/${whole} (${Math.round((part / whole) * 100)}%)`;

const row = (label: string, totals: RoomBenchmarkTotals): string =>
    `| ${label} | ${totals.rooms} | ${share(totals.strictFull, totals.rooms)} | ${share(totals.plannerFull, totals.rooms)} | ${share(totals.variantRoomsWithChoice, totals.variantRooms)} | ${totals.invalidLayouts} |`;

const listSection = (title: string, items: string[]): string[] =>
    items.length === 0
        ? []
        : [`## ${title}: ${items.length}`, "", ...items.map((item) => `- ${item}`), ""];

const renderTiming = ({ medianMs, p95Ms, maximumMs }: RoomBenchmarkTiming): string =>
    `медиана ${medianMs} мс, p95 ${p95Ms} мс, максимум ${maximumMs} мс`;

export const renderRoomBenchmarkMarkdown = (
    report: RoomBenchmarkReport,
    comparison?: RoomBenchmarkComparison,
): string => {
    const { timing, totals } = report;
    const missing = report.cases
        .flatMap((record) => record.planner.missing)
        .reduce<Record<string, number>>((counts, id) => {
            counts[id] = (counts[id] ?? 0) + 1;
            return counts;
        }, {});
    const lines = [
        "# Замер авторасстановки",
        "",
        "| Комнаты | Всего | Полный набор, строгий поиск | Полный набор, продукт | Два разных варианта от 12 м² | Недопустимых планов |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        row("Все", totals),
        ...Object.entries(report.byKind).map(([kind, kindTotals]) => row(kind, kindTotals)),
        "",
        `Строгий поиск: исчерпан лимит в ${totals.searchExhausted}, доказано «не помещается» в ${totals.provenImpossible}.`,
        "",
        `ТВ отдельно от тумбы в планах продукта: ${totals.tvApart}.`,
        "",
        `Узлов поиска: всего ${totals.totalNodes}, максимум на путь ${totals.maximumNodes}.`,
        "",
        `Время на комнату зависит от машины. Продукт: ${renderTiming(timing.planner)}. Строгий поиск: ${renderTiming(timing.strict)}.`,
        "",
        "## Что продукт не смог поставить",
        "",
        ...Object.entries(missing)
            .sort(([, first], [, second]) => second - first)
            .map(([id, count]) => `- ${id}: ${count}`),
        "",
        "## Находки лаборатории",
        "",
        ...Object.entries(report.findingCounts)
            .sort(([, first], [, second]) => second - first)
            .map(([code, count]) => `- ${code}: ${count}`),
        "",
    ];
    if (comparison)
        lines.push(
            ...listSection("Хуже эталона", comparison.regressions),
            ...listSection("Лучше эталона", comparison.improvements),
            ...listSection("Изменились планы", comparison.changedLayouts),
        );
    return `${lines.join("\n")}\n`;
};
