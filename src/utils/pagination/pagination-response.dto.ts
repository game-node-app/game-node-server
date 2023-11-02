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

class PaginationInfoDto {
    total: number;
    totalPages: number;
    hasNextPage: boolean;
}

export class PaginationResponseDto<T> {
    @ApiProperty({
        type: {},
    })
    data: T[];
    pagination: PaginationInfoDto;
}

/**
 * This decorator is used to document paginated responses.
 * It's necessary because @nestjs/swagger doesn't generate documentation for generics in DTOs.
 * @param dataDto
 * @constructor
 */
export const ApiOkResponsePaginated = <DataDto extends Type<unknown>>(
    dataDto: DataDto,
) =>
    applyDecorators(
        ApiExtraModels(PaginationResponseDto, dataDto),
        ApiOkResponse({
            schema: {
                allOf: [
                    { $ref: getSchemaPath(PaginationResponseDto) },
                    {
                        properties: {
                            data: {
                                type: "array",
                                items: { $ref: getSchemaPath(dataDto) },
                            },
                        },
                    },
                ],
            },
        }),
    );
