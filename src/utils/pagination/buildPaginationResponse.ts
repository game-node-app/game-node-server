import { BaseFindDto } from "../base-find.dto";
import {
    CursorPaginationResponseDto,
    PaginationInfo,
    PaginationResponseDto,
    TPaginationData,
} from "./pagination-response.dto";
import { mixin, Type } from "@nestjs/common";
import { ObjectLiteral } from "typeorm";
import { ApiProperty, ApiPropertyOptions } from "@nestjs/swagger";
import { BaseCursorFindDto } from "../base-cursor-find.dto";

/**
 * Builds pagination data from a 'paginable' data array and a DTO.
 * @param data
 * @param dto
 */
export function buildPaginationResponse<T>(
    data: TPaginationData<T>,
    dto?: BaseFindDto<T>,
): PaginationResponseDto<T> {
    // Best-effort runtime check to ensure that data is an array with two elements.
    if (
        Array.isArray(data) &&
        data.length === 2 &&
        typeof data[1] === "number"
    ) {
        const [results, total] = data;
        const limit = dto?.limit || 20;
        const offset = dto?.offset || 0;

        let totalPages = 1;
        if (total > 0) {
            totalPages = Math.ceil(total / limit);
        }
        const hasNextPage = offset + limit < total;
        return {
            data: results,
            pagination: {
                totalItems: total,
                totalPages,
                hasNextPage,
            },
        };
    }

    throw new Error(
        `Pagination data must be an tuple of an array and a number. 
        Got: ${JSON.stringify(data)} for DTO: ${JSON.stringify(dto)}`,
    );
}

export function buildCursorPaginationResponse<T>(
    data: TPaginationData<T>,
    dto?: BaseCursorFindDto,
): CursorPaginationResponseDto {
    // Best-effort runtime check to ensure that data is an array with two elements.
    if (Array.isArray(data) && data.length === 2) {
        const [results] = data;
        const limit = dto?.limit || 10;

        const hasNextPage = results.length === limit; // If we have fetched exactly `limit` records, there might be a next page
        return {
            data: results,
            pagination: {
                hasNextPage,
            },
        };
    }

    throw new Error(
        `Pagination data must be an tuple of an array and a number. 
        Got: ${JSON.stringify(data)} for DTO: ${JSON.stringify(dto)}`,
    );
}

/**
 * Shorthand mixin that receives a Typeorm entity and builds a DTO with pagination info associated.
 * @usage MyEntityDto extends withPaginationResponse(MyEntity)
 * @param Base
 * @param options
 */
export function withPaginationResponse<TBase extends Type<ObjectLiteral> = any>(
    Base: TBase,
    options?: ApiPropertyOptions,
) {
    class RedeclaredPaginationResponseDto {
        @ApiProperty({
            type: Base,
            isArray: true,
            ...options,
        })
        data: TBase[];
        pagination: PaginationInfo;
    }

    return mixin(RedeclaredPaginationResponseDto);
}
