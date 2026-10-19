import {
    IsObject,
    IsString,
    Matches,
    MaxLength,
    MinLength,
} from "class-validator";

/**
 * The detailed geometry is already validated by the deterministic planner.
 * The API treats it as an immutable evidence snapshot and bounds all fields
 * that are useful for indexing or idempotency.
 */
export class CreatePlannerObservationDto {
    @IsString()
    @MinLength(8)
    @MaxLength(64)
    @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
        message:
            "clientObservationId must use letters, numbers, underscores or hyphens",
    })
    clientObservationId: string;

    @IsObject()
    inputSnapshot: Record<string, unknown>;

    @IsObject()
    layoutSnapshot: Record<string, unknown>;

    @IsString()
    @MinLength(1)
    @MaxLength(512)
    inputFingerprint: string;

    @IsString()
    @MinLength(1)
    @MaxLength(512)
    layoutFingerprint: string;

    @IsString()
    @MinLength(1)
    @MaxLength(80)
    algorithmVersion: string;

    @IsString()
    @MinLength(1)
    @MaxLength(512)
    catalogVersion: string;

    @IsString()
    @MinLength(1)
    @MaxLength(24)
    solverStatus: string;
}
