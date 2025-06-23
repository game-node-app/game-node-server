import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { ToBoolean } from "../../utils/toBoolean";
import { CollectionEntryStatus } from "../collections-entries/collections-entries.constants";
import { ApiProperty } from "@nestjs/swagger";

export class CreateCollectionDto {
    @IsString()
    @IsNotEmpty()
    name: string;
    @IsString()
    @IsOptional()
    description?: string;
    @IsOptional()
    @ToBoolean()
    isPublic?: boolean = true;
    @IsOptional()
    @ToBoolean()
    isFeatured?: boolean = false;
    @IsOptional()
    @IsString()
    @ApiProperty({
        type: "string",
    })
    defaultEntryStatus?: CollectionEntryStatus | null;
}
