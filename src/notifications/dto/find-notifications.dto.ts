import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

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
}
