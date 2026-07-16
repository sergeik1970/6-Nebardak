import { solveRoom, solveRoomVariants, solveWithAutomaticRemoval } from "./solver";
import {
    AutoRemovalResult,
    FurnitureInstance,
    LayoutPreferences,
    LayoutResult,
    LayoutVariantsResult,
    Room,
} from "./types";

export type SolverWorkerRequest =
    | {
          requestId: number;
          action: "solve";
          room: Room;
          instances: FurnitureInstance[];
          preferences?: LayoutPreferences;
      }
    | {
          requestId: number;
          action: "solve-variants";
          room: Room;
          instances: FurnitureInstance[];
          preferences?: LayoutPreferences;
          limit?: number;
      }
    | {
          requestId: number;
          action: "solve-with-removal";
          room: Room;
          instances: FurnitureInstance[];
          preferences?: LayoutPreferences;
      };

export type SolverWorkerResponse =
    | {
          requestId: number;
          ok: true;
          action: "solve";
          result: LayoutResult;
      }
    | {
          requestId: number;
          ok: true;
          action: "solve-variants";
          result: LayoutVariantsResult;
      }
    | {
          requestId: number;
          ok: true;
          action: "solve-with-removal";
          result: AutoRemovalResult;
      }
    | {
          requestId: number;
          ok: false;
          error: string;
      };

interface SolverWorkerScope {
    onmessage: ((event: MessageEvent<SolverWorkerRequest>) => void) | null;
    postMessage: (message: SolverWorkerResponse) => void;
}

const workerScope = self as unknown as SolverWorkerScope;

workerScope.onmessage = (event) => {
    const request = event.data;

    try {
        if (request.action === "solve") {
            workerScope.postMessage({
                requestId: request.requestId,
                ok: true,
                action: request.action,
                result: solveRoom(request.room, request.instances, request.preferences),
            });
            return;
        }

        if (request.action === "solve-variants") {
            workerScope.postMessage({
                requestId: request.requestId,
                ok: true,
                action: request.action,
                result: solveRoomVariants(
                    request.room,
                    request.instances,
                    request.preferences,
                    request.limit,
                ),
            });
            return;
        }

        workerScope.postMessage({
            requestId: request.requestId,
            ok: true,
            action: request.action,
            result: solveWithAutomaticRemoval(request.room, request.instances, request.preferences),
        });
    } catch (error) {
        workerScope.postMessage({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "Неизвестная ошибка расчёта.",
        });
    }
};
