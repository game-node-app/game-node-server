import { ApiPropertyOptional } from "@nestjs/swagger";

export class FindCollectionEntriesOrderBy {
    @ApiPropertyOptional({
        type: "string",
        enum: ["DESC", "ASC"],
    })
    addedDate?: "ASC" | "DESC";
    @ApiPropertyOptional({
        type: "string",
        enum: ["DESC", "ASC"],
    })
    releaseDate?: "ASC" | "DESC";
}
