import { IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";

export const PLAN_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
] as const;
/** The browser scales a plan down to about 2800 px; 8 MB of image is plenty. */
export const PLAN_IMAGE_MAX_BASE64 = Math.ceil((8 * 1024 * 1024 * 4) / 3);

export class ReadPlanDto {
    @IsIn(PLAN_IMAGE_TYPES)
    mimeType: (typeof PLAN_IMAGE_TYPES)[number];

    @IsString()
    @MinLength(100)
    @MaxLength(PLAN_IMAGE_MAX_BASE64)
    @Matches(/^[A-Za-z0-9+/]+=*$/, { message: "image must be base64" })
    image: string;
}
