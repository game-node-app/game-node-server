import { IsNotEmpty, IsString } from "class-validator";

export enum ActivityFeedCriteria {
    FOLLOWING = "FOLLOWING",
    TRENDING = "TRENDING",
    RECENT = "RECENT",
    POPULAR = "POPULAR",
}

export class BuildActivitiesDto {
    @IsString()
    @IsNotEmpty()
    criteria: ActivityFeedCriteria;
}
