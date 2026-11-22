import { ApiProperty } from "@nestjs/swagger";
import { GuildRank, LinaPose, LinaTrigger } from "../guild.constants";

export class GuildLicenseStatsDto {
    @ApiProperty({ description: "Games finished by the user" })
    finishedGames: number;

    @ApiProperty({ description: "Games currently planned in the backlog" })
    backlogGames: number;

    @ApiProperty({ description: "Reviews written by the user" })
    reviewsCount: number;
}

export class GuildLicenseDto {
    @ApiProperty() licenseNumber: number;
    @ApiProperty({ enum: GuildRank }) rank: GuildRank;
    @ApiProperty() xp: number;
    @ApiProperty() currentRankMinXp: number;
    @ApiProperty({ enum: GuildRank, nullable: true })
    nextRank: GuildRank | null;
    @ApiProperty({ nullable: true }) nextRankXp: number | null;
    @ApiProperty() xpToNextRank: number;
    @ApiProperty({ type: Date }) memberSince: Date;
    @ApiProperty({ nullable: true }) equippedTitleKey: string | null;
    @ApiProperty({ nullable: true }) equippedFrameKey: string | null;
    @ApiProperty({ type: GuildLicenseStatsDto }) stats: GuildLicenseStatsDto;
}

export class GuildYearGoalDto {
    @ApiProperty() year: number;
    @ApiProperty() target: number;
    @ApiProperty() finished: number;
}

export class LinaReceptionDto {
    @ApiProperty({ enum: LinaTrigger }) trigger: LinaTrigger;
    @ApiProperty({ enum: LinaPose }) pose: LinaPose;
    @ApiProperty({ type: Object }) context: Record<string, unknown>;
    @ApiProperty() hasUnseenBoard: boolean;
}

export class GuildBoardSeenResponseDto {
    @ApiProperty() hasUnseenBoard: boolean;
    @ApiProperty({ type: Date }) lastBoardSeenAt: Date;
}
