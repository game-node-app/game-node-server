import { Transform, Type } from "class-transformer";
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsUUID,
    isUUID,
    Matches,
    Max,
    Min,
    Validate,
    ValidateNested,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { StatisticsSourceType } from "../statistics.constants";
import { GameRepositoryFilterDto } from "../../game/game-repository/dto/game-repository-filter.dto";

export class GameRankingCriteriaDto extends OmitType(GameRepositoryFilterDto, [
    "limit",
    "offset",
] as const) {}

export enum StatisticsMetricCode {
    VIEWS = "views",
    LIKES_ADDED = "likes_added",
    LIKES_REMOVED = "likes_removed",
    LIKE_CREDIT = "like_credit",
}

export enum StatisticsGranularity {
    HOUR = "hour",
    DAY = "day",
}

export enum StatisticsRankingMode {
    POPULAR = "popular",
    RECENT = "recent",
}

@ValidatorConstraint({ name: "isStatisticsSourceId", async: false })
export class IsStatisticsSourceIdConstraint
    implements ValidatorConstraintInterface
{
    validate(value: unknown, args: any) {
        const sourceType = args.object?.sourceType as StatisticsSourceType;
        if (sourceType === StatisticsSourceType.GAME)
            return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
        return typeof value === "string" && isUUID(value);
    }

    defaultMessage() {
        return "sourceId must be a positive game number or a content UUID";
    }
}

function normalizeSourceId(value: unknown, sourceType: StatisticsSourceType) {
    if (
        sourceType !== StatisticsSourceType.GAME ||
        typeof value !== "string" ||
        !/^[1-9]\d*$/.test(value)
    )
        return value;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
}

export class StatisticsSourceRequestDto {
    @ApiProperty({ enum: StatisticsSourceType })
    @IsEnum(StatisticsSourceType)
    sourceType: StatisticsSourceType;

    @ApiProperty({ oneOf: [{ type: "string", format: "uuid" }, { type: "integer" }] })
    @Transform(({ value, obj }) => normalizeSourceId(value, obj.sourceType))
    @Validate(IsStatisticsSourceIdConstraint)
    sourceId: string | number;
}

export class StatisticsViewRequestDto extends StatisticsSourceRequestDto {
    @ApiProperty({ format: "uuid", description: "Reuse this identity for retries of one navigation impression." })
    @IsUUID()
    viewId: string;
}

function IsUtcInstant() {
    return Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
}

export class StatisticsSeriesRequestDto extends StatisticsSourceRequestDto {
    @ApiProperty({ enum: StatisticsMetricCode })
    @IsEnum(StatisticsMetricCode)
    metric: StatisticsMetricCode;

    @ApiProperty({ format: "date-time" })
    @IsDateString({ strict: true })
    @IsUtcInstant()
    from: string;

    @ApiProperty({ format: "date-time" })
    @IsDateString({ strict: true })
    @IsUtcInstant()
    to: string;

    @ApiProperty({ enum: StatisticsGranularity })
    @IsEnum(StatisticsGranularity)
    granularity: StatisticsGranularity;
}

export class StatisticsRankingsRequestDto {
    @ApiProperty({ enum: [StatisticsSourceType.GAME, StatisticsSourceType.REVIEW] })
    @IsIn([StatisticsSourceType.GAME, StatisticsSourceType.REVIEW])
    sourceType: StatisticsSourceType.GAME | StatisticsSourceType.REVIEW;

    @ApiPropertyOptional({ enum: StatisticsRankingMode, default: StatisticsRankingMode.POPULAR })
    @IsOptional()
    @IsEnum(StatisticsRankingMode)
    mode: StatisticsRankingMode = StatisticsRankingMode.POPULAR;

    @ApiPropertyOptional({ enum: ["day", "week", "month", "quarter", "half_year", "year", "all"] })
    @IsOptional()
    @IsIn(["day", "week", "month", "quarter", "half_year", "year", "all"])
    period?: string;

    @ApiPropertyOptional({ format: "date-time" })
    @IsOptional()
    @IsDateString({ strict: true })
    @IsUtcInstant()
    from?: string;

    @ApiPropertyOptional({ format: "date-time" })
    @IsOptional()
    @IsDateString({ strict: true })
    @IsUtcInstant()
    to?: string;

