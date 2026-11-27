import { ApiProperty } from "@nestjs/swagger";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    Min,
} from "class-validator";

export class FindOwnCollectionEntriesByGameIdsDto {
    @ApiProperty({
        type: [Number],
        description: "Game ids to look up in the caller's library",
        minItems: 1,
        maxItems: 200,
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @IsInt({ each: true })
    @Min(1, { each: true })
    gameIds: number[];
}
