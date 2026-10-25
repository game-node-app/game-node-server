import { ApiProperty } from "@nestjs/swagger";

export class SearchPaginationInfoDto {
    @ApiProperty({
        type: Number,
        description: "Total number of items matching the search query and filters.",
    })
    totalItems: number;

    @ApiProperty({
        type: Number,
        description: "Total number of pages available for the effective limit.",
    })
    totalPages: number;

    @ApiProperty({
        type: Boolean,
        description: "Whether additional pages exist after the requested page.",
    })
    hasNextPage: boolean;
}
