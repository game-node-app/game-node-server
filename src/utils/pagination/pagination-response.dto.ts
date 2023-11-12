import {
    ApiExtraModels,
    ApiOkResponse,
    ApiProperty,
    getSchemaPath,
} from "@nestjs/swagger";
import { applyDecorators, Type } from "@nestjs/common";

/**
 * Type alias for paginable data.
 * Basically, a tuple of an array of data and the total number of data (preferably the total count of items without query parameters applied). <br>
 * TypeOrm has a handy function (findAndCount) that returns this type of data.
 */
export type TPaginationData<T> = [T[], number];

export class PaginationInfo {
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
}

export class PaginationResponseDto<T> {
    @ApiProperty({
        type: {},
    })
    data: T[];
    pagination: PaginationInfo;
}
