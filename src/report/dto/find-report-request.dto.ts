import { BaseFindDto } from "../../utils/base-find.dto";
import { OmitType } from "@nestjs/swagger";
import { Report } from "../entity/report.entity";
import { IsBoolean, IsOptional } from "class-validator";

export class FindLatestReportRequestDto extends OmitType(BaseFindDto<Report>, [
    "search",
    "orderBy",
]) {
    @IsOptional()
    @IsBoolean()
    includeClosed: boolean = false;
}
