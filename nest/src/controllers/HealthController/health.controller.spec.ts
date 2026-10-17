import { ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HealthController } from "./health.controller";
import { OperationalLogger } from "../../services/OperationalLogger/operational-logger.service";

function makeController(options?: {
    initialized?: boolean;
    queryError?: Error;
    pendingQuery?: boolean;
}) {
    const query = jest.fn(async (): Promise<unknown> => {
        if (options?.pendingQuery) return new Promise(() => undefined);
        if (options?.queryError) throw options.queryError;
        return [{ ok: 1 }];
    });
    const dataSource = {
        isInitialized: options?.initialized ?? true,
        query,
    } as unknown as DataSource;
    const operationalLogger = {
        health: jest.fn(),
    } as unknown as OperationalLogger;

    return {
        controller: new HealthController(dataSource, operationalLogger),
        query,
        healthLog: operationalLogger.health as jest.Mock,
    };
}

describe("HealthController", () => {
    it("serves the legacy and explicit liveness routes without touching DB", () => {
        const { controller, query, healthLog } = makeController();

        expect(controller.getHealth()).toEqual({
            status: "ok",
            service: "stylefinder-api",
        });
        expect(controller.getLiveness()).toEqual({
            status: "ok",
            service: "stylefinder-api",
        });
        expect(query).not.toHaveBeenCalled();
        expect(healthLog).toHaveBeenCalledWith(
            "live",
            "ok",
            expect.any(Number),
        );
    });

    it("checks the database before reporting readiness", async () => {
        const { controller, query, healthLog } = makeController();

        await expect(controller.getReadiness()).resolves.toEqual({
            status: "ok",
            service: "stylefinder-api",
            checks: { database: "up" },
        });
        expect(query).toHaveBeenCalledWith("SELECT 1");
        expect(healthLog).toHaveBeenCalledWith(
            "ready",
            "ok",
            expect.any(Number),
        );
    });

    it("returns 503 without exposing the database error", async () => {
        const { controller, healthLog } = makeController({
            queryError: new Error("password authentication failed for secret"),
        });

        await expect(controller.getReadiness()).rejects.toMatchObject({
            status: 503,
            response: {
                status: "error",
                service: "stylefinder-api",
                checks: { database: "down" },
            },
        });
        expect(healthLog).toHaveBeenCalledWith(
            "ready",
            "error",
            expect.any(Number),
        );
    });

    it("returns 503 when TypeORM is not initialized", async () => {
        const { controller, query } = makeController({ initialized: false });

        await expect(controller.getReadiness()).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(query).not.toHaveBeenCalled();
    });

    it("bounds a stalled readiness query", async () => {
        const previousTimeout = process.env.DB_READINESS_TIMEOUT_MS;
        process.env.DB_READINESS_TIMEOUT_MS = "100";
        const { controller } = makeController({ pendingQuery: true });

        try {
            await expect(controller.getReadiness()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
        } finally {
            if (previousTimeout === undefined) {
                delete process.env.DB_READINESS_TIMEOUT_MS;
            } else {
                process.env.DB_READINESS_TIMEOUT_MS = previousTimeout;
            }
        }
    });
});
