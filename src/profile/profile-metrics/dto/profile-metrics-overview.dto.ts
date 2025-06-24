export class ProfileMetricsOverviewDto {
    totalGames: number;
    totalCollections: number;
    totalFinishedGames: number;
    totalFinishedGamesInYear: number;
    totalPlayedGames: number;
    totalPlayedGamesInYear: number;
    totalPlannedGames: number;
    totalPlannedGamesInYear: number;
    /**
     * Total playtime spent on games, based on available data import from user's connections.
     */
    totalEstimatedPlaytime: number;
}
