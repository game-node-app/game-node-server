import { IsBoolean } from "class-validator";

export class CollectionEntryFavoriteStatusDto {
    @IsBoolean()
    isFavorite: boolean = false;
}
