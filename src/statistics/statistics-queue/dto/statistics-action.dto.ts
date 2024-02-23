import { StatisticsSourceType } from "../../statistics.constants";
import { IsEnum, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class StatisticsActionDto {
    @IsNotEmpty()
    @ApiProperty({
        oneOf: [{ type: "string" }, { type: "number" }],
    })
    sourceId: string | number;
    @IsNotEmpty()
    @IsEnum(StatisticsSourceType)
    sourceType: StatisticsSourceType;
}
