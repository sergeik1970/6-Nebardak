import { describe, expect, it } from "vitest";
import { validateRoomGeometry } from "../geometry";
import {
    ROOM_BENCHMARK_KINDS,
    ROOM_BENCHMARK_SCENARIOS,
    ROOM_LAB_GENERATED_CASES,
    compareRoomBenchmark,
    createRoomBenchmarkReport,
    renderRoomBenchmarkMarkdown,
} from ".";
import type { RoomBenchmarkRecord } from ".";

const record = (overrides: Partial<RoomBenchmarkRecord> = {}): RoomBenchmarkRecord => ({
    id: "GEN-1",
    input: "input",
    kind: "bedroom",
    scenario: "facing",
    areaM2: 14,
    requested: 4,
    strict: {
        status: "success",
        variants: 2,
        distinctVariants: 2,
        nodes: 100,
        layout: "aaaa",
        valid: true,
    },
    planner: {
        status: "success",
        placed: 4,
        missing: [],
        nodes: 50,
        layout: "bbbb",
        valid: true,
        tvApart: false,
        awayFromHead: false,
    },
    selection: { status: "furnished", rung: 0, changes: [], layout: "eeee", valid: true },
    findings: [],
    ...overrides,
});

const report = (...records: RoomBenchmarkRecord[]) =>
    createRoomBenchmarkReport(
        records.map((item) => ({ record: item, strictMs: 10, plannerMs: 10, selectionMs: 10 })),
    );

const unplaced = (base = record()): RoomBenchmarkRecord => ({
    ...base,
    strict: {
        ...base.strict,
        status: "search-exhausted",
        variants: 0,
        distinctVariants: 0,
        layout: null,
    },
    planner: { ...base.planner, placed: 3, missing: ["dresser"], layout: "cccc" },
});

describe("generated rooms", () => {
    it("cover every kind and opening layout under unique ids", () => {
        const ids = ROOM_LAB_GENERATED_CASES.map((roomCase) => roomCase.id);
        expect(ids).toHaveLength(294);
        expect(new Set(ids).size).toBe(ids.length);
        for (const kind of ROOM_BENCHMARK_KINDS)
            for (const scenario of ROOM_BENCHMARK_SCENARIOS)
                expect(
                    ROOM_LAB_GENERATED_CASES.filter(
                        ({ tags }) => tags[0] === kind && tags[1] === scenario,
                    ),
                ).toHaveLength(7);
    });

    it("are rooms a person could draw", () => {
        for (const { id, room } of ROOM_LAB_GENERATED_CASES)
            expect(validateRoomGeometry(room), id).toBeNull();
    });

    it("keep every opening on the planner's 50 mm lattice", () => {
        for (const { id, room } of ROOM_LAB_GENERATED_CASES)
            for (const item of [...room.doors, ...room.windows, ...(room.radiators ?? [])]) {
                expect(item.offset % 50, id).toBe(0);
                expect(item.width % 50, id).toBe(0);
            }
    });

    it("hold a kitchen in every kitchen-living room", () => {
        for (const { id, room, tags } of ROOM_LAB_GENERATED_CASES)
            if (tags[0] === "kitchen-living")
                expect(room.fixedFurniture?.bodies, id).toHaveLength(1);
    });

    it("never ask for kitchen units, which stay switched off", () => {
        const ids = ROOM_LAB_GENERATED_CASES.flatMap(({ instances }) =>
            instances.map((instance) => instance.definitionId),
        );
        expect(ids.filter((id) => id.startsWith("kitchen-"))).toEqual([]);
    });
});

describe("benchmark report", () => {
    it("counts a full plan by the fallback as the planner's, not the strict search's", () => {
        const onlyPlanner: RoomBenchmarkRecord = {
            ...unplaced(record({ id: "GEN-2" })),
            planner: record().planner,
        };
        const neither = unplaced(record({ id: "GEN-3" }));
        const { totals } = report(record(), onlyPlanner, neither);
        expect(totals).toMatchObject({
            rooms: 3,
            strictFull: 1,
            plannerFull: 2,
            searchExhausted: 2,
        });
    });

    it("promises a choice of plans only from 12 m²", () => {
        const small = record({ id: "GEN-2", areaM2: 10 });
        const { totals } = report(record(), small);
        expect(totals.variantRooms).toBe(1);
        expect(totals.variantRoomsWithChoice).toBe(1);
    });

    it("renders without a comparison", () => {
        expect(renderRoomBenchmarkMarkdown(report(record()))).toContain("Замер авторасстановки");
    });
});

describe("baseline comparison", () => {
    it("is silent when nothing changed, whatever the clock said", () => {
        const slower = createRoomBenchmarkReport([
            { record: record(), strictMs: 9000, plannerMs: 9000, selectionMs: 9000 },
        ]);
        expect(compareRoomBenchmark(report(record()), slower)).toEqual({
            regressions: [],
            improvements: [],
            changedLayouts: [],
        });
    });

    it("fails when a room loses its full set", () => {
        const { regressions } = compareRoomBenchmark(report(record()), report(unplaced()));
        expect(regressions).toHaveLength(3);
        expect(regressions[0]).toContain("GEN-1");
    });

    it("records a gain without failing", () => {
        const comparison = compareRoomBenchmark(report(unplaced()), report(record()));
        expect(comparison.regressions).toEqual([]);
        expect(comparison.improvements).toHaveLength(3);
    });

    it("fails on any plan validateLayout rejects", () => {
        const bad = record();
        bad.planner = { ...bad.planner, valid: false };
        const { regressions } = compareRoomBenchmark(report(record()), report(bad));
        expect(regressions.some((line) => line.includes("Недопустимых планов: 1"))).toBe(true);
    });

    it("refuses to compare a room whose input changed", () => {
        const { regressions } = compareRoomBenchmark(
            report(record()),
            report(record({ input: "other" })),
        );
        expect(regressions).toEqual(["GEN-1: комната или набор мебели изменились."]);
    });

    it("notices rooms added or dropped", () => {
        const { regressions } = compareRoomBenchmark(
            report(record()),
            report(record({ id: "GEN-2" })),
        );
        expect(regressions).toHaveLength(2);
    });

    it("fails when automatic selection gives way more than before", () => {
        const worse = record({
            selection: {
                status: "furnished",
                rung: 2,
                changes: ["без: dresser"],
                layout: "ffff",
                valid: true,
            },
        });

        const { regressions } = compareRoomBenchmark(report(record()), report(worse));

        expect(regressions).toEqual(["GEN-1: автоподбор, уступок 0 → 2."]);
    });

    it("lists a moved plan apart from better or worse", () => {
        const moved = record();
        moved.strict = { ...moved.strict, layout: "dddd" };
        const comparison = compareRoomBenchmark(report(record()), report(moved));
        expect(comparison.changedLayouts).toEqual(["GEN-1"]);
        expect(comparison.regressions).toEqual([]);
    });
});
