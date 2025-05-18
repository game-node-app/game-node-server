import {
    IsEnum,
    IsNotEmpty,
    IsNumber,
    IsString,
    IsUrl,
    MinLength,
} from "class-validator";
import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";

export class SubmitExternalGameDto {
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    sourceId: string;
    @IsNotEmpty()
    @IsUrl()
    sourceUrl: string;
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsNotEmpty()
    @IsEnum(EGameExternalGameCategory)
    category: EGameExternalGameCategory;
}
