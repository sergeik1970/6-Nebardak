import "./config/load-environment";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { createGlobalValidationPipe } from "./config/validation";
import { getRuntimeConfig } from "./config/runtime.config";
import { OperationalLogger } from "./services/OperationalLogger/operational-logger.service";
import {
    configureBodyParsers,
    configureNoStore,
    configureTrustedProxy,
} from "./config/http-runtime";

async function bootstrap() {
    const runtime = getRuntimeConfig();
    const app = await NestFactory.create(AppModule, {
        bodyParser: false,
        logger: new ConsoleLogger({
            json: runtime.nodeEnv === "production",
            colors: runtime.nodeEnv !== "production",
            compact: true,
        }),
    });
    configureBodyParsers(app);
    configureNoStore(app);
    app.setGlobalPrefix("api");
    app.useGlobalPipes(createGlobalValidationPipe());
    app.enableShutdownHooks();

    const expressApplication = app.getHttpAdapter().getInstance();
    configureTrustedProxy(expressApplication, runtime.trustProxyHops);

    // No CORS: the browser reaches `/api` on the site's own origin (Caddy in
    // production, the Next.js dev rewrite locally), which session cookies need.

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
