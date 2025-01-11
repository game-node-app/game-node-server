export class ProfileMetricsOverviewDto {
    totalGames: number;
    totalCollections: number;
    totalFinishedGames: number;
    /**
     * Total playtime spent on finished games, based on available data import from user's connections.
     */
    totalEstimatedPlaytime: number;
}
