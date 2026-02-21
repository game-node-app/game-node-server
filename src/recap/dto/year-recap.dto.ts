import { YearRecap } from "../entity/year-recap.entity";
import { OmitType } from "@nestjs/swagger";
import { YearRecapPlayedGameDto } from "./year-recap-played-game.dto";
import { YearRecapPlatformCountDto } from "./year-recap-platform.dto";
import { ProfileMetricsTypeDistributionItem } from "../../profile/profile-metrics/dto/profile-metrics-type-distribution.dto";

export class YearRecapDto extends OmitType(YearRecap, ["playedGames"]) {
    playedGames: YearRecapPlayedGameDto[];
    /**
     * Map of platforms and the number of games played on each platform.
     * This is computed from the playedGames list.
     */
    playedGamesByPlatform: YearRecapPlatformCountDto[];
    distributionByGenre: ProfileMetricsTypeDistributionItem[];
    distributionByMode: ProfileMetricsTypeDistributionItem[];
    distributionByTheme: ProfileMetricsTypeDistributionItem[];
    distributionByPlatform: ProfileMetricsTypeDistributionItem[];
}
