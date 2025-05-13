import { IsEnum, IsNotEmpty, IsOptional } from "class-validator";
import { PlaytimeFiterPeriod } from "../playtime.constants";
import { ApiProperty, PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import { ToBoolean } from "../../utils/toBoolean";

export class PlaytimeFilterOrderBy {
    @ApiProperty({
        type: "string",
    })
    lastPlayedDate?: "ASC" | "DESC";
    @ApiProperty({
        type: "string",
    })
    totalPlayCount?: "ASC" | "DESC";
    @ApiProperty({
        type: "string",
    })
    recentPlaytimeSeconds?: "ASC" | "DESC";
    @ApiProperty({
        type: "string",
    })
    totalPlaytimeSeconds?: "ASC" | "DESC";
}

export class FindAllPlaytimeFiltersDto extends PickType(BaseFindDto, [
    "limit",
    "offset",
]) {
    @IsNotEmpty()
    @IsEnum(PlaytimeFiterPeriod)
    period: PlaytimeFiterPeriod;
    @IsOptional()
    orderBy?: PlaytimeFilterOrderBy = {
        lastPlayedDate: "DESC",
    };
    /**
     * The source API's may return the lastPlayedDate as null.
     * This will change the default filtering to include items in period OR nullables.
     */
    @IsOptional()
    @ToBoolean()
    includeNullableLastPlayedDate = true;
}
