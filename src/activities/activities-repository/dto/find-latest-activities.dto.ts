import { IsEnum, IsOptional, IsString, Length } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Activity } from "../entities/activity.entity";
import { ActivityType } from "../../activities-queue/activities-queue.constants";

export class FindLatestActivitiesDto extends OmitType(BaseFindDto<Activity>, [
    "orderBy",
    "search",
]) {
    @IsOptional()
    @IsString()
    @Length(36)
    userId?: string;
    @IsOptional()
    @IsEnum(ActivityType)
    type?: ActivityType;
}
