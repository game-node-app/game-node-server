import { IsNotEmpty, IsString } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";

export enum ActivityFeedCriteria {
    FOLLOWING = "FOLLOWING",
    TRENDING = "TRENDING",
    RECENT = "RECENT",
}

export class ActivitiesFeedRequestDto extends OmitType(BaseFindDto, [
    "orderBy",
    "search",
]) {
    @IsString()
    @IsNotEmpty()
    criteria: ActivityFeedCriteria;
}
