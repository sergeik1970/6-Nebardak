import { Logger } from "@nestjs/common";
import { OperationalLogger } from "./operational-logger.service";

describe("OperationalLogger", () => {
    afterEach(() => jest.restoreAllMocks());

    it("passes startup data as a structured object instead of nested JSON text", () => {
        const log = jest.spyOn(Logger.prototype, "log").mockImplementation();

        new OperationalLogger().startup({
            nodeEnv: "production",
            port: 3001,
        });

        expect(log).toHaveBeenCalledWith({
            event: "application.started",
            nodeEnv: "production",
            port: 3001,
        });
        expect(typeof log.mock.calls[0][0]).toBe("object");
    });

    it("keeps failed health checks structured and at warning level", () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

        new OperationalLogger().health("ready", "error", 3010);

        expect(warn).toHaveBeenCalledWith({
            event: "health.checked",
            check: "ready",
            status: "error",
            durationMs: 3010,
        });
    });
});
