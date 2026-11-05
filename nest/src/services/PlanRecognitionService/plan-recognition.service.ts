import {
    BadGatewayException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import {
    getPlanRecognitionConfig,
    type PlanRecognitionConfig,
} from "../../config/plan-recognition.config";
import type { ReadPlanDto } from "../../dto/plan-recognition/read-plan.dto";
import { PLAN_READING_PROMPT } from "./plan-reading.prompt";

export interface PlanReadingResult {
    /** The model's answer as JSON; the browser checks it room by room. */
    answer: unknown;
    model: string | null;
    ms: number;
}

/** Strips a ```json fence some models wrap their answer in. */
export const answerJson = (text: string): unknown => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse((fenced ? fenced[1] : text).trim());
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends one plan image to the AI relay and returns the model's reading. The
 * image is not stored or logged; only its size, the time and the outcome are.
 */
@Injectable()
export class PlanRecognitionService {
    private readonly logger = new Logger(PlanRecognitionService.name);

    constructor(
        private readonly config: PlanRecognitionConfig | null = getPlanRecognitionConfig(),
        private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    ) {}

    get enabled(): boolean {
        return this.config !== null;
    }

    async read(userId: string, dto: ReadPlanDto): Promise<PlanReadingResult> {
        if (!this.config) {
            throw new NotFoundException("Распознавание планов выключено");
        }
        const started = Date.now();
        let response: Response;
        try {
            response = await this.fetchImpl(
                `${this.config.relayUrl}/v1/vision`,
                {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${this.config.relayToken}`,
                    },
                    body: JSON.stringify({
                        prompt: PLAN_READING_PROMPT,
                        image: { mimeType: dto.mimeType, base64: dto.image },
                        json: true,
                    }),
                    signal: AbortSignal.timeout(this.config.timeoutMs),
                },
            );
        } catch (error) {
            this.log(userId, dto, started, "unreachable", error);
            throw new ServiceUnavailableException(
                "Сервис распознавания сейчас недоступен. Попробуйте позже.",
            );
        }
        const body = (await response.json().catch(() => null)) as {
            text?: unknown;
            model?: unknown;
            error?: unknown;
        } | null;
        if (!response.ok || typeof body?.text !== "string") {
            this.log(
                userId,
                dto,
                started,
                `relay ${response.status}`,
                body?.error,
            );
            throw new BadGatewayException(
                response.status === 429
                    ? "Распознавание сейчас перегружено. Попробуйте через несколько минут."
                    : "Не удалось распознать план. Попробуйте ещё раз.",
            );
        }
        let answer: unknown;
        try {
            answer = answerJson(body.text);
        } catch (error) {
            this.log(userId, dto, started, "not json", error);
            throw new BadGatewayException(
                "Не удалось распознать план. Попробуйте ещё раз.",
            );
        }
        const ms = Date.now() - started;
        this.log(userId, dto, started, "ok");
        return {
            answer,
            model: typeof body.model === "string" ? body.model : null,
            ms,
        };
    }

    private log(
        userId: string,
        dto: ReadPlanDto,
        started: number,
        outcome: string,
        detail?: unknown,
    ): void {
        const entry = {
            event: "plan-recognition.read",
            userId,
            imageBytes: Math.round((dto.image.length * 3) / 4),
            ms: Date.now() - started,
            outcome,
            ...(detail
                ? {
                      detail:
                          detail instanceof Error
                              ? detail.message
                              : String(detail),
                  }
                : {}),
        };
        if (outcome === "ok") this.logger.log(entry);
        else this.logger.warn(entry);
    }
}
