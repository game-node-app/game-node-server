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
    Steam = 1,
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

/**
 * Where the game data is stored in the GameNode system.
 * Helps the clients determine the source of the data.
 */
enum EGameStorageSource {
    MYSQL = "MYSQL",
    MANTICORE = "MANTICORE",
}

/**
 * Look-up table that matches a icon file to a set of platform abbreviations. <br>
 * Check /public/icons for reference. <br>
 * Format: iconName: [platforms]
 */
const PlatformToIconMap: { [p: string]: string[] } = {
    windows: ["PC"],
    linux: ["Linux"],
    ps1: ["PS1"],
    ps2: ["PS2"],
    ps3: ["PS3"],
    ps4: ["PS4"],
    ps5: ["PS5"],
    psp: ["PSP"],
    psvita: ["Vita"],
    playstation: ["PSVR", "PSVR2"],
    x360: ["X360"],
    xone: ["XONE"],
    xseriesx: ["Series X"],
    xbox: ["XBOX"],
    nswitch: ["Switch"],
    n64: ["N64"],
    nwii: ["Wii"],
    nwiiu: ["WiiU"],
    nds: ["NDS", "3DS"],
    ngamecube: ["NGC"],
    nintendo: ["NES", "SNES"],
    sega: [
        "SMS",
        "segacd",
        "Sega32",
        "Saturn",
        "Genesis/Megadrive",
        "Game Gear",
    ],
    atari: ["Atari2600", "Atari7800", "Atari-ST", "Atari8bit", "Atari5200"],
    android: ["Android", "iOS"],
};

export {
    EGameCategory,
    EGameStatus,
    EGameExternalGameMedia,
    EGameExternalGameCategory,
    EGamePlatformCategory,
    EGameStorageSource,
    PlatformToIconMap,
};
