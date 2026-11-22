import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";
import { GuildRewardKind } from "../guild.constants";

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
}

export class GuildChestResultDto {
    @ApiProperty({ example: 75 })
    bonusXp: number;

    @ApiProperty({
        type: () => GuildRewardDescriptorDto,
        nullable: true,
        description: "Null when every active chest-pool cosmetic is owned.",
    })
    unlockedCosmetic: GuildRewardDescriptorDto | null;
}
