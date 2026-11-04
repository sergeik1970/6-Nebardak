import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ROOM_LAB_GENERATED_CASES } from "@/shared/lib/furniture-planner/room-lab";
import { answerJson, askModel, modelSettingsFrom, parseEnvFile } from "./model";
import { modelAnswerForRoom, readingFromModel, readingFromRoom, type PlanReading } from "./reading";
import { renderMeasuredPlan } from "./render";
import { scoreReading, type ReadingScore } from "./score";

/**
 * The plan recognition measurement. `PLAN_RECOGNITION=oracle` checks the
 * harness with perfect answers; `PLAN_RECOGNITION=live` asks the model set
 * in ~/.stylefinder-ai.env (AI_API_KEY, AI_MODEL, optional AI_PROVIDER and
 * AI_API_URL). Real plans go in ~/stylefinder-plans as `name.png` or
 * `name.jpg` with `name.truth.json` in the model's own answer format.
 */
const mode = process.env.PLAN_RECOGNITION;
const OUTPUT = path.join(process.cwd(), "test-results", "plan-recognition", "latest");
const REAL_PLANS = path.join(os.homedir(), "stylefinder-plans");
const KINDS = ["bedroom", "living", "children", "office"];
const SCENARIOS = ["facing", "side-door", "long-window", "two-windows", "l-shape"];

interface PlanCase {
    id: string;
    source: "synthetic" | "real";
    png: Buffer;
    truth: PlanReading;
    oracle: unknown;
}

const syntheticCases = async (): Promise<PlanCase[]> => {
    const picked = KINDS.flatMap((kind) =>
        SCENARIOS.map(
            (scenario) =>
                ROOM_LAB_GENERATED_CASES.filter(
                    (candidate) => candidate.tags[0] === kind && candidate.tags[1] === scenario,
                )[3],
        ),
    );
    return Promise.all(
        picked.map(async (roomCase) => {
            const room = { ...roomCase.room, fixedFurniture: undefined };
            return {
                id: roomCase.id,
                source: "synthetic" as const,
                png: await sharp(Buffer.from(renderMeasuredPlan(room)))
                    .png()
                    .toBuffer(),
                truth: readingFromRoom(room),
                oracle: modelAnswerForRoom(room),
            };
        }),
    );
};

const realCases = async (): Promise<PlanCase[]> => {
    if (!fs.existsSync(REAL_PLANS)) return [];
    const images = fs.readdirSync(REAL_PLANS).filter((file) => /\.(png|jpe?g)$/i.test(file));
    return Promise.all(
        images.flatMap((file) => {
            const truthFile = path.join(REAL_PLANS, file.replace(/\.(png|jpe?g)$/i, ".truth.json"));
            if (!fs.existsSync(truthFile)) return [];
            const answer = JSON.parse(fs.readFileSync(truthFile, "utf8"));
            const parsed = readingFromModel(answer);
            if ("error" in parsed) throw new Error(`${truthFile}: ${parsed.error}`);
            return [
                (async () => ({
                    id: file,
                    source: "real" as const,
                    // Large photos are scaled down: the model sees ~2000 px at most.
                    png: await sharp(path.join(REAL_PLANS, file))
                        .rotate()
                        .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
                        .png()
                        .toBuffer(),
                    truth: parsed.reading,
                    oracle: answer,
                }))(),
            ];
        }),
    );
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

describe.runIf(mode === "oracle" || mode === "live")("plan recognition measurement run", () => {
    it("reads every plan and reports", { timeout: 3_600_000 }, async () => {
        const settings =
            mode === "live"
                ? modelSettingsFrom(
                      parseEnvFile(
                          fs.readFileSync(path.join(os.homedir(), ".stylefinder-ai.env"), "utf8"),
                      ),
                  )
                : null;
        if (mode === "live")
            expect(settings, "Нет AI_API_KEY или AI_MODEL в ~/.stylefinder-ai.env").not.toBeNull();

        const cases = [...(await syntheticCases()), ...(await realCases())];
        fs.mkdirSync(path.join(OUTPUT, "images"), { recursive: true });
        const results: {
            id: string;
            source: PlanCase["source"];
            score?: ReadingScore;
            error?: string;
            ms: number;
            answer?: string;
        }[] = [];

        for (const planCase of cases) {
            fs.writeFileSync(path.join(OUTPUT, "images", `${planCase.id}.png`), planCase.png);
            const started = performance.now();
            let answer = "";
            try {
                answer = settings
                    ? await askModel(settings, planCase.png.toString("base64"))
                    : JSON.stringify(planCase.oracle);
                const parsed = readingFromModel(answerJson(answer));
                results.push(
                    "error" in parsed
                        ? {
                              id: planCase.id,
                              source: planCase.source,
                              error: parsed.error,
                              ms: 0,
                              answer,
                          }
                        : {
                              id: planCase.id,
                              source: planCase.source,
                              score: scoreReading(planCase.truth, parsed.reading),
                              ms: 0,
                              answer,
                          },
                );
            } catch (error) {
                results.push({
                    id: planCase.id,
                    source: planCase.source,
                    error: error instanceof Error ? error.message : String(error),
                    ms: 0,
                    answer,
                });
            }
            results[results.length - 1].ms = Math.round(performance.now() - started);
        }

        const lines = [
            `# Распознавание плана: ${settings ? `${settings.provider} ${settings.model}` : "проверка замера (идеальные ответы)"}`,
            "",
            "| План | Стены | Ошибка длины, медиана / макс, мм | Площадь | Проёмы найдены | Лишние | Сдвиг проёма, мм | Ширина, мм | Время |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ...results.map((result) =>
                result.score
                    ? `| ${result.id} | ${result.score.wallsMatched}/${result.score.walls} | ${result.score.wallErrorMedian} / ${result.score.wallErrorMax} | ${percent(result.score.areaError)} | ${result.score.openingsFound}/${result.score.openings} | ${result.score.openingsExtra} | ${result.score.openingCentreErrorMedian} | ${result.score.openingWidthErrorMedian} | ${result.ms} мс |`
                    : `| ${result.id} | ошибка: ${result.error} | | | | | | | ${result.ms} мс |`,
            ),
            "",
        ];
        for (const source of ["synthetic", "real"] as const) {
            const scored = results.filter((result) => result.source === source && result.score);
            const all = results.filter((result) => result.source === source);
            if (!all.length) continue;
            const sum = (pick: (score: ReadingScore) => number) =>
                scored.reduce((total, result) => total + pick(result.score!), 0);
            const exactWalls = scored.filter(
                (result) =>
                    result.score!.wallsMatched === result.score!.walls &&
                    result.score!.wallErrorMax <= 50,
            ).length;
            lines.push(
                `**${source === "synthetic" ? "Синтетические" : "Настоящие"} планы:** ответ разобран в ${scored.length} из ${all.length}; все стены точнее 5 см в ${exactWalls}; проёмов найдено ${sum((score) => score.openingsFound)} из ${sum((score) => score.openings)}, лишних ${sum((score) => score.openingsExtra)}.`,
                "",
            );
        }
        fs.writeFileSync(path.join(OUTPUT, "report.md"), `${lines.join("\n")}\n`);
        fs.writeFileSync(
            path.join(OUTPUT, "results.json"),
            `${JSON.stringify(results, null, 2)}\n`,
        );

        if (mode === "oracle") {
            for (const result of results) {
                expect(result.error, result.id).toBeUndefined();
                expect(result.score?.wallErrorMax, result.id).toBe(0);
                expect(result.score?.openingsFound, result.id).toBe(result.score?.openings);
            }
        }
    });
});
