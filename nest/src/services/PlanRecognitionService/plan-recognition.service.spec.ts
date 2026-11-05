import {
    BadGatewayException,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { getPlanRecognitionConfig } from "../../config/plan-recognition.config";
import { PLAN_READING_PROMPT } from "./plan-reading.prompt";
import { PlanRecognitionService } from "./plan-recognition.service";

const TOKEN = "t".repeat(40);
const CONFIG = {
    relayUrl: "http://relay:8790",
    relayToken: TOKEN,
    timeoutMs: 1000,
};
const DTO = { mimeType: "image/jpeg" as const, image: "A".repeat(200) };

const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("plan recognition config", () => {
    it("stays off unless enabled explicitly", () => {
        expect(getPlanRecognitionConfig({ AI_RELAY_TOKEN: TOKEN })).toBeNull();
        expect(
            getPlanRecognitionConfig({ PLAN_RECOGNITION_ENABLED: "false" }),
        ).toBeNull();
    });

    it("needs a real relay token once enabled", () => {
        expect(() =>
            getPlanRecognitionConfig({ PLAN_RECOGNITION_ENABLED: "true" }),
        ).toThrow(/AI_RELAY_TOKEN/);
        expect(
            getPlanRecognitionConfig({
                PLAN_RECOGNITION_ENABLED: "true",
                AI_RELAY_TOKEN: TOKEN,
                AI_RELAY_URL: "http://relay.internal:8790/",
            }),
        ).toEqual({
            relayUrl: "http://relay.internal:8790",
            relayToken: TOKEN,
            timeoutMs: 330_000,
        });
    });
});

describe("PlanRecognitionService", () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, "log").mockImplementation();
        jest.spyOn(Logger.prototype, "warn").mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it("asks the relay with the server's own prompt and returns the parsed answer", async () => {
        const fetchImpl = jest.fn(() =>
            reply(200, {
                text: '```json\n{"rooms":[]}\n```',
                model: "openai/gpt-6.1-terra",
            }),
        );
        const service = new PlanRecognitionService(CONFIG, fetchImpl);

        const result = await service.read("7", DTO);

        expect(result).toMatchObject({
            answer: { rooms: [] },
            model: "openai/gpt-6.1-terra",
        });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toBe("http://relay:8790/v1/vision");
        expect((init.headers as Record<string, string>).authorization).toBe(
            `Bearer ${TOKEN}`,
        );
        expect(JSON.parse(init.body as string)).toEqual({
            prompt: PLAN_READING_PROMPT,
            image: { mimeType: "image/jpeg", base64: DTO.image },
            json: true,
        });
    });

    it("never logs the image itself", async () => {
        const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
        await new PlanRecognitionService(CONFIG, () =>
            reply(200, { text: "{}" }),
        ).read("7", DTO);

        expect(JSON.stringify(log.mock.calls)).not.toContain(DTO.image);
        expect(log.mock.calls[0][0]).toMatchObject({
            event: "plan-recognition.read",
            outcome: "ok",
        });
    });

    it("is not found while switched off", async () => {
        await expect(
            new PlanRecognitionService(null).read("7", DTO),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("turns relay failures into readable errors", async () => {
        await expect(
            new PlanRecognitionService(CONFIG, () =>
                Promise.reject(new Error("refused")),
            ).read("7", DTO),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        await expect(
            new PlanRecognitionService(CONFIG, () =>
                reply(502, { error: "provider" }),
            ).read("7", DTO),
        ).rejects.toBeInstanceOf(BadGatewayException);
        await expect(
            new PlanRecognitionService(CONFIG, () =>
                reply(200, { text: "not json" }),
            ).read("7", DTO),
        ).rejects.toBeInstanceOf(BadGatewayException);
    });
});
