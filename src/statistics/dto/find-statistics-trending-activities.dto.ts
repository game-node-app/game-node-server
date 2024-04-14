import { BaseFindDto } from "../../utils/base-find.dto";
import { ActivityStatistics } from "../entity/activity-statistics.entity";
import { OmitType } from "@nestjs/swagger";
import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
} from "class-validator";
import { StatisticsPeriod } from "../statistics.constants";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";

export class FindStatisticsTrendingActivitiesDto extends OmitType(
    BaseFindDto<ActivityStatistics>,
    ["orderBy", "search"],
) {
    /**
     * Usually, this property should not be used unless a specific activity needs to be retrieved, and it's easier to just
     * call the statistics controller.
     */
    @IsOptional()
    @IsString()
    @Length(36)
    activityId?: string;
    @IsOptional()
    @IsString()
    @Length(36)
    userId?: string;
    @IsOptional()
    @IsEnum(ActivityType)
    activityType?: ActivityType;
    @IsNotEmpty()
    @IsEnum(StatisticsPeriod)
    period: StatisticsPeriod;
}
