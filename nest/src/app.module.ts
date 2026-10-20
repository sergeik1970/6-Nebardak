import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./modules/AuthModule/auth.module";
import { PlannerObservationsModule } from "./modules/PlannerObservationsModule/planner-observations.module";
import { ProjectsModule } from "./modules/ProjectsModule/projects.module";
import { AdminPlannerObservationsModule } from "./modules/AdminPlannerObservationsModule/admin-planner-observations.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HealthController } from "./controllers/HealthController/health.controller";
import { OperationalLogger } from "./services/OperationalLogger/operational-logger.service";
import { getRateLimit, getRuntimeConfig } from "./config/runtime.config";
import { CsrfGuard } from "./guards/csrf.guard";

const runtime = getRuntimeConfig();

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: "postgres",
            // UUID keys default to gen_random_uuid() in the migrations; the
            // runtime role may not (and need not) create extensions.
            installExtensions: false,
            host: runtime.database.host,
            port: runtime.database.port,
            username: runtime.database.username,
            password: runtime.database.password,
            database: runtime.database.name,
            autoLoadEntities: true,
            synchronize:
                runtime.nodeEnv === "development" || runtime.nodeEnv === "dev",
            extra: {
                statement_timeout: runtime.database.statementTimeoutMs,
                query_timeout: runtime.database.queryTimeoutMs,
                connectionTimeoutMillis: runtime.database.connectionTimeoutMs,
                application_name: "stylefinder-api",
            },
        }),
        ThrottlerModule.forRoot([
            {
                ttl: getRateLimit("RATE_LIMIT_TTL_MS", 60_000),
                limit: getRateLimit("RATE_LIMIT_REQUESTS", 120),
                blockDuration: 60_000,
            },
        ]),
        AuthModule,
        PlannerObservationsModule,
        AdminPlannerObservationsModule,
        ProjectsModule,
    ],
    controllers: [HealthController],
    providers: [
        OperationalLogger,
        {
            provide: APP_GUARD,
            useClass: CsrfGuard,
        },
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule {}
