import { ApiPropertyOptional } from "@nestjs/swagger";

export class FindCollectionEntriesOrderBy {
    @ApiPropertyOptional({
        type: "string",
    })
    addedDate?: "ASC" | "DESC";
    @ApiPropertyOptional({
        type: "string",
    })
    releaseDate?: "ASC" | "DESC";
}
