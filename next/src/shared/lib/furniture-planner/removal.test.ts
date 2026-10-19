import { describe, expect, it } from "vitest";

import {
    createPlacementHistory,
    pushPlacementHistory,
    redoPlacementHistory,
    undoPlacementHistory,
} from "./placement-history";
import {
    AUTOMATIC_REMOVAL_REASON,
    buildAutomaticRemovalReason,
    buildFurnitureInstancesExcludingRemoved,
    createRemovalRecord,
    getRestoredRemovalRecordIds,
    reconcileRemovalRecordsWithPlacements,
    reconcileSelectionWithPlacementHistory,
    validateRemovalRecords,
} from "./removal";
import { Placement } from "./types";

const removedAt = "2026-07-18T08:30:00.000Z";
const placement: Placement = {
    instanceId: "coffee-table-1",
    definitionId: "coffee-table",
    x: 100,
    y: 100,
    rotation: 0,
};

describe("removal records", () => {
    it("explains a minimal automatic removal without blaming one item", () => {
        const reason = buildAutomaticRemovalReason(6, 1);

        expect(reason).toContain("Полный комплект (6 предметов)");
        expect(reason).toContain("минимальную подтверждённую группу (1 предмет)");
        expect(reason).toContain("не несовместимость предмета с комнатой");
        expect(reason.length).toBeLessThanOrEqual(500);
    });

    it("creates a validated, exportable record", () => {
        expect(
            createRemovalRecord({
                instanceId: "coffee-table-1",
                definitionId: "coffee-table",
                priority: "optional",
                method: "automatic",
                reason: AUTOMATIC_REMOVAL_REASON,
                removedAt,
            }),
        ).toEqual({
            instanceId: "coffee-table-1",
            definitionId: "coffee-table",
            priority: "optional",
            method: "automatic",
            reason: AUTOMATIC_REMOVAL_REASON,
            removedAt,
        });
    });

    it("rejects unknown definitions, mismatched instance ids, duplicate ids and bad dates", () => {
        const valid = createRemovalRecord({
            instanceId: "coffee-table-1",
            definitionId: "coffee-table",
            method: "manual",
            reason: "Удалено пользователем.",
            removedAt,
        });

        expect(validateRemovalRecords([{ ...valid, definitionId: "unknown" }]).status).toBe(
            "invalid",
        );
        expect(validateRemovalRecords([{ ...valid, instanceId: "desk-1" }]).status).toBe("invalid");
        expect(validateRemovalRecords([{ ...valid, priority: "urgent" }]).status).toBe("invalid");
        expect(validateRemovalRecords([valid, valid]).status).toBe("invalid");
        expect(validateRemovalRecords([{ ...valid, removedAt: "yesterday" }]).status).toBe(
            "invalid",
        );
        expect(
            validateRemovalRecords([
                {
                    ...valid,
                    instanceId: "dresser-2",
                    definitionId: "dresser",
                },
            ]).status,
        ).toBe("invalid");
    });

    it("removes an active record on undo and restores it on redo", () => {
        const record = createRemovalRecord({
            instanceId: placement.instanceId,
            definitionId: placement.definitionId,
            method: "manual",
            reason: "Удалено пользователем.",
            removedAt,
        });
        const archive = new Map([[record.instanceId, record]]);

        expect(reconcileRemovalRecordsWithPlacements([record], [], [placement], archive)).toEqual(
            [],
        );
        expect(reconcileRemovalRecordsWithPlacements([], [placement], [], archive)).toEqual([
            record,
        ]);
    });

    it("reconciles selection counts from instance-level undo and redo", () => {
        expect(
            reconcileSelectionWithPlacementHistory({ "coffee-table": 0 }, [], [placement]),
        ).toEqual({ "coffee-table": 1 });
        expect(
            reconcileSelectionWithPlacementHistory({ "coffee-table": 1 }, [placement], []),
        ).toEqual({ "coffee-table": 0 });
    });

    it("keeps remaining instance ids stable when an earlier ordinal was removed", () => {
        const record = createRemovalRecord({
            instanceId: "bedside-table-1",
            definitionId: "bedside-table",
            method: "manual",
            reason: "Удалено пользователем.",
            removedAt,
        });

        expect(
            buildFurnitureInstancesExcludingRemoved(
                { "bedside-table": 1 },
                { "bedside-table": "optional" },
                [record],
            ).map((instance) => instance.instanceId),
        ).toEqual(["bedside-table-2"]);
    });

    it("restores only as many ordinal records as an explicit count increase adds", () => {
        const records = [1, 2].map((ordinal) =>
            createRemovalRecord({
                instanceId: `bedside-table-${ordinal}`,
                definitionId: "bedside-table",
                method: "manual",
                reason: "Удалено пользователем.",
                removedAt,
            }),
        );

        expect(getRestoredRemovalRecordIds(records, "bedside-table", 1, 2)).toEqual([
            "bedside-table-1",
        ]);
        expect(getRestoredRemovalRecordIds(records, "bedside-table", 1, 3)).toEqual([
            "bedside-table-1",
            "bedside-table-2",
        ]);
    });

    it("keeps selection and removal records aligned through removal undo and redo", () => {
        const record = createRemovalRecord({
            instanceId: placement.instanceId,
            definitionId: placement.definitionId,
            method: "manual",
            reason: "Удалено пользователем.",
            removedAt,
        });
        const archive = new Map([[record.instanceId, record]]);
        const removedHistory = pushPlacementHistory(createPlacementHistory([placement]), []);

        const undone = undoPlacementHistory(removedHistory);
        expect(
            reconcileSelectionWithPlacementHistory(
                { "coffee-table": 0 },
                removedHistory.present,
                undone.present,
            ),
        ).toEqual({ "coffee-table": 1 });
        expect(
            reconcileRemovalRecordsWithPlacements(
                [record],
                removedHistory.present,
                undone.present,
                archive,
            ),
        ).toEqual([]);

        const redone = redoPlacementHistory(undone);
        expect(
            reconcileSelectionWithPlacementHistory(
                { "coffee-table": 1 },
                undone.present,
                redone.present,
            ),
        ).toEqual({ "coffee-table": 0 });
        expect(
            reconcileRemovalRecordsWithPlacements([], undone.present, redone.present, archive),
        ).toEqual([record]);
    });
});
