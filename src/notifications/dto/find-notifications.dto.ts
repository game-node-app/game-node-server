import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { NotificationFilter } from "../notifications.types";

export class FindNotificationsDto {
    @ApiPropertyOptional({
        description: "Opaque cursor for pagination",
    })
    @IsOptional()
    @IsString()
    cursor?: string;

    @ApiPropertyOptional({
        description: "Page size limit between 1 and 100 (default 20)",
        default: 20,
        minimum: 1,
        maximum: 100,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @ApiPropertyOptional({
        description: "Filter notifications by read state",
        enum: ["all", "unread"],
        default: "all",
    })
    @IsOptional()
    @IsIn(["all", "unread"])
    filter?: NotificationFilter = "all";
}
