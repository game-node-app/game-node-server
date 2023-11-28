import { IsBoolean } from "class-validator";

export class CreateFavoriteStatusCollectionEntryDto {
    @IsBoolean()
    isFavorite: boolean = false;
}
