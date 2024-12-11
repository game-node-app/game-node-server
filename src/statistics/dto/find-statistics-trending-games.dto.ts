import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { GameRepositoryFilterDto } from "../../game/game-repository/dto/game-repository-filter.dto";
import { IsEnum, IsNotEmpty, IsOptional } from "class-validator";
import { StatisticsPeriod } from "../statistics.constants";
import { OmitType } from "@nestjs/swagger";
import { Transform } from "class-transformer";

export class FindStatisticsTrendingGamesDto extends OmitType(
    BaseFindDto<Statistics>,
    ["orderBy", "search"],
) {
    @IsOptional()
    @Transform(({ value }) => {
        const parsedCriteria: GameRepositoryFilterDto = {
            ...value,
            limit: undefined,
            offset: undefined,
        };

        return parsedCriteria;
    })
    criteria?: GameRepositoryFilterDto;
    @IsNotEmpty()
    @IsEnum(StatisticsPeriod)
    period: StatisticsPeriod;
}
