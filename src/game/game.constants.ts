/**
 * This SHOULD follow the order of the enum in the API
 * See: https://api-docs.igdb.com/#game-enums
 */
enum GameCategory {
    Main,
    DlcAddon,
    Expansion,
    Bundle,
    StandaloneExpansion,
    Mod,
    Episode,
    Season,
    Remake,
    Remaster,
    ExpandedGame,
    Port,
    Fork,
    Pack,
    Update,
}

enum GameExternalGameCategory {
    Steam = 0,
    Gog = 5,
    Youtube = 10,
    Microsoft = 11,
    Apple = 13,
    Twitch = 14,
    Android = 15,
    AmazonAsin = 20,
    AmazonLuna = 22,
    AmazonAdg = 23,
    EpicGamesStore = 26,
    Oculus = 28,
    Utomik = 29,
    ItchIo = 30,
    XboxMarketplace = 31,
    Kartridge = 32,
    PlaystationStoreUs = 36,
    FocusEntertainment = 37,
    XboxGamePassUltimateCloud = 54,
    Gamejolt = 55,
}

/**
 * This SHOULD follow the order of the enum in the API
 * See: https://api-docs.igdb.com/#game-enums
 */
enum GameStatus {
    Released,
    PLACEHOLDER_1,
    Alpha,
    Beta,
    EarlyAccess,
    Offline,
    Cancelled,
    Rumored,
    Delisted,
}

export { GameCategory, GameStatus };
