import { IsArray, IsNotEmpty, IsNumber, IsString } from "class-validator";
import { DataSources } from "../../app.constants";

export class CreateCollectionEntryDto {
    @IsNotEmpty()
    @IsString()
    collectionId: string;
    @IsNotEmpty()
    @IsNumber()
    igdbId: number;
    @IsArray()
    @IsString({ each: true })
    dataSources: DataSources[];
}
