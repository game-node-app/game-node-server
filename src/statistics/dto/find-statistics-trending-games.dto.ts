import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { GameRepositoryFilterDto } from "../../game/game-repository/dto/game-repository-filter.dto";
import { IsOptional } from "class-validator";

export class FindStatisticsTrendingGamesDto extends BaseFindDto<Statistics> {
    @IsOptional()
    criteria?: GameRepositoryFilterDto;
}
