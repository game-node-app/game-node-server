import { BaseFindDto } from "../../../utils/base-find.dto";
import { GameStatistics } from "../entity/game-statistics.entity";
import { PickType } from "@nestjs/swagger";

export class FindTrendingStatisticsDto extends PickType(
    BaseFindDto<GameStatistics>,
    ["limit", "relations"],
) {}
