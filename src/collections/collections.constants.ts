import { CreateCollectionDto } from "./dto/create-collection.dto";

export const DEFAULT_COLLECTIONS: CreateCollectionDto[] = [
    {
        name: "Playing",
        description: "Games that i'm currently playing",
        isPublic: true,
        isFavoritesCollection: false,
    },
    {
        name: "Paused",
        description: "Games that i've put on hold for some time",
        isPublic: true,
        isFavoritesCollection: false,
    },
    {
        name: "Finished",
        description: "Games that i've finished",
        isPublic: true,
        isFavoritesCollection: false,
    },
    {
        name: "Wishlist",
        description: "Games that i want to play or buy",
        isPublic: true,
        isFavoritesCollection: false,
    },
    {
        name: "Dropped",
        description: "Games that you have dropped",
        isPublic: true,
        isFavoritesCollection: false,
    },
    {
        name: "Favorites",
        description: "Games that you have favorited",
        isPublic: true,
        isFavoritesCollection: true,
    },
];
