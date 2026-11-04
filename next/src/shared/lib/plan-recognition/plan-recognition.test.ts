import { describe, expect, it } from "vitest";
import { ROOM_LAB_GENERATED_CASES } from "@/shared/lib/furniture-planner/room-lab";
import { answerJson, modelSettingsFrom, parseEnvFile } from "./model";
import { modelAnswerForRoom, readingFromModel, readingFromRoom } from "./reading";
import { renderMeasuredPlan } from "./render";
import { scoreReading } from "./score";

const room = (id: string) => {
    const roomCase = ROOM_LAB_GENERATED_CASES.find((candidate) => candidate.id === id);
    if (!roomCase) throw new Error(id);
    return { ...roomCase.room, fixedFurniture: undefined };
};

describe("plan recognition measurement", () => {
    for (const id of ["GEN-bedroom-3600x4500-radiator", "GEN-living-4000x6000-l-shape"]) {
        it(`scores a perfect answer as perfect: ${id}`, () => {
            const truth = readingFromRoom(room(id));
            const parsed = readingFromModel(modelAnswerForRoom(room(id)));
            if ("error" in parsed) throw new Error(parsed.error);

            expect(scoreReading(truth, parsed.reading)).toMatchObject({
                wallsMatched: truth.contour.length,
                wallErrorMax: 0,
                areaError: 0,
                openingsFound: truth.openings.length,
                openingsExtra: 0,
                openingCentreErrorMedian: 0,
            });
        });
    }

    it("ignores where the model puts its origin", () => {
        const answer = modelAnswerForRoom(room("GEN-bedroom-3600x4500-radiator"));
        const shifted = {
            ...answer,
            contour: answer.contour.map((point) => ({ x: point.x + 500, y: point.y + 700 })),
        };
        const parsed = readingFromModel(shifted);
        if ("error" in parsed) throw new Error(parsed.error);

        expect(
            scoreReading(readingFromRoom(room("GEN-bedroom-3600x4500-radiator")), parsed.reading),
        ).toMatchObject({ wallErrorMax: 0, openingCentreErrorMedian: 0 });
    });

    it("counts a misplaced window and a missing door", () => {
        const answer = modelAnswerForRoom(room("GEN-bedroom-3600x4500-radiator"));
        const wrong = {
            ...answer,
            openings: answer.openings
                .filter((opening) => opening.kind === "window")
                .map((opening) => ({ ...opening, offset: opening.offset + 150 })),
        };
        const parsed = readingFromModel(wrong);
        if ("error" in parsed) throw new Error(parsed.error);

        const score = scoreReading(
            readingFromRoom(room("GEN-bedroom-3600x4500-radiator")),
            parsed.reading,
        );
        expect(score.openingsFound).toBe(1);
        expect(score.openings).toBe(2);
        expect(score.openingCentreErrorMedian).toBe(150);
    });

    it("turns a malformed answer into an error, not a crash", () => {
        expect(readingFromModel(null)).toEqual({ error: "Ответ не JSON-объект." });
        expect(readingFromModel({ contour: [{ x: 0, y: 0 }] })).toMatchObject({
            error: expect.any(String),
        });
        expect(
            readingFromModel({
                contour: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 },
                ],
                openings: [{ kind: "door", wall: 9, offset: 0, width: 800 }],
            }),
        ).toEqual({ error: "Проём на несуществующей стене 9." });
    });

    it("draws every wall's length on the plan", () => {
        const svg = renderMeasuredPlan(room("GEN-bedroom-3600x4500-radiator"));
        expect(svg).toContain(">3600<");
        expect(svg).toContain(">4500<");
    });

    it("reads settings and fenced answers", () => {
        expect(modelSettingsFrom(parseEnvFile("AI_RELAY_TOKEN='k'\n# note\n"))).toEqual({
            relayUrl: "http://127.0.0.1:8790",
            relayToken: "k",
        });
        expect(
            modelSettingsFrom({ AI_RELAY_TOKEN: "k", AI_RELAY_URL: "http://localhost:9000/" }),
        ).toEqual({ relayUrl: "http://localhost:9000", relayToken: "k" });
        expect(modelSettingsFrom({})).toBeNull();
        expect(answerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });
});
