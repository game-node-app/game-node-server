import { BaseFindDto } from "../../utils/base-find.dto";
import { OmitType } from "@nestjs/swagger";
import { Report } from "../entity/report.entity";

export class FindReportRequestDto extends BaseFindDto<Report> {}

export class FindLatestReportRequestDto extends OmitType(BaseFindDto<Report>, [
    "search",
    "orderBy",
]) {}
