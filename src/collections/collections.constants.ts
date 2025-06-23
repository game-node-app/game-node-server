import { CreateCollectionDto } from "./dto/create-collection.dto";
import { CollectionEntryStatus } from "./collections-entries/collections-entries.constants";

export const DEFAULT_COLLECTIONS: CreateCollectionDto[] = [
    {
        name: "Playing",
        description: "Games that i'm currently playing",
        isPublic: true,
        isFeatured: true,
        defaultEntryStatus: CollectionEntryStatus.PLAYING,
    },
    {
        name: "Finished",
        description: "Games that i've finished",
        isPublic: true,
        isFeatured: true,
        defaultEntryStatus: CollectionEntryStatus.FINISHED,
    },
    {
        name: "Wishlist",
        description: "Games that i want to play or buy",
        isPublic: true,
        isFeatured: false,
        defaultEntryStatus: CollectionEntryStatus.PLANNED,
    },
    {
        name: "Dropped",
        description: "Games that i've have abandoned",
        isPublic: true,
        isFeatured: false,
        defaultEntryStatus: CollectionEntryStatus.DROPPED,
    },
];
