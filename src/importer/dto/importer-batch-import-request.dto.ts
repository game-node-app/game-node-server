import { ApiHideProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsUUID,
    Min,
    Max,
    Validate,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from "class-validator";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";

@ValidatorConstraint({ name: "importSelection" })
class ImportSelection implements ValidatorConstraintInterface {
    validate(_: unknown, args: ValidationArguments) {
        const dto = args.object as ImporterBatchImportRequestDto;
        return dto.importAll === true
            ? dto.externalGameIds === undefined
            : Array.isArray(dto.externalGameIds) &&
                  dto.externalGameIds.length > 0;
    }
    defaultMessage() {
        return "Provide externalGameIds or importAll=true, but not both";
    }
}

export class ImporterBatchImportRequestDto {
    @ApiHideProperty()
    @Validate(ImportSelection)
    readonly selection?: undefined;

    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @IsInt({ each: true })
    @Min(1, { each: true })
    @Max(Number.MAX_SAFE_INTEGER, { each: true })
    externalGameIds?: number[];

    @ApiPropertyOptional({ type: Boolean, default: false })
    @IsOptional()
    @IsBoolean()
    @Transform(({ obj, key }) => obj[key])
    importAll?: boolean;

    @ApiPropertyOptional({
        enum: CollectionEntryStatus,
        default: CollectionEntryStatus.PLANNED,
    })
    @IsOptional()
    @IsEnum(CollectionEntryStatus)
    status?: CollectionEntryStatus;

    @ApiPropertyOptional({ type: [String], format: "uuid" })
    @IsOptional()
    @IsArray()
    @IsUUID("all", { each: true })
    collectionIds?: string[];
}
