import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import {
    GuildBoardCycle,
    GuildBonusObjectiveType,
    GuildCategory,
    GuildConsumableKey,
    GuildCriteria,
    GuildLocale,
    GuildObjectiveType,
    GuildRank,
} from "../guild.constants";
import { GuildRewardDescriptorDto } from "./guild-rewards.dto";

export class GetGuildBoardQueryDto {
    @ApiPropertyOptional({
        description:
            "Return only quick quests (rank D/E, short weekly quests or quick platform tasks), easiest first.",
        example: true,
    })
    @IsOptional()
    @Transform(({ value }) => value === true || value === "true")
    @IsBoolean()
    quick?: boolean;
}

export class GuildBoardCandidateGameDto {
    @ApiProperty({ example: 1029 })
    gameId: number;

    @ApiPropertyOptional({ example: "Hollow Knight" })
    name?: string;

    @ApiPropertyOptional({ example: "hollow-knight" })
    slug?: string;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        example:
            "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
    })
    coverUrl?: string | null;

    @ApiPropertyOptional({
        description: "Year the game entered the user's backlog",
        example: 2023,
    })
    sinceYear?: number;

    @ApiPropertyOptional({
        description: "Rounded cached time-to-beat, in hours",
        example: 6,
    })
    estimatedHours?: number;
}

export class GuildBoardEventTranslationDto {
    @ApiProperty({ enum: GuildLocale })
    locale: GuildLocale;

    @ApiProperty({ example: "Metroidvania Month" })
    title: string;

    @ApiProperty({ example: "Finish a Metroidvania this month." })
    description: string;
}

export class GuildBoardQuestMetaDto {
    @ApiPropertyOptional({ type: Number, nullable: true, example: 2023 })
    sinceYear?: number | null;

    @ApiPropertyOptional({ type: Number, nullable: true, example: 6 })
    estimatedHours?: number | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description: "Procedural genre name (off_the_map, genre_marathon)",
        example: "Metroidvania",
    })
    genreName?: string | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description: "Procedural franchise name (continue_the_saga)",
        example: "Hollow Knight",
    })
    franchiseName?: string | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description: "Procedural theme name (saga_trilogy theme branch)",
        example: "Fantasy",
    })
    themeName?: string | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description: "Release decade (time_machine)",
        example: "2010s",
    })
    decade?: string | null;

    @ApiPropertyOptional({
        type: Number,
        nullable: true,
        description: "Backlog age in days (recent_dust, forgotten_relic)",
        example: 420,
    })
    staleDays?: number | null;
}

/** Optional secondary objective; never blocks base completion (design 4). */
export class GuildBoardBonusObjectiveDto {
    @ApiProperty({
        enum: [
            "also_write_review",
            "finish_before_half_deadline",
            "use_stale_backlog_game",
        ],
    })
    type: GuildBonusObjectiveType;

    @ApiPropertyOptional({
        description: "Minimum plain-text review length (also_write_review)",
        example: 150,
    })
    minChars?: number;

    @ApiPropertyOptional({
        description: "Backlog age required from the target game",
        example: 180,
    })
    staleDays?: number;

    @ApiPropertyOptional({ example: 40 })
    bonusXp?: number;

    @ApiPropertyOptional({ example: 15 })
    bonusSeals?: number;

    @ApiPropertyOptional({
        description: "Upgrades the contract chest one tier on claim",
        example: false,
    })
    upgradeChestTier?: boolean;
}

export class GuildBoardQuestDto {
    @ApiProperty({ enum: ["board_entry", "event"] })
    sourceType: "board_entry" | "event";

