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
 * Item representing the number of games + estimated playtime (if by = finished_year) for a given year.
 */
export interface ProfileMetricsYearDistributionItem {
    year: number;
    count: number;
    /**
     * In seconds. Only available for the "finish_year" criteria.
     */
    totalEstimatedPlaytime?: number;
}

/**
 * Relation between a year (presented as string) and data for said period.
 */
export interface ProfileMetricsDistributionYearToData {
    [p: string]: {
        count: number;
        totalEstimatedPlaytime?: number;
    };
}

export class ProfileMetricsYearDistributionResponseDto {
    distribution: ProfileMetricsYearDistributionItem[];
}
