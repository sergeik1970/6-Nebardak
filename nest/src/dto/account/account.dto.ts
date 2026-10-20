import { Transform } from "class-transformer";
import {
    IsString,
    Length,
    Matches,
    MaxLength,
    MinLength,
} from "class-validator";
import { MaxBcryptPasswordBytes } from "../../security/bcrypt-password.policy";

export class UpdateProfileDto {
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    @IsString()
    @Length(2, 80)
    @Matches(/^[^\u0000-\u001f\u007f]+$/, {
        message: "name must not contain control characters",
    })
    name: string;
}

/** The current password is checked like a login, so only its size is bounded. */
export class ChangePasswordDto {
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    @MaxBcryptPasswordBytes()
    currentPassword: string;

    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @MaxBcryptPasswordBytes()
    newPassword: string;
}

export class DeleteAccountDto {
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    @MaxBcryptPasswordBytes()
    password: string;
}
