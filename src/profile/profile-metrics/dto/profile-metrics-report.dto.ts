import { Period } from "../../../utils/period";
import { IsOptional } from "class-validator";

export class ProfileMetricsReportRequestDto {
    @IsOptional()
    period: Period = Period.MONTH;
}

export class ProfileMetricsReportResponseDto {
    playedInPeriod: number;
    finishedInPeriod: number;
    reviewedInPeriod: number;
    playtimeSecondsInPeriod: number;
}
