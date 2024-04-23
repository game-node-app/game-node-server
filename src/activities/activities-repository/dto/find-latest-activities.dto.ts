import { IsOptional, IsString, Length } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Activity } from "../entities/activity.entity";

export class FindLatestActivitiesDto extends OmitType(BaseFindDto<Activity>, [
    "orderBy",
    "search",
]) {
    @IsOptional()
    @IsString()
    @Length(36)
    userId?: string;
}
