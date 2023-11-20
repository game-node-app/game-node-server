import { BaseFindDto } from "../base-find.dto";
import {
    PaginationInfo,
    PaginationResponseDto,
    TPaginationData,
} from "./pagination-response.dto";
import { mixin, Type } from "@nestjs/common";
import { ObjectLiteral } from "typeorm";
import { ApiProperty, ApiPropertyOptions } from "@nestjs/swagger";

/**
 * Builds pagination data from a 'paginable' data array and a DTO.
 * @param data
 * @param dto
 */
export default function buildPaginationResponse<T>(
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
        const limit = dto?.offset || 20;
        const offset = dto?.limit || 0;

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
    // Does nothing
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return data;
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
