import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { UserPlaytimeSource } from "../playtime.constants";

export class CreateUserPlaytimeDto extends OmitType(UserPlaytime, [
    "id",
    "profile",
    "game",
    "platform",
    "createdAt",
    "updatedAt",
    "totalPlayCount",
    "recentPlaytimeSeconds",
    "checksum",
]) {
    recentPlaytimeSeconds: number | undefined;
    totalPlayCount: number | undefined;
}

export class SubmitUserPlaytimeDto extends OmitType(CreateUserPlaytimeDto, [
    "profileUserId",
    "firstPlayedDate",
    "totalPlayCount",
    "recentPlaytimeSeconds",
]) {
    @ApiProperty({ type: "integer" })
    @IsInt()
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    gameId: number;

    @ApiProperty({ type: "integer" })
    @IsInt()
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    platformId: number;

    @IsEnum(UserPlaytimeSource)
    source: UserPlaytimeSource;

    @ApiProperty({ type: "integer" })
    @IsInt()
    @Min(0)
    @Max(2147483647)
    totalPlaytimeSeconds: number;

    @ApiPropertyOptional({ type: Date, nullable: true })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    lastPlayedDate: Date | null | undefined;
}
