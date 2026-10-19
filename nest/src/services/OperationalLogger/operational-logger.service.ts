import { Injectable, Logger } from "@nestjs/common";

type LogValue = string | number | boolean | null;
type LogDetails = Record<string, LogValue>;

@Injectable()
export class OperationalLogger {
    private readonly logger = new Logger("Operations");

    startup(details: LogDetails): void {
        this.logger.log(this.payload("application.started", details));
    }

    health(
        check: "live" | "ready",
        status: "ok" | "error",
        durationMs: number,
    ): void {
        const payload = this.payload("health.checked", {
            check,
            status,
            durationMs,
        });

        if (status === "error") {
            this.logger.warn(payload);
            return;
        }

        this.logger.debug(payload);
    }

    private payload(event: string, details: LogDetails): LogDetails {
        return {
            event,
            ...details,
        };
    }
}
