import { IsEnum, IsNotEmpty } from "class-validator";

export enum ProfileStatisticsDistribution {
    RELEASE_YEAR = "release_year",
    FINISH_YEAR = "finish_year",
}

export class ProfileStatisticsDistributionRequestDto {
    @IsNotEmpty()
    @IsEnum(ProfileStatisticsDistribution)
    by: ProfileStatisticsDistribution;
}

/**
 * Relation between a year (presented as string) and data for said period.
 */
export interface ProfileStatisticsDistributionYearToData {
    [p: string]: {
        count: number;
        totalEstimatedPlaytime: number;
    };
}

export class ProfileStatisticsDistributionResponseDto {
    distribution: ProfileStatisticsDistributionYearToData;
}
