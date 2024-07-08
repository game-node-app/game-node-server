export class ProfileStatisticsOverviewDto {
    totalGames: number;
    totalCollections: number;
    totalFinishedGames: number;
    /**
     * Total playtime spent on finished games, based on available data and HLTB's 'main' profile.
     */
    totalEstimatedPlaytime: number;
}
