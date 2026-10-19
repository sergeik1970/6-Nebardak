import "./config/load-environment";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { createGlobalValidationPipe } from "./config/validation";
import { getRuntimeConfig } from "./config/runtime.config";
import { OperationalLogger } from "./services/OperationalLogger/operational-logger.service";
import { configureTrustedProxy } from "./config/http-runtime";

async function bootstrap() {
    const runtime = getRuntimeConfig();
    const app = await NestFactory.create(AppModule, {
        logger: new ConsoleLogger({
            json: runtime.nodeEnv === "production",
            colors: runtime.nodeEnv !== "production",
            compact: true,
        }),
    });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(createGlobalValidationPipe());
    app.enableShutdownHooks();

    const expressApplication = app.getHttpAdapter().getInstance();
    configureTrustedProxy(expressApplication, runtime.trustProxyHops);

    if (runtime.nodeEnv === "dev")
        app.enableCors({
            origin: ["http://localhost:3000", "http://localhost:3002"],
        });

    await app.listen(runtime.port, "0.0.0.0");
    app.get(OperationalLogger).startup({
        nodeEnv: runtime.nodeEnv,
        port: runtime.port,
        trustProxyHops: runtime.trustProxyHops,
        authEnabled: runtime.authEnabled,
        registrationEnabled: runtime.registrationEnabled,
    });
}

void bootstrap();
