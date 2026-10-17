import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
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
