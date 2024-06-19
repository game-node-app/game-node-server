import { ReportHandleAction } from "../report.constants";
import { IsBoolean, IsEnum, IsNotEmpty } from "class-validator";

export class HandleReportRequestDto {
    @IsNotEmpty()
    @IsEnum(ReportHandleAction)
    action: ReportHandleAction;
    @IsNotEmpty()
    @IsBoolean()
    deleteReportedContent: boolean = true;
}
