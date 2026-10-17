import { solveRoom, solveRoomVariants, solveWithAutomaticRemoval } from "../solver";
import type { FurnitureInstance, LayoutResult, LayoutVariantsResult } from "../types";
import { computeRoomLabMetrics } from "./metrics";
import { evaluateRoomLabPredicate } from "./predicates";
import { collectRoomLabFindings } from "./quality";
import type {
    RoomLabCase,
    RoomLabCaseResult,
    RoomLabExecution,
    RoomLabExpectedStatus,
} from "./types";

const executionStatus = (result: LayoutResult | LayoutVariantsResult): RoomLabExpectedStatus =>
    result.status === "success" ? "success" : result.reason;

const runRoomLabCase = (roomCase: RoomLabCase): RoomLabExecution => {
    const startedAt = performance.now();
    const result =
        roomCase.requestedVariants > 1 && !roomCase.solverOptions
            ? solveRoomVariants(
                  roomCase.room,
                  roomCase.instances,
                  roomCase.preferences,
                  roomCase.requestedVariants,
              )
            : solveRoom(
                  roomCase.room,
                  roomCase.instances,
                  roomCase.preferences,
                  roomCase.solverOptions,
              );
    const variants = result.status === "success" && "variants" in result ? result.variants : [];
    const placements =
        result.status === "success" && "variants" in result
            ? result.variants[0]?.placements ?? []
            : result.placements;
    let removedInstances: FurnitureInstance[] = [];
    let removalResultStatus: RoomLabExpectedStatus | null = null;

    if (roomCase.expectation.expectedRemoval) {
        const removal = solveWithAutomaticRemoval(
            roomCase.room,
            roomCase.instances,
            roomCase.preferences,
            roomCase.solverOptions,
        );
        removedInstances = removal.removedInstances;
        removalResultStatus = executionStatus(removal.result);
    }

    return {
        status: executionStatus(result),
        message: result.status === "success" ? result.notes.join(" ") : result.message,
        placements,
        variants,
        exploredNodes: result.exploredNodes,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        removedInstances,
        removalResultStatus,
    };
};

const removalMatchesExpectation = (roomCase: RoomLabCase, execution: RoomLabExecution): boolean => {
    const expectedRemoval = roomCase.expectation.expectedRemoval;
    if (!expectedRemoval) return execution.removedInstances.length === 0;
    return (
        execution.removalResultStatus === "success" &&
        execution.removedInstances.length > 0 &&
        execution.removedInstances.length <= expectedRemoval.maximumCount &&
        execution.removedInstances.every((instance) =>
            expectedRemoval.allowedDefinitionIds.includes(instance.definitionId),
        )
    );
};

export const evaluateRoomLabCase = (roomCase: RoomLabCase): RoomLabCaseResult => {
    const execution = runRoomLabCase(roomCase);
    const predicates = roomCase.expectation.requiredPredicates.map((predicate) =>
        evaluateRoomLabPredicate(predicate, {
            roomCase,
            execution,
            runAgain: () => runRoomLabCase(roomCase),
        }),
    );
    const statusAllowed = roomCase.expectation.allowedStatuses.includes(execution.status);
    const removalAllowed = removalMatchesExpectation(roomCase, execution);
    const metrics = computeRoomLabMetrics(roomCase, execution);
    const findings = collectRoomLabFindings(roomCase, execution, metrics);

    return {
        caseId: roomCase.id,
        title: roomCase.title,
        passed:
            statusAllowed &&
            removalAllowed &&
            predicates.every((predicate) => predicate.passed) &&
            !findings.some((finding) =>
                roomCase.expectation.forbiddenFindings?.includes(finding.code),
            ),
        statusAllowed,
        removalAllowed,
        execution,
        predicates,
        metrics,
        findings,
    };
};

export const evaluateRoomLab = (cases: RoomLabCase[]): RoomLabCaseResult[] =>
    cases.map(evaluateRoomLabCase);
