import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
    APARTMENT_READING_PROMPT,
    apartmentFromModel,
    scoreApartment,
    type ApartmentScore,
    type ApartmentTruth,
} from "./apartment";
import {
    answerJson,
    askModel,
    modelSettingsFrom,
    parseEnvFile,
    relayStatus,
    relayUsage,
    type ModelUsage,
} from "./model";

/**
 * Whole-apartment plans: `PLAN_RECOGNITION=apartments` asks the model through
 * the AI relay about every `name.png|jpg` in ~/stylefinder-plans/apartments
 * that has a `name.truth.json` (an ApartmentTruth). Optional PLAN_ONLY=name
 * runs one plan; PLAN_REUSE=1 rescores the last answers and asks only for
 * plans that have none; PLAN_MODEL=<model> asks one of the relay's other
 * allowed models; PLAN_TAG=<name> stores a repeated run separately.
 */
const DIRECTORY = path.join(os.homedir(), "stylefinder-plans", "apartments");
/** PLAN_MODEL picks one of the relay's allowed models; each model gets its own report. */
const MODEL = process.env.PLAN_MODEL || undefined;
const OUTPUT = path.join(
    process.cwd(),
    "test-results",
    "plan-recognition",
    "apartments",
    ...(MODEL ? [MODEL.replace(/[^a-z0-9.-]+/gi, "_")] : []),
    // PLAN_TAG keeps a repeated run apart from the first, e.g. PLAN_TAG=run2.
    ...(process.env.PLAN_TAG ? [process.env.PLAN_TAG.replace(/[^a-z0-9.-]+/gi, "_")] : []),
);
/** Sheets are A3 with small dimension numbers: send more pixels than for one room. */
const MAX_SIDE = 2800;

const percent = (value: number) => `${Math.round(value * 100)}%`;