    @ApiProperty({ type: String, nullable: true, example: null })
    boardEntryId: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    eventId: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "metroidvania-month",
    })
    slug: string | null;

    @ApiProperty({ enum: GuildCategory })
    category: GuildCategory;

    @ApiProperty({
        enum: GuildBoardCycle,
        nullable: true,
        description:
            "weekly for automatic board quests, monthly for expeditions, null for curated events",
    })
    cycle: GuildBoardCycle | null;

    @ApiProperty({
        type: String,
        nullable: true,
        description: "Stable system template key; clients localize the copy",
        example: "forgotten_relic",
    })
    templateKey: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    title: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    description: string | null;

    @ApiProperty({ type: () => GuildBoardEventTranslationDto, isArray: true })
    translations: GuildBoardEventTranslationDto[];

    @ApiProperty({ enum: GuildRank })
    rank: GuildRank;

    @ApiProperty({ example: 250 })
    xpReward: number;

    @ApiProperty({ example: 60 })
    sealsReward: number;

    @ApiProperty({ enum: GuildObjectiveType })
    objectiveType: GuildObjectiveType;

    @ApiProperty({ example: 1 })
    targetCount: number;

    @ApiProperty({ type: Object, example: {} })
    criteria: GuildCriteria;

    @ApiProperty({ type: () => GuildBoardCandidateGameDto, isArray: true })
    candidateGames: GuildBoardCandidateGameDto[];

    @ApiProperty({ type: () => GuildBoardQuestMetaDto, nullable: true })
    meta: GuildBoardQuestMetaDto | null;

    @ApiProperty({ type: () => GuildBoardBonusObjectiveDto, nullable: true })
    bonusObjective: GuildBoardBonusObjectiveDto | null;

    @ApiProperty({
        example: 0,
        description: "How many times this slot was rerolled this week",
    })
    rerollCount: number;

    @ApiProperty({ example: true })
    requiresTargetGame: boolean;

    @ApiProperty({ type: () => GuildRewardDescriptorDto, nullable: true })
    reward: GuildRewardDescriptorDto | null;

    @ApiProperty({ example: false })
    isRecommended: boolean;

    @ApiProperty({ example: true })
    isQuick: boolean;

    @ApiProperty({
        type: Number,
        nullable: true,
        description:
            "Days an accepted contract stays open; null for event quests",
        example: 21,
    })
    contractDurationDays: number | null;

    @ApiProperty({ type: Date, example: "2026-06-22T03:00:00.000Z" })
    expiresAt: Date;
}

export class GuildBoardResponseDto {
    @ApiProperty({
        description: "Monday of the board week in America/Sao_Paulo",
        example: "2026-06-15",
    })
    weekStart: string;

    @ApiProperty({
        type: Date,
        description: "Next Monday 00:00 America/Sao_Paulo, in UTC",
        example: "2026-06-22T03:00:00.000Z",
    })
    nextRefreshAt: Date;

    @ApiProperty({
        example: 1,
        description: "Free weekly rerolls left for the current São Paulo week",
    })
    rerollsRemaining: number;

    @ApiProperty({
        example: 0,
        description: "Owned `reroll_charter` consumables",
    })
    rerollChartersOwned: number;

    @ApiProperty({
        example: false,
        description:
            "True below Rank C, when the Monthly Expedition slot is not generated",
    })
    monthlyExpeditionLocked: boolean;

    @ApiProperty({ type: () => GuildBoardQuestDto, isArray: true })
    quests: GuildBoardQuestDto[];
}

/** Response of `POST /v1/guild/board/:entryId/reroll`. */
export class RerollGuildBoardEntryResponseDto {
    @ApiProperty({ type: () => GuildBoardQuestDto })
    quest: GuildBoardQuestDto;

    @ApiProperty({ example: 0 })
    rerollsRemaining: number;

    @ApiProperty({ example: 1 })
    rerollChartersOwned: number;

    @ApiProperty({
        enum: GuildConsumableKey,
        nullable: true,
        description:
            "Consumable spent by this reroll, if free rerolls were exhausted",
        example: "reroll_charter",
    })
    consumableUsed: GuildConsumableKey | null;
}
