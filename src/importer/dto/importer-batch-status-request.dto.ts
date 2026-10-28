import { ApiProperty } from "@nestjs/swagger";
import {
    ArrayNotEmpty,
    IsArray,
    IsEnum,
    IsIn,
    IsInt,
    Max,
    Min,
} from "class-validator";
import { EImporterSource } from "../importer.constants";

export class ImporterBatchStatusRequestDto {
    @ApiProperty({ enum: EImporterSource })
    @IsEnum(EImporterSource)
    source: EImporterSource;

    @ApiProperty({ type: [Number] })
    @IsArray()
    @ArrayNotEmpty()
    @IsInt({ each: true })
    @Min(1, { each: true })
    @Max(Number.MAX_SAFE_INTEGER, { each: true })
    externalGameIds: number[];

    @ApiProperty({ enum: ["processed", "ignored"] })
    @IsIn(["processed", "ignored"])
    status: "processed" | "ignored";
}
