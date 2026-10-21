import { Transform } from "class-transformer";
import {
    IsEmail,
    IsString,
    Length,
    MaxLength,
    MinLength,
} from "class-validator";
import { MaxBcryptPasswordBytes } from "../../security/bcrypt-password.policy";

/** Tokens are 43 base64url characters; anything else is rejected later as unknown. */
export class EmailTokenDto {
    @IsString()
    @Length(1, 64)
    token: string;
}

export class ForgotPasswordDto {
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
    )
    @IsEmail()
    @MaxLength(254)
    email: string;
}

export class ResetPasswordDto extends EmailTokenDto {
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @MaxBcryptPasswordBytes()
    password: string;
}
