export enum CollectionEntryStatus {
    PLAYING = "playing",
    FINISHED = "finished",
    PLANNED = "planned",
    DROPPED = "dropped",
}

export const COLLECTION_ENTRY_ORDERING_GAP = 1000;

export const COLLECTION_ENTRY_ORDERING_NORMALIZATION_THRESHOLD = 1e-6;
