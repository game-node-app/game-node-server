export enum GameCoverKind {
    Localized = "localized",
    Edition = "edition",
    Alternative = "alternative",
    Historical = "historical",
}

/** IGDB cover, artwork and game IDs are separate sequences, so the origin qualifies `igdbId`. */
export enum GameCoverOrigin {
    Cover = "cover",
    Artwork = "artwork",
    Game = "game",
}

export enum CustomCoverMode {
    Any = "any",
    PreferYours = "prefer_yours",
    None = "none",
}