describe.runIf(process.env.PLAN_RECOGNITION === "apartments")("apartment plan reading", () => {
    it("reads every apartment plan and reports", { timeout: 3_600_000 }, async () => {
        const settings = modelSettingsFrom(
            parseEnvFile(fs.readFileSync(path.join(os.homedir(), ".stylefinder-ai.env"), "utf8")),
        );
        expect(settings, "Нет AI_RELAY_TOKEN в ~/.stylefinder-ai.env").not.toBeNull();
        const relay = await relayStatus(settings!);
        if ("error" in relay) throw new Error(relay.error);

        const only = process.env.PLAN_ONLY;
        const plans = fs
            .readdirSync(DIRECTORY)
            .filter((file) => /\.(png|jpe?g)$/i.test(file))
            .map((file) => ({ file, name: file.replace(/\.(png|jpe?g)$/i, "") }))
            .filter(({ name }) => fs.existsSync(path.join(DIRECTORY, `${name}.truth.json`)))
            .filter(({ name }) => !only || name === only);
        expect(plans.length, `Нет планов с правильными ответами в ${DIRECTORY}`).toBeGreaterThan(0);

        fs.mkdirSync(OUTPUT, { recursive: true });
        // PLAN_REUSE=1 scores the answers of the last run again instead of paying for new ones.
        const previousFile = path.join(OUTPUT, "results.json");
        const previous: { name: string; answer: string; usage: ModelUsage | null }[] =
            process.env.PLAN_REUSE === "1" && fs.existsSync(previousFile)
                ? JSON.parse(fs.readFileSync(previousFile, "utf8"))
                : [];
        const results: {
            name: string;
            score?: ApartmentScore;
            error?: string;
            ms: number;
            usage: ModelUsage | null;
            answer: string;
        }[] = [];
        for (const { file, name } of plans) {
            const truth = JSON.parse(
                fs.readFileSync(path.join(DIRECTORY, `${name}.truth.json`), "utf8"),
            ) as ApartmentTruth;
            const png = await sharp(path.join(DIRECTORY, file))
                .rotate()
                .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
                .png()
                .toBuffer();
            const started = performance.now();
            const reused = previous.find((result) => result.name === name && result.answer);
            let answer = "";
            let usage: ModelUsage | null = null;
            try {
                if (reused) ({ answer, usage } = reused);
                else
                    ({ text: answer, usage } = await askModel(
                        settings!,
                        png.toString("base64"),
                        APARTMENT_READING_PROMPT,
                        MODEL,
                    ));
                const parsed = apartmentFromModel(answerJson(answer));
                results.push({
                    name,
                    ...("error" in parsed
                        ? { error: parsed.error }
                        : { score: scoreApartment(truth, parsed.rooms) }),
                    ms: Math.round(performance.now() - started),
                    usage,
                    answer,
                });
            } catch (error) {
                results.push({
                    name,
                    error: error instanceof Error ? error.message : String(error),
                    ms: Math.round(performance.now() - started),
                    usage,
                    answer,
                });
            }
        }

        const lines = [
            `# Распознавание квартир: ${relay.provider} ${MODEL ?? relay.model}`,
            "",
            "| План | Комнаты найдены | Лишние | Площадь, медиана ошибки | Стены точнее 5 см | Ошибка стены, медиана, мм | Окна верно | Вход | Время | Цена, $ |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | ---: | ---: |",
            ...results.map(({ name, score, error, ms, usage }) =>
                score
                    ? `| ${name} | ${score.roomsFound}/${score.rooms} | ${score.roomsExtra} | ${percent(score.areaErrorMedian)} | ${score.wallsExact}/${score.walls} | ${score.wallErrorMedian} | ${score.windowsRight}/${score.windowsChecked} | ${score.entranceRight ? "да" : "нет"} | ${Math.round(ms / 1000)} с | ${usage?.cost?.toFixed(4) ?? ""} |`
                    : `| ${name} | ошибка: ${error} | | | | | | | ${Math.round(ms / 1000)} с | ${usage?.cost?.toFixed(4) ?? ""} |`,
            ),
            "",
        ];
        const scored = results.flatMap((result) => (result.score ? [result.score] : []));
        const sum = (pick: (score: ApartmentScore) => number) =>
            scored.reduce((total, score) => total + pick(score), 0);
        lines.push(
            `**Итого:** ответ разобран в ${scored.length} из ${results.length}; комнат найдено ${sum((score) => score.roomsFound)} из ${sum((score) => score.rooms)}, лишних ${sum((score) => score.roomsExtra)}; стен точнее 5 см ${sum((score) => score.wallsExact)} из ${sum((score) => score.walls)}; окна верно в ${sum((score) => score.windowsRight)} комнатах из ${sum((score) => score.windowsChecked)}.`,
            "",
            `**Расход прогона:** ${results.reduce((total, result) => total + (result.usage?.cost ?? 0), 0).toFixed(4)} $, токенов на выходе ${results.reduce((total, result) => total + (result.usage?.outputTokens ?? 0), 0)}.`,
            "",
        );
        const book = await relayUsage(settings!);
        if (book)
            lines.push(
                `**Всего через посредника:** в этом месяце ${book.month.requests} запросов, ${book.month.cost.toFixed(4)} $.`,
                "",
            );
        for (const { name, score } of results) {
            if (!score) continue;
            lines.push(
                `## ${name}`,
                "",
                "| Комната | Модель назвала | Ошибка площади |",
                "| --- | --- | ---: |",
            );
            for (const match of score.matches)
                lines.push(
                    `| ${match.truth} | ${match.read ?? "не найдена"} | ${match.areaError === null ? "" : percent(match.areaError)} |`,
                );
            lines.push("");
        }
        fs.writeFileSync(path.join(OUTPUT, "report.md"), `${lines.join("\n")}\n`);
        // Plans left out of this run (PLAN_ONLY) keep their last answers.
        const kept = (
            fs.existsSync(previousFile)
                ? (JSON.parse(fs.readFileSync(previousFile, "utf8")) as typeof results)
                : []
        ).filter((old) => !results.some((result) => result.name === old.name));
        fs.writeFileSync(previousFile, `${JSON.stringify([...kept, ...results], null, 2)}\n`);
    });
});
