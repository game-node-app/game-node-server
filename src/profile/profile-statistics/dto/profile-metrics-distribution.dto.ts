import { IsEnum, IsNotEmpty } from "class-validator";

export enum ProfileMetricsDistribution {
    RELEASE_YEAR = "release_year",
    FINISH_YEAR = "finish_year",
}

export class ProfileMetricsDistributionRequestDto {
    @IsNotEmpty()
    @IsEnum(ProfileMetricsDistribution)
    by: ProfileMetricsDistribution;
}

/**
 * Relation between a year (presented as string) and data for said period.
 */
export interface ProfileMetricsDistributionYearToData {
    [p: string]: {
        count: number;
        totalEstimatedPlaytime: number;
    };
}

export class ProfileMetricsDistributionResponseDto {
    distribution: ProfileMetricsDistributionYearToData;
}
