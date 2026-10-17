import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { DataSource } from "typeorm";
import { OperationalLogger } from "../../services/OperationalLogger/operational-logger.service";
import { getRuntimeConfig } from "../../config/runtime.config";

interface HealthResponse {
    status: "ok";
    service: "stylefinder-api";
}

interface ReadinessResponse extends HealthResponse {
    checks: {
        database: "up";
    };
}

@Controller("health")
export class HealthController {
    private readonly readinessTimeoutMs =
        getRuntimeConfig().database.readinessTimeoutMs;

    constructor(
        private readonly dataSource: DataSource,
        private readonly operationalLogger: OperationalLogger,
    ) {}

    /** Backwards-compatible liveness alias used by the current Docker image. */
    @SkipThrottle()
    @Get()
    getHealth(): HealthResponse {
        return this.getLiveness();
    }

    @SkipThrottle()
    @Get("live")
    getLiveness(): HealthResponse {
        const startedAt = Date.now();
        const response: HealthResponse = {
            status: "ok",
            service: "stylefinder-api",
        };
        this.operationalLogger.health("live", "ok", Date.now() - startedAt);
        return response;
    }

    @Throttle({
        default: {
            limit: 30,
            ttl: 60_000,
            blockDuration: 60_000,
        },
    })
    @Get("ready")
    async getReadiness(): Promise<ReadinessResponse> {
        const startedAt = Date.now();

        try {
            if (!this.dataSource.isInitialized) {
                throw new Error("data source is not initialized");
            }

            await this.checkDatabase();
            this.operationalLogger.health(
                "ready",
                "ok",
                Date.now() - startedAt,
            );

            return {
                status: "ok",
                service: "stylefinder-api",
                checks: {
                    database: "up",
                },
            };
        } catch {
            this.operationalLogger.health(
                "ready",
                "error",
                Date.now() - startedAt,
            );
            throw new ServiceUnavailableException({
                status: "error",
                service: "stylefinder-api",
                checks: {
                    database: "down",
                },
            });
        }
    }

    private async checkDatabase(): Promise<void> {
        let timeout: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(
                () => reject(new Error("database readiness check timed out")),
                this.readinessTimeoutMs,
            );
            timeout.unref();
        });

        try {
            await Promise.race([
                this.dataSource.query("SELECT 1"),
                timeoutPromise,
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
}
