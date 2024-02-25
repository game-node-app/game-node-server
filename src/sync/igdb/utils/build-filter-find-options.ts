import { GameRepositoryFilterDto } from "../../../game/game-repository/dto/game-repository-filter.dto";
import { FindManyOptions, FindOptionsWhere, In } from "typeorm";
import { Game } from "../../../game/game-repository/entities/game.entity";

const singleValueProperties = ["category", "status"];

export function buildFilterFindOptions(
    dto?: GameRepositoryFilterDto,
): FindOptionsWhere<Game> {
    let options: FindOptionsWhere<Game> = {};
    if (dto == undefined) return options;
    for (const [key, value] of Object.entries(dto)) {
        if (singleValueProperties.includes(key) && typeof value === "number") {
            options = {
                ...options,
                [key]: value,
            };
        } else if (Array.isArray(value) && value.length > 0) {
            options = {
                ...options,
                [key]: {
                    id: In(value),
                },
            };
        }
    }

    return options;
}
