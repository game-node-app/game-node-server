import { StatisticsSourceType } from "../../statistics.constants";
import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class StatisticsActionDto {
    @IsString()
    @Length(36)
    @IsOptional()
    targetUserId?: string;
    @IsNotEmpty()
    @ApiProperty({
        oneOf: [{ type: "string" }, { type: "number" }],
    })
    sourceId: string | number;
    @IsNotEmpty()
    @IsEnum(StatisticsSourceType)
    sourceType: StatisticsSourceType;
}
