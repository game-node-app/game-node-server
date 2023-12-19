import { IsNotEmpty, IsString } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";

export enum ActivityFeedCriteria {
    FOLLOWING = "following",
    TRENDING = "trending",
    LATEST = "latest",
}

export class ActivitiesFeedRequestDto extends OmitType(BaseFindDto, [
    "orderBy",
    "search",
]) {
    @IsString()
    @IsNotEmpty()
    criteria: ActivityFeedCriteria;
}
