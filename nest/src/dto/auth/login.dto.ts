import { Transform } from "class-transformer";
import {
    IsEmail,
    IsString,
    Length,
    Matches,
    MaxLength,
    MinLength,
} from "class-validator";
import { MaxBcryptPasswordBytes } from "../../security/bcrypt-password.policy";

export class LoginDto {
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
    )
    @IsEmail()
    @MaxLength(254)
    email: string;

    @IsString()
    @MinLength(1)
    @MaxLength(128)
    @MaxBcryptPasswordBytes()
    password: string;
}

/** The second step of an administrator sign-in. */
export class LoginCodeDto {
    @IsString()
    @Length(1, 64)
    challenge: string;

    @Transform(({ value }) =>
        typeof value === "string" ? value.replace(/\s+/g, "") : value,
    )
    @Matches(/^\d{6}$/, { message: "Код — шесть цифр из письма" })
    code: string;
}
