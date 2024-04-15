import { IsNotEmpty, IsString } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Activity } from "../../activities-repository/entities/activity.entity";

export enum ActivityFeedCriteria {
    FOLLOWING = "following",
    ALL = "all",
}

export class ActivitiesFeedRequestDto extends OmitType(BaseFindDto<Activity>, [
    "search",
]) {
    @IsString()
    @IsNotEmpty()
    criteria: ActivityFeedCriteria;
}
