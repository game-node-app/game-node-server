import { StatisticsSourceType } from "../statistics.constants";
import { IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class FindOneStatisticsDto {
    @IsNotEmpty()
    @ApiProperty({
        oneOf: [{ type: "string" }, { type: "number" }],
    })
    sourceId: string | number;
    @IsNotEmpty()
    sourceType: StatisticsSourceType;
}
