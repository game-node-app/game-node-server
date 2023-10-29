import { CreateCollectionDto } from "./dto/create-collection.dto";

export const DEFAULT_COLLECTIONS: CreateCollectionDto[] = [
    {
        name: "Playing",
        description: "Games that i'm currently playing",
        isPublic: true,
    },
    {
        name: "Paused",
        description: "Games that i've put on hold for some time",
        isPublic: true,
    },
    {
        name: "Finished",
        description: "Games that i've finished",
        isPublic: true,
    },
    {
        name: "Wishlist",
        description: "Games that i want to play or buy",
        isPublic: true,
    },
    {
        name: "Dropped",
        description: "Games that i've have dropped",
        isPublic: true,
    },
    {
        name: "Favorites",
        description: "My favorite games",
        isPublic: true,
    },
];
