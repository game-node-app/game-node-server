import { StatisticsSourceType } from "../../statistics.constants";
import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";

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
