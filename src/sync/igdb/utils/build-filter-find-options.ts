import { GameRepositoryFilterDto } from "../../../game/game-repository/dto/game-repository-filter.dto";
import { FindOptionsWhere, In } from "typeorm";
import { Game } from "../../../game/game-repository/entities/game.entity";

const singleValueProperties = ["category", "status"];

export function buildFilterFindOptions(
    dto?: GameRepositoryFilterDto,
): FindOptionsWhere<Game> {
    console.log("DTO: ", dto);
    let options: FindOptionsWhere<Game> = {};
    if (dto == undefined) return options;
    for (const [key, value] of Object.entries(dto)) {
        if (
            singleValueProperties.includes(key) &&
            typeof value === "number" &&
            !Number.isNaN(value)
        ) {
            options = {
                ...options,
                [key]: value,
            };
        } else if (Array.isArray(value) && value.length > 0) {
            const validElements: number[] = value.filter((v) => {
                return (
                    v != undefined && typeof v === "number" && !Number.isNaN(v)
                );
            });
            if (validElements.length === 0) continue;

            if (key === "ids") {
                options = {
                    ...options,
                    id: In(validElements),
                };
                continue;
            }

            options = {
                ...options,
                [key]: {
                    id: In(validElements),
                },
            };
        }
    }

    return options;
}
