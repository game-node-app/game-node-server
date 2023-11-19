import { BaseFindDto } from "./base-find.dto";
import { FindManyOptions, FindOptionsOrder } from "typeorm";

/**
 * Shorthand function to build find many options based on the base find options dto.
 * PS: This is mostly used for pagination, and doesn't return a 'where' clause.
 * @param dto
 * @returns an empty object {} if dto is undefined.
 */
export function buildBaseFindOptions<T>(
    dto?: BaseFindDto<T>,
): FindManyOptions<T> {
    const findOptions: FindManyOptions<T> = {};

    findOptions.take = dto?.limit || 20;
    findOptions.skip = dto?.offset || 0;

    // TODO: Add multiple orderBy support
    if (dto?.orderBy) {
        findOptions.order = {
            [dto.orderBy]: dto.orderDirection || "DESC",
        } as FindOptionsOrder<T>;
    }

    if (dto?.relations) {
        findOptions.relations = dto.relations;
    }

    return findOptions;
}
