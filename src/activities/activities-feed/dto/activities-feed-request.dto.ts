import { IsNotEmpty, IsString } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";

export enum ActivityFeedCriteria {
    FOLLOWING = "following",
    ALL = "all",
}

export class ActivitiesFeedRequestDto extends OmitType(BaseFindDto, [
    "search",
]) {
    @IsString()
    @IsNotEmpty()
    criteria: ActivityFeedCriteria;
}
