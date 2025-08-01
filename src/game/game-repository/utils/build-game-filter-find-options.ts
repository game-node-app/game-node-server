import { GameRepositoryFilterDto } from "../dto/game-repository-filter.dto";
import { FindOptionsWhere, In } from "typeorm";
import { Game } from "../entities/game.entity";

const propertyEntities = ["category", "status"];

export function buildGameFilterFindOptions(
    dto?: GameRepositoryFilterDto,
): FindOptionsWhere<Game> {
    let options: FindOptionsWhere<Game> = {};
    if (dto == undefined) return options;
    for (const [key, value] of Object.entries(dto)) {
        if (propertyEntities.includes(key)) {
            const elements: number[] = Array.isArray(value) ? value : [value];

            options = {
                ...options,
                [key]: In(elements),
            };
            continue;
        }
        if (Array.isArray(value) && value.length > 0) {
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