    @ApiPropertyOptional({ type: GameRankingCriteriaDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => GameRankingCriteriaDto)
    criteria?: GameRankingCriteriaDto;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    gameId?: number;

    @ApiPropertyOptional({ format: "uuid" })
    @IsOptional()
    @IsUUID()
    authorId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    excludeOwn?: boolean = false;

    @ApiPropertyOptional({ format: "uuid" })
    @IsOptional()
    @IsUUID()
    reviewId?: string;

    @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 20;

    @ApiPropertyOptional({ type: Number, default: 0, minimum: 0, maximum: 10000 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(10000)
    offset = 0;
}

export class StatisticsSummaryDto {
    @ApiProperty({ format: "date-time" })
    asOf: string;
    @ApiProperty({ enum: StatisticsSourceType })
    sourceType: StatisticsSourceType;
    @ApiProperty({ oneOf: [{ type: "string", format: "uuid" }, { type: "integer" }] })
    sourceId: string | number;
    @ApiProperty()
    viewsCount: number;
    @ApiProperty()
    likesCount: number;
    @ApiProperty()
    projectionLagSeconds: number;
    @ApiProperty()
    hasFailedEvents: boolean;
    @ApiProperty()
    historyComplete: boolean;
    @ApiProperty({ nullable: true, type: String })
    completeSince: string | null;
}

export class StatisticsStatusDto {
    @ApiProperty()
    isLiked: boolean;
    @ApiProperty()
    isViewed: boolean;
}

export class StatisticsViewResponseDto {
    @ApiProperty()
    accepted: boolean;
    @ApiProperty({ format: "uuid" })
    viewId: string;
}

export class StatisticsSeriesBucketDto {
    @ApiProperty({ format: "date-time" })
    start: string;
    @ApiProperty()
    value: number;
}

export class StatisticsSeriesDto {
    @ApiProperty({ format: "date-time" })
    asOf: string;
    @ApiProperty({ enum: StatisticsSourceType })
    sourceType: StatisticsSourceType;
    @ApiProperty({ oneOf: [{ type: "string", format: "uuid" }, { type: "integer" }] })
    sourceId: string | number;
    @ApiProperty({ enum: StatisticsMetricCode })
    metric: StatisticsMetricCode;
    @ApiProperty({ format: "date-time" })
    from: string;
    @ApiProperty({ format: "date-time" })
    to: string;
    @ApiProperty({ enum: StatisticsGranularity })
    granularity: StatisticsGranularity;
    @ApiProperty({ type: () => [StatisticsSeriesBucketDto] })
    buckets: Array<{ start: string; value: number }>;
    @ApiProperty()
    projectionLagSeconds: number;
    @ApiProperty()
    hasFailedEvents: boolean;
    @ApiProperty()
    historyComplete: boolean;
    @ApiProperty({ nullable: true, type: String })
    completeSince: string | null;
}

export class StatisticsRankingItemDto {
    @ApiProperty({ enum: [StatisticsSourceType.GAME, StatisticsSourceType.REVIEW] })
    sourceType: StatisticsSourceType.GAME | StatisticsSourceType.REVIEW;
    @ApiProperty({ oneOf: [{ type: "string", format: "uuid" }, { type: "integer" }] })
    sourceId: string | number;
    @ApiProperty()
    score: number;
    @ApiProperty()
    viewsCount: number;
    @ApiProperty()
    likesCount: number;
}

export class StatisticsRankingPaginationDto {
    @ApiProperty()
    total: number;
    @ApiProperty()
    limit: number;
    @ApiProperty()
    offset: number;
    @ApiProperty()
    hasNextPage: boolean;
}

export class StatisticsRankingResponseDto {
    @ApiProperty({ type: () => [StatisticsRankingItemDto] })
    items: StatisticsRankingItemDto[];
    @ApiProperty({ type: () => StatisticsRankingPaginationDto })
    pagination: StatisticsRankingPaginationDto;
    @ApiProperty({ enum: StatisticsRankingMode })
    mode: StatisticsRankingMode;
    @ApiProperty()
    definitionVersion: string;
    @ApiProperty({ format: "date-time" })
    asOf: string;
    @ApiProperty({ format: "date-time", nullable: true, type: String })
    effectiveFrom: string | null;
    @ApiProperty({ format: "date-time" })
    effectiveTo: string;
    @ApiProperty()
    projectionLagSeconds: number;
    @ApiProperty()
    hasFailedEvents: boolean;
    @ApiProperty()
    historyComplete: boolean;
    @ApiProperty({ nullable: true, type: String })
    completeSince: string | null;
}
