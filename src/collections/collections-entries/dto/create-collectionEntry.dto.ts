import { IsArray, IsNotEmpty, IsNumber, IsString } from "class-validator";
import { EGamePlatformIds } from "../../../game/game-repository/game-repository.constants";

export class CreateCollectionEntryDto {
    @IsNotEmpty()
    @IsString()
    collectionId: string;
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsArray()
    @IsNotEmpty()
    platformIds: EGamePlatformIds[];
}
