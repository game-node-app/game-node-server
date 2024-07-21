import { IsEnum, IsNotEmpty } from "class-validator";

export enum ProfileMetricsTypeDistributionBy {
    GENRE = "genre",
    CATEGORY = "category",
    /**
     * Single-player, multiplayer, etc
     */
    MODE = "mode",
    /**
     * PSN, Xbox, etc
     */
    PLATFORM = "platform",
}

export class ProfileMetricsTypeDistributionRequestDto {
    @IsNotEmpty()
    @IsEnum(ProfileMetricsTypeDistributionBy)
    by: ProfileMetricsTypeDistributionBy;
}

export class ProfileMetricsTypeDistributionItem {
    /**
     * Id of the criteria being used.
     * E.g. the id of a 'GameGenre' entity.
     */
    criteriaId: number;
    /**
     * Criteria being used as basis for this distribution.
     * E.g. The name of a 'GameGenre', the name of a Game's category (game, dlc, etc)
     */
    criteriaName: string;

    /**
     * Total number of times this criteria appears.
     * E.g. the number of games of 'adventure' genre a user has.
     */
    count: number;

    /**
     * Total number of items of this criteria that have been 'finished'.
     * E.g. finished 'adventure' genre games.
     */
    finishedCount: number;
}

export class ProfileMetricsTypeDistributionResponseDto {
    distribution: ProfileMetricsTypeDistributionItem[];
}
