import { Transform, Type } from "class-transformer";
import {
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    Matches,
    Max,
    Min,
    ValidateNested,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    Validate,
} from "class-validator";
import {
    PROJECT_STAGES,
    ProjectStage,
} from "../../entities/Project/project.entity";
import {
    PROJECT_DOCUMENT_PROBLEM_MESSAGES,
    findProjectDocumentProblem,
} from "../../projects/project-document";

@ValidatorConstraint({ name: "projectDocument" })
class ProjectDocumentConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        return findProjectDocumentProblem(value) === null;
    }

    defaultMessage(args: ValidationArguments): string {
        const problem = findProjectDocumentProblem(args.value);
        return problem
            ? PROJECT_DOCUMENT_PROBLEM_MESSAGES[problem]
            : "Проект повреждён.";
    }
}

const trimString = ({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value;

const NAME_PATTERN = /^[^\u0000-\u001f\u007f]+$/;

export class ProjectSummaryDto {
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @Length(1, 60)
    @Matches(NAME_PATTERN)
    styleLabel?: string;

    @IsOptional()
    @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
    @Min(0)
    @Max(10_000)
    areaM2?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(1_000)
    furnitureCount?: number;

    @IsOptional()
    @IsIn(PROJECT_STAGES)
    stage?: ProjectStage;
}

export class ProjectNameDto {
    @Transform(trimString)
    @IsString()
    @Length(1, 80)
    @Matches(NAME_PATTERN, {
        message: "Название не должно содержать служебных символов",
    })
    name: string;
}

export class CreateProjectDto {
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @Length(1, 80)
    @Matches(NAME_PATTERN, {
        message: "Название не должно содержать служебных символов",
    })
    name?: string;

    @Validate(ProjectDocumentConstraint)
    document: Record<string, unknown>;

    @IsOptional()
    @ValidateNested()
    @Type(() => ProjectSummaryDto)
    summary?: ProjectSummaryDto;

    /** Lets a retried guest-draft import return the project it already created. */
    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/, {
        message: "clientImportId must be 8-64 letters, digits, _ or -",
    })
    clientImportId?: string;
}

export class SaveProjectDocumentDto {
    @Validate(ProjectDocumentConstraint)
    document: Record<string, unknown>;

    @IsInt()
    @Min(1)
    baseRevision: number;

    @IsOptional()
    @ValidateNested()
    @Type(() => ProjectSummaryDto)
    summary?: ProjectSummaryDto;
}
