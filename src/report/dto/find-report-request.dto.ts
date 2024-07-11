import { BaseFindDto } from "../../utils/base-find.dto";
import { OmitType } from "@nestjs/swagger";
import { Report } from "../entity/report.entity";
import { IsBoolean, IsOptional } from "class-validator";
import { Transform, Type } from "class-transformer";

export class FindLatestReportRequestDto extends OmitType(BaseFindDto<Report>, [
    "search",
    "orderBy",
]) {
    @IsOptional()
    @Type(() => String)
    @Transform(({ value }) => {
        return value === "true";
    })
    includeClosed?: boolean = false;
}
