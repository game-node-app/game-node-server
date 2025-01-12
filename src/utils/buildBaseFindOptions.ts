import { BaseFindDto } from "./base-find.dto";
import { FindManyOptions } from "typeorm";

interface BaseFindManyOptions<T> extends FindManyOptions<T> {
    take: number;
    skip: number;
}

/**
 * Shorthand function to build find many options based on the base find options dto.
 * PS: This is mostly used for pagination, and doesn't return a 'where' clause.
 * @param dto
 */
export function buildBaseFindOptions<T>(
    dto?: BaseFindDto<T>,
): BaseFindManyOptions<T> {
    return {
        take: dto?.limit || 20,
        skip: dto?.offset || 0,
        order: dto?.orderBy,
    };
}
