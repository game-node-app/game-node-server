import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsOptional,
    IsString,
    Length,
} from "class-validator";
import {
    GuildConsumableKey,
    GuildChestTierKey,
    GuildRewardKind,
    GuildRewardRarity,
} from "../guild.constants";

export class GuildRewardDescriptorDto {
    @ApiProperty({ example: "ae5accd3-8e22-4aff-aa92-290b32e06cb4" })
    id: string;

    @ApiProperty({ example: "title_chronist" })
    key: string;

    @ApiProperty({ enum: GuildRewardKind })
    kind: GuildRewardKind;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "guild-archaeologist",
    })
    achievementId: string | null;

    @ApiProperty({ example: false })
    inChestPool: boolean;

    @ApiProperty({ example: 0 })
    chestBonusXp: number;

    @ApiProperty({ example: 0 })
    chestBonusSeals: number;

    @ApiProperty({ enum: GuildRewardRarity })
    rarity: GuildRewardRarity;

    @ApiProperty({
        enum: GuildConsumableKey,
        nullable: true,
        example: "hourglass",
    })
    consumableKey: GuildConsumableKey | null;
}

export class UserGuildRewardDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ type: () => GuildRewardDescriptorDto })
    reward: GuildRewardDescriptorDto;

    @ApiProperty({ type: String, nullable: true, example: null })
    sourceContractId: string | null;

    @ApiProperty({ example: "2026-11-21T12:00:00.000Z" })
    unlockedAt: Date;
}

export class GuildConsumableBalancesDto {
    @ApiProperty({ example: 1 }) hourglass: number;
    @ApiProperty({ example: 0 }) reroll_charter: number;
    @ApiProperty({ example: 0 }) extra_slot_permit: number;
}

export class GuildRewardsResponseDto {
    @ApiProperty({ type: () => UserGuildRewardDto, isArray: true })
    unlockedRewards: UserGuildRewardDto[];

    @ApiProperty({
        type: String,
        nullable: true,
        example: "title_chronist",
    })
    equippedTitleKey: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "frame_lantern_glow",
    })
    equippedFrameKey: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "license_obsidian_ledger",
    })
    equippedLicenseThemeKey: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "stamp_gold_seal",
    })
    equippedStampStyleKey: string | null;

    @ApiProperty({
        type: String,
        isArray: true,
        example: ["decor_sleeping_cat"],
    })
    equippedDecorKeys: string[];

    @ApiProperty({
        type: String,
        isArray: true,
        example: ["guild-archaeologist"],
    })
    showcaseBadgeIds: string[];

    @ApiProperty({ example: 75 })
    sealsBalance: number;

    @ApiProperty({ type: () => GuildConsumableBalancesDto })
    consumables: GuildConsumableBalancesDto;
}

export class UpdateGuildCosmeticsDto {
    // Omitted keeps the current title; null unequips it.
    @ApiPropertyOptional({
        type: String,
        nullable: true,
        maxLength: 64,
        example: "title_chronist",
    })
    @IsOptional()
    @IsString()
    @Length(1, 64)
    guildTitleKey?: string | null;

    // Omitted keeps the current frame; null unequips it.
    @ApiPropertyOptional({
        type: String,
        nullable: true,
        maxLength: 64,
        example: "frame_lantern_glow",
    })
    @IsOptional()
    @IsString()
    @Length(1, 64)
    guildFrameKey?: string | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        maxLength: 64,
        example: "license_obsidian_ledger",
    })
    @IsOptional()
    @IsString()
    @Length(1, 64)
    equippedLicenseThemeKey?: string | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        maxLength: 64,
        example: "stamp_gold_seal",
    })
    @IsOptional()
    @IsString()
    @Length(1, 64)
    equippedStampStyleKey?: string | null;

    // Omitted keeps Lina's counter decor; null unequips every piece.
    @ApiPropertyOptional({
        type: String,
        isArray: true,
        maxItems: 4,
        example: ["decor_sleeping_cat", "decor_tavern_lantern"],
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(4)
    @ArrayUnique()
    @IsString({ each: true })
    @Length(1, 64, { each: true })
    equippedDecorKeys?: string[] | null;

    // Omitted keeps the showcase; null empties it.
    @ApiPropertyOptional({
        type: String,
        isArray: true,
        maxItems: 3,
        example: ["guild-archaeologist"],
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(3)
    @ArrayUnique()
    @IsString({ each: true })
    @Length(1, 64, { each: true })
    showcaseBadgeIds?: string[] | null;
}

export class GuildCosmeticsResponseDto {
    @ApiProperty({
        type: String,
        nullable: true,
        example: "title_chronist",
    })
    guildTitleKey: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "frame_lantern_glow",
    })
    guildFrameKey: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "license_obsidian_ledger",
    })
    equippedLicenseThemeKey: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "stamp_gold_seal",
    })
    equippedStampStyleKey: string | null;

    @ApiProperty({ type: String, isArray: true })
    equippedDecorKeys: string[];

    @ApiProperty({ type: String, isArray: true })
    showcaseBadgeIds: string[];
}

export class GuildChestResultDto {
    @ApiProperty({ enum: GuildRewardKind })
    chestKind: GuildChestTierKey;

    @ApiProperty({ example: 75 })
    bonusXp: number;

    @ApiProperty({ example: 30 })
    bonusSeals: number;

    @ApiProperty({
        type: () => GuildRewardDescriptorDto,
        nullable: true,
        description: "Null when every active chest-pool cosmetic is owned.",
    })
    unlockedCosmetic: GuildRewardDescriptorDto | null;

    @ApiProperty({
        enum: GuildConsumableKey,
        nullable: true,
        description: "Deterministic Gold/Relic chest consumable drop, if any.",
    })
    grantedConsumable: GuildConsumableKey | null;
}
