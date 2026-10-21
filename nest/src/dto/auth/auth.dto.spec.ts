import { BadRequestException } from "@nestjs/common";
import { RegisterDto } from "./register.dto";
import { LoginDto } from "./login.dto";
import { createGlobalValidationPipe } from "../../config/validation";
import { CURRENT_CONSENT_VERSION } from "../../legal/consent";

const bodyMetadata = <T>(metatype: new () => T) => ({
    type: "body" as const,
    metatype,
    data: undefined,
});

describe("auth DTO validation", () => {
    const pipe = createGlobalValidationPipe();

    it("normalizes a valid registration body", async () => {
        const result = await pipe.transform(
            {
                name: "  Мария  ",
                email: "  MARIA@EXAMPLE.COM ",
                password: "a-secure-password",
                consentVersion: CURRENT_CONSENT_VERSION,
            },
            bodyMetadata(RegisterDto),
        );

        expect(result).toBeInstanceOf(RegisterDto);
        expect(result).toEqual({
            name: "Мария",
            email: "maria@example.com",
            password: "a-secure-password",
            consentVersion: CURRENT_CONSENT_VERSION,
        });
    });

    it.each([undefined, "", "2020-01-01", true])(
        "requires the current consent edition, not %p",
        async (consentVersion) => {
            const error = await pipe
                .transform(
                    {
                        name: "Мария",
                        email: "maria@example.com",
                        password: "a-secure-password",
                        ...(consentVersion === undefined
                            ? {}
                            : { consentVersion }),
                    },
                    bodyMetadata(RegisterDto),
                )
                .catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(BadRequestException);
            expect(JSON.stringify(error)).toContain("согласие");
        },
    );

    it("rejects unknown properties and does not echo password values", async () => {
        expect.assertions(2);

        try {
            await pipe.transform(
                {
                    name: "Мария",
                    email: "maria@example.com",
                    password: "private-password",
                    role: "admin",
                },
                bodyMetadata(RegisterDto),
            );
        } catch (error) {
            expect(error).toBeInstanceOf(BadRequestException);
            expect(JSON.stringify(error)).not.toContain("private-password");
        }
    });

    it("rejects an invalid email and a short registration password", async () => {
        await expect(
            pipe.transform(
                {
                    name: "Мария",
                    email: "not-an-email",
                    password: "short",
                },
                bodyMetadata(RegisterDto),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("normalizes login email without trimming the password", async () => {
        const result = await pipe.transform(
            {
                email: " USER@EXAMPLE.COM ",
                password: " password-with-intentional-space ",
            },
            bodyMetadata(LoginDto),
        );

        expect(result).toEqual({
            email: "user@example.com",
            password: " password-with-intentional-space ",
        });
    });

    it.each([
        [RegisterDto, "a".repeat(73)],
        [LoginDto, "a".repeat(73)],
        [RegisterDto, "я".repeat(37)],
        [LoginDto, "я".repeat(37)],
    ])(
        "rejects a password over bcrypt's 72-byte limit for %p",
        async (Dto, password) => {
            const body =
                Dto === RegisterDto
                    ? {
                          name: "Мария",
                          email: "maria@example.com",
                          password,
                          consentVersion: CURRENT_CONSENT_VERSION,
                      }
                    : { email: "maria@example.com", password };

            await expect(
                pipe.transform(body, bodyMetadata(Dto)),
            ).rejects.toBeInstanceOf(BadRequestException);
        },
    );

    it("accepts a password that is exactly 72 UTF-8 bytes", async () => {
        const password = "я".repeat(36);

        await expect(
            pipe.transform(
                { email: "maria@example.com", password },
                bodyMetadata(LoginDto),
            ),
        ).resolves.toMatchObject({ password });
    });
});
