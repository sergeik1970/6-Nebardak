import { BadRequestException } from "@nestjs/common";
import {
    ValidateBy,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";

export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function passwordUtf8ByteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

export function isWithinBcryptPasswordLimit(value: unknown): boolean {
    return (
        typeof value === "string" &&
        passwordUtf8ByteLength(value) <= BCRYPT_MAX_PASSWORD_BYTES
    );
}

export function MaxBcryptPasswordBytes(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return ValidateBy(
        {
            name: "maxBcryptPasswordBytes",
            validator: {
                validate: isWithinBcryptPasswordLimit,
                defaultMessage: (args: ValidationArguments) =>
                    `${args.property} must be at most ${BCRYPT_MAX_PASSWORD_BYTES} UTF-8 bytes`,
            },
        },
        validationOptions,
    );
}

/** Defense-in-depth for callers that bypass Nest's DTO validation pipeline. */
export function assertBcryptPasswordLength(password: string): void {
    if (!isWithinBcryptPasswordLimit(password)) {
        throw new BadRequestException(
            `Пароль не должен превышать ${BCRYPT_MAX_PASSWORD_BYTES} байта UTF-8`,
        );
    }
}
