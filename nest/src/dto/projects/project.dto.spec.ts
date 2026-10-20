import { BadRequestException } from "@nestjs/common";
import { createGlobalValidationPipe } from "../../config/validation";
import {
    CreateProjectDto,
    ProjectNameDto,
    SaveProjectDocumentDto,
} from "./project.dto";

const body = <T>(metatype: new () => T) => ({
    type: "body" as const,
    metatype,
    data: undefined,
});

const document = { version: 4, questionnaire: { items: [] } };

describe("project DTO validation", () => {
    const pipe = createGlobalValidationPipe();

    it("accepts a create body with a summary and trims the name", async () => {
        await expect(
            pipe.transform(
                {
                    name: "  Спальня ",
                    document,
                    summary: {
                        styleLabel: "Прованс",
                        areaM2: 12.5,
                        stage: "room",
                    },
                    clientImportId: "guest-draft-01",
                },
                body(CreateProjectDto),
            ),
        ).resolves.toMatchObject({ name: "Спальня", document });
    });

    it("explains a broken document in Russian", async () => {
        const error = await pipe
            .transform({ document: { version: 1 } }, body(CreateProjectDto))
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(JSON.stringify(error)).toContain(
            "Версия проекта не поддерживается",
        );
    });

    it.each([
        ["an unknown summary field", { summary: { owner: 1 } }],
        ["an unknown stage", { summary: { stage: "shipping" } }],
        ["a negative area", { summary: { areaM2: -1 } }],
        ["a malformed import id", { clientImportId: "../../x" }],
    ])("rejects %s", async (_label, extra) => {
        await expect(
            pipe.transform({ document, ...extra }, body(CreateProjectDto)),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("requires an integer base revision for saves", async () => {
        for (const baseRevision of [undefined, 0, 1.5, "2"]) {
            await expect(
                pipe.transform(
                    { document, baseRevision },
                    body(SaveProjectDocumentDto),
                ),
            ).rejects.toBeInstanceOf(BadRequestException);
        }
        await expect(
            pipe.transform(
                { document, baseRevision: 3 },
                body(SaveProjectDocumentDto),
            ),
        ).resolves.toMatchObject({ baseRevision: 3 });
    });

    it.each(["", "   ", "x".repeat(81), "Кухня\u0000"])(
        "rejects the project name %p",
        async (name) => {
            await expect(
                pipe.transform({ name }, body(ProjectNameDto)),
            ).rejects.toBeInstanceOf(BadRequestException);
        },
    );
});
