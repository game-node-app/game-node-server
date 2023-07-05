import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class CreateCollectionEntryDto {
    @IsNotEmpty()
    @IsNumber()
    igdbId: number;
}
