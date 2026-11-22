import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import {
    GuildCategory,
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

    @ApiProperty({ type: () => GuildBoardQuestDto, isArray: true })
    quests: GuildBoardQuestDto[];
}
