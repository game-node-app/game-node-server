import { ReportCategory, ReportSourceType } from "../report.constants";
import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
} from "class-validator";

export class CreateReportRequestDto {
    @IsNotEmpty()
    @IsEnum(ReportSourceType)
    sourceType: ReportSourceType;
    @IsNotEmpty()
    @IsString()
    @Length(36)
    sourceId: string;
    @IsNotEmpty()
    @IsEnum(ReportCategory)
    category: ReportCategory;
    @IsOptional()
    @IsString()
    reason?: string;
}
