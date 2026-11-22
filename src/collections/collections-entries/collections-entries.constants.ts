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

/** Where a status history row came from (design 11). */
export type CollectionEntryStatusHistorySource =
    | "manual"
    | "import"
    | "related"
    | "backfill";
