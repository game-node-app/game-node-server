import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class CreateCollectionEntryDto {
    @IsNotEmpty()
    @IsString()
    collectionId: string;
    @IsNotEmpty()
    @IsNumber()
    igdbId: number;
}
