/**
 * This SHOULD follow the order of the enum in the API
 * See: https://api-docs.igdb.com/#game-enums
 */
enum EGameCategory {
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

enum EGameExternalGameCategory {
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

enum EGameExternalGameMedia {
    Digital = 1,
    Physical = 2,
}

enum EGamePlatformCategory {
    Console = 1,
    Arcade = 2,
    Platform = 3,
    OperatingSystem = 4,
    PortableConsole = 5,
    Computer = 6,
}

/**
 * This SHOULD follow the order of the enum in the API
 * See: https://api-docs.igdb.com/#game-enums
 */
enum EGameStatus {
    Released = 0,
    Alpha = 2,
    Beta = 3,
    EarlyAccess = 4,
    Offline = 5,
    Cancelled = 6,
    Rumored = 7,
    Delisted = 8,
}

// Quick access to the platform IDs
enum EGamePlatformIds {
    PC = 6,
    PS1 = 7,
    PS2 = 8,
    PS3 = 9,
    PS4 = 48,
    PS5 = 167,
    Xbox = 11,
    Xbox360 = 12,
    XboxOne = 49,
    XboxSeriesX = 169,
    NintendoSwitch = 130,
    Stadia = 170,
}

export {
    EGameCategory,
    EGameStatus,
    EGameExternalGameMedia,
    EGameExternalGameCategory,
    EGamePlatformCategory,
    EGamePlatformIds,
};
