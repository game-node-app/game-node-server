import { IsEnum, IsNotEmpty } from "class-validator";

export enum ProfileMetricsYearDistributionBy {
    RELEASE_YEAR = "release_year",
    FINISH_YEAR = "finish_year",
}

export class ProfileMetricsYearDistributionRequestDto {
    @IsNotEmpty()
    @IsEnum(ProfileMetricsYearDistributionBy)
    by: ProfileMetricsYearDistributionBy;
}

/**
 * Item representing the number of games + estimated playtime for a given year and month.
 */
export interface ProfileMetricsYearDistributionItem {
    year: number;
    count: number;
    /**
     * In seconds
     */
    totalEstimatedPlaytime: number;
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

export class ProfileMetricsYearDistributionResponseDto {
    distribution: ProfileMetricsYearDistributionItem[];
}
