import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty } from "class-validator";

/**
 * @nestjs/swagger only knows about properties of actual classes, so we need to redeclare the interface here.
 */
export class GameSearchRequestDto {
    @ApiProperty({
        description: "The index to search in",
        enum: ["gamenode"],
    })
    index = "gamenode" as const;
    @ApiProperty({
        description: "The query to search for",
    })
    query: object;
    fulltextFilter?: object;
    attrFilter?: object;
    limit?: number;
    offset?: number;
    maxMatches?: number;
    sort?: object[];
    aggs?: any[];
    expressions?: object[];
    highlight?: any;
    source?: {
        [key: string]: object;
    };
    profile?: boolean;
    trackScores?: boolean;
}
