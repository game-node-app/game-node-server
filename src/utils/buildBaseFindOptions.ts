import { BaseFindDto } from "./base-find.dto";
import { FindManyOptions } from "typeorm";

/**
 * Shorthand function to build find many options based on the base find options dto.
 * PS: This is mostly used for pagination, and doesn't return a 'where' clause.
 * @param dto
 * @returns an empty object {} if dto is undefined.
 */
export function buildBaseFindOptions<T>(
    dto?: BaseFindDto<T>,
): FindManyOptions<T> {
    return {
        take: dto?.limit || 20,
        skip: dto?.offset || 0,
        order: dto?.orderBy,
    };
}
