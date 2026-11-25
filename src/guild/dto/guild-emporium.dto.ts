import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsUUID,
    Min,
} from "class-validator";
import { GuildRank } from "../guild.constants";
import {
    GuildChestResultDto,
    GuildConsumableBalancesDto,
    GuildRewardDescriptorDto,
} from "./guild-rewards.dto";

export class GuildEmporiumListingDto {
    @ApiProperty({ example: "f2af7e19-b835-4311-89de-88148b57c07d" })
    id: string;

    @ApiProperty({ example: 120 })
    priceSeals: number;

    @ApiProperty({ enum: GuildRank })
    minRank: GuildRank;

    @ApiProperty({ example: false })
    isRotating: boolean;

    @ApiProperty({ type: () => GuildRewardDescriptorDto })
    reward: GuildRewardDescriptorDto;

    @ApiProperty({
        type: Number,
        nullable: true,
        example: null,
        description: "Null when the listing has no monthly purchase cap.",
    })
    maxPurchasesPerMonth: number | null;

    @ApiProperty({
        example: false,
        description:
            "Already unlocked permanently; repeatable rewards (consumables, chests) are never owned.",
    })
    owned: boolean;

    @ApiProperty({ example: 0 })
    purchasedThisMonth: number;

    @ApiProperty({
        example: true,
        description:
            "The buyer has the rank, the Seals and an open monthly purchase slot.",
    })
    canPurchase: boolean;
}

export class GuildEmporiumResponseDto {
    @ApiProperty({ example: 150 })
    sealsBalance: number;

    @ApiProperty({ example: "2026-11" })
    monthKey: string;

    @ApiProperty({ example: "2026-12-01T03:00:00.000Z" })
    nextRotationAt: Date;

    @ApiProperty({ type: () => GuildEmporiumListingDto, isArray: true })
    permanentItems: GuildEmporiumListingDto[];

    @ApiProperty({
        type: () => GuildEmporiumListingDto,
        isArray: true,
        description: "Up to 6 items, identical for every user in the month.",
    })
    rotatingItems: GuildEmporiumListingDto[];
}

export class PurchaseGuildEmporiumItemDto {
    @ApiProperty({ example: "f2af7e19-b835-4311-89de-88148b57c07d" })
    @IsUUID()
    emporiumItemId: string;
}

export class GuildEmporiumPurchaseResponseDto {
    @ApiProperty({ example: "f2af7e19-b835-4311-89de-88148b57c07d" })
    itemId: string;

    @ApiProperty({ example: 120 })
    priceSeals: number;

    @ApiProperty({ example: 30 })
    sealsBalance: number;

    @ApiProperty({ type: () => GuildRewardDescriptorDto })
    reward: GuildRewardDescriptorDto;

    @ApiProperty({ type: () => GuildChestResultDto, nullable: true })
    chestResult: GuildChestResultDto | null;

    @ApiProperty({ type: () => GuildConsumableBalancesDto })
    consumables: GuildConsumableBalancesDto;
}

export class GuildExtraSlotPermitStatusDto {
    @ApiProperty({ example: "2026-11-23" })
    weekStart: string;

    @ApiProperty({ example: true })
    activeThisWeek: boolean;

    @ApiProperty({ example: "2026-11-30T03:00:00.000Z" })
    expiresAt: Date;

    @ApiProperty({ example: 0 })
    remainingPermits: number;
}

export class CreateGuildEmporiumItemDto {
    @ApiProperty({ example: "0eb5197a-820b-488d-9147-84e3ed54b83a" })
    @IsUUID()
    rewardId: string;

    @ApiProperty({ example: 120, minimum: 1 })
    @IsInt()
    @Min(1)
    priceSeals: number;

    @ApiPropertyOptional({ enum: GuildRank, default: GuildRank.E })
    @IsOptional()
    @IsEnum(GuildRank)
    minRank?: GuildRank;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    isRotating?: boolean;

    @ApiPropertyOptional({
        type: Number,
        nullable: true,
        minimum: 1,
        example: null,
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    maxPurchasesPerMonth?: number | null;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateGuildEmporiumItemDto extends PartialType(
    CreateGuildEmporiumItemDto,
) {}

export class GuildAdminEmporiumItemResponseDto {
    @ApiProperty({ example: "f2af7e19-b835-4311-89de-88148b57c07d" })
    id: string;

    @ApiProperty({ type: () => GuildRewardDescriptorDto })
    reward: GuildRewardDescriptorDto;

    @ApiProperty({ example: 120 })
    priceSeals: number;

    @ApiProperty({ enum: GuildRank })
    minRank: GuildRank;

    @ApiProperty({ example: false })
    isRotating: boolean;

    @ApiProperty({ type: Number, nullable: true })
    maxPurchasesPerMonth: number | null;

    @ApiProperty({ example: true })
    isActive: boolean;

    @ApiProperty({ type: Date })
    createdAt: Date;

    @ApiProperty({ type: Date })
    updatedAt: Date;
}
