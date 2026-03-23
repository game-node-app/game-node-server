export enum CollectionEntryStatus {
    PLAYING = "playing",
    FINISHED = "finished",
    PLANNED = "planned",
    DROPPED = "dropped",
    /**
     * For ongoing games.
     * Games in this category are always considered "playing", but this status is used for filtering.
     */
    ONGOING = "ongoing",
}
