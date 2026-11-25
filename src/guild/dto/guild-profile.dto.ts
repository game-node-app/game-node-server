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

export class GuildLicensePerksDto {
    @ApiProperty({
        example: 4,
        description:
            "Active contract cap, including an active weekly `extra_slot_permit`",
    })
    maxActiveContracts: number;

    @ApiProperty({ example: 1 }) weeklyRerolls: number;
    @ApiProperty({ example: true }) monthlyExpedition: boolean;
    @ApiProperty({ example: false }) monthlyExpeditionRankS: boolean;
    @ApiProperty({ example: 0 }) monthlyFreeHourglass: number;
    @ApiProperty({ example: false }) legendaryContracts: boolean;
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
    @ApiProperty({ example: 150 }) sealsBalance: number;
    @ApiProperty({ example: 1 }) prestigeLevel: number;
    @ApiProperty({ example: 800 }) prestigeXpIntoCurrent: number;
    @ApiProperty({ example: 1700 }) xpToNextPrestige: number;
    @ApiProperty({ type: () => GuildLicensePerksDto })
    perks: GuildLicensePerksDto;
    @ApiProperty({ nullable: true }) equippedLicenseThemeKey: string | null;
    @ApiProperty({ nullable: true }) equippedStampStyleKey: string | null;
    @ApiProperty({
        type: String,
        isArray: true,
        example: ["decor_sleeping_cat"],
    })
    equippedDecorKeys: string[];
    @ApiProperty({ type: String, isArray: true, example: [] })
    showcaseBadgeIds: string[];
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
