import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDate,
    IsEnum,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, OmitType, PartialType } from "@nestjs/swagger";
import { AchievementCategory } from "../achievements.constants";

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+([-_][a-z0-9]+)*$/;

export class AchievementTierInputDto {
    @IsInt()
    @Min(1)
    threshold: number;
    @IsInt()
    @Min(0)
    @Max(5000)
    expReward: number;
}

export class AchievementIconDto {
    @IsIn(["glyph", "game_cover", "image"])
    kind: "glyph" | "game_cover" | "image";
    /**
     * Glyph name (kebab-case) or name of an existing icon in public/icons
     */
    @ValidateIf((icon) => icon.kind !== "game_cover")
    @IsString()
    @MaxLength(64)
    @Matches(SLUG)
    name?: string;
    @ValidateIf((icon) => icon.kind === "game_cover")
    @IsInt()
    @Min(1)
    gameId?: number;
}

export class CreateAchievementDefinitionDto {
    /**
     * Stable slug, also used as the achievement id
     */
    @IsString()
    @Length(3, 36)
    @Matches(SLUG)
    id: string;
    @IsString()
    @Length(1, 100)
    name: string;
    @IsString()
    @Length(1, 500)
    description: string;
    @IsEnum(AchievementCategory)
    @ApiProperty({ enum: AchievementCategory })
    category: AchievementCategory;
    /**
     * Key of a metric listed by GET /achievements/admin/metrics
     */
    @IsString()
    @IsNotEmpty()
    metric: string;
    @IsObject()
    @ApiProperty({ type: "object", additionalProperties: true })
    criteria: Record<string, any>;
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    startsAt?: Date | null;
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    endsAt?: Date | null;
    @IsOptional()
    @IsUUID()
    eventId?: string | null;
    @ValidateNested()
    @Type(() => AchievementIconDto)
    icon: AchievementIconDto;
    @IsOptional()
    @IsBoolean()
    isHidden?: boolean;
    /**
     * Tiers in ascending threshold order. After publishing, existing tiers must be resent unchanged and new ones appended.
     */
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => AchievementTierInputDto)
    tiers: AchievementTierInputDto[];
}

export class UpdateAchievementDefinitionDto extends PartialType(
    OmitType(CreateAchievementDefinitionDto, ["id"]),
) {}

export class CreateAchievementEventDto {
    @IsString()
    @Length(3, 64)
    @Matches(KEBAB_CASE)
    slug: string;
    @IsString()
    @Length(1, 100)
    name: string;
    @IsString()
    @Length(0, 500)
    description: string;
    @Type(() => Date)
    @IsDate()
    startsAt: Date;
    @Type(() => Date)
    @IsDate()
    endsAt: Date;
}

export class UpdateAchievementEventDto extends PartialType(
    CreateAchievementEventDto,
) {}

export class SimulateAchievementDefinitionDto {
    @IsString()
    @Length(36, 36)
    userId: string;
}

export class SimulateAchievementDefinitionResponseDto {
    value: number;
    /**
     * Tier levels the user would reach
     */
    levels: number[];
}

export class AchievementMetricDto {
    key: string;
    description: string;
    filters: string[];
    supportsWindow: boolean;
}
