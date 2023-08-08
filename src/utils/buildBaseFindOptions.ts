import { BaseFindDto } from "./base-find.dto";
import { FindManyOptions, FindOptionsOrder } from "typeorm";

/**
 * Shorthand function to build find many options based on the base find options dto.
 *
 * @param dto
 * @returns an empty object {} if dto is undefined.
 */
export function buildBaseFindOptions<T>(dto?: BaseFindDto): FindManyOptions<T> {
    const findOptions: FindManyOptions<T> = {};

    if (dto?.limit) {
        findOptions.take = dto.limit;
    }
    if (dto?.offset) {
        findOptions.skip = dto.offset;
    }
    if (dto?.orderBy) {
        findOptions.order = {
            [dto.orderBy]: dto.orderDirection || "DESC",
        } as FindOptionsOrder<T>;
    }
    return findOptions;
}
