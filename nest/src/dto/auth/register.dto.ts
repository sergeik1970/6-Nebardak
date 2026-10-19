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

export class RegisterDto {
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    @IsString()
    @Length(2, 80)
    @Matches(/^[^\u0000-\u001f\u007f]+$/, {
        message: "name must not contain control characters",
    })
    name: string;

    @Transform(({ value }) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
    )
    @IsEmail()
    @MaxLength(254)
    email: string;

    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @MaxBcryptPasswordBytes()
    password: string;
}
