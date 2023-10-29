import {
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsNumber,
    IsString,
} from "class-validator";
import { EGamePlatformIds } from "../../../game/game-repository/game-repository.constants";

export class CreateCollectionEntryDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({ each: true })
    collectionIds: string[];
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsArray()
    @IsNotEmpty()
    @IsNumber({}, { each: true })
    platformIds: EGamePlatformIds[];
    @IsBoolean()
    isFavorite: boolean = false;
}
