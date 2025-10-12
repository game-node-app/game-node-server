import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CollectionEntryUpdateOrderingDto {
    @IsNotEmpty()
    @IsString()
    collectionId: string;
    @IsNotEmpty()
    @IsString()
    entryId: string;
    @IsOptional()
    @IsString()
    previousEntryId?: string;
    @IsOptional()
    @IsString()
    nextEntryId?: string;
}
