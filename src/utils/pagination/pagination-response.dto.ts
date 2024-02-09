import { ApiProperty } from "@nestjs/swagger";

/**
 * Type alias for data that can be paginated.
 * Basically, a tuple of an array of data and the total number of data (preferably the total count of items without query parameters applied). <br>
 * TypeOrm has a handy function (findAndCount) that returns this type of data.
 */
export type TPaginationData<T> = [T[], number];

export class PaginationInfo {
    @ApiProperty({
        type: "number",
        description: "Total number of items available for the current query",
    })
    totalItems: number;
    @ApiProperty({
        type: "number",
        description: "Total number of pages available for the current query",
    })
    totalPages: number;
    @ApiProperty({
        type: "boolean",
        description: "If this query allows for a next page",
    })
    hasNextPage: boolean;
}

export class PaginationResponseDto<T = any> {
    data: T[];
    pagination: PaginationInfo;
}
