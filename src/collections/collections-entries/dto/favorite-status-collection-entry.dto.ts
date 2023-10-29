import { IsBoolean } from "class-validator";

export class FavoriteStatusCollectionEntryDto {
    @IsBoolean()
    isFavorite: boolean = false;
}
