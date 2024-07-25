import { IsEnum, IsNotEmpty } from "class-validator";

export enum ProfileMetricsYearDistributionBy {
    RELEASE_YEAR = "release_year",
    FINISH_YEAR = "finish_year",
    // Playtime per year
    PLAYTIME = "playtime",
}

export class ProfileMetricsYearDistributionRequestDto {
    @IsNotEmpty()
    @IsEnum(ProfileMetricsYearDistributionBy)
    by: ProfileMetricsYearDistributionBy;
}

/**
 * Item representing the number of games + estimated playtime (if by = finished_year) for a given year.
 */
export class ProfileMetricsYearDistributionItem {
    year: number;
    count: number;
    /**
     * Number of items in period that have been reviewed. Not available to "playtime" criteria.
     */
    reviewedCount?: number;
}

export class ProfileMetricsYearDistributionResponseDto {
    distribution: ProfileMetricsYearDistributionItem[];
}
