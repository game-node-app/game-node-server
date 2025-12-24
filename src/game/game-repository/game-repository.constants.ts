/**
 * @see https://api-docs.igdb.com/#game-enums
 */
enum EGameCategory {
    Main = 0,
    DlcAddon = 1,
    Expansion = 2,
    Bundle = 3,
    StandaloneExpansion = 4,
    Mod = 5,
    Episode = 6,
    Season = 7,
    Remake = 8,
    Remaster = 9,
    ExpandedGame = 10,
    Port = 11,
    Fork = 12,
    Pack = 13,
    Update = 14,
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

export enum EGamePlatformCategory {
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
 * Common abbreviations used across the application for game platforms.
 * This enum is not exaustive. Prefer to query the database for the full list of platforms.
 * This should only be used to avoid magic strings in the codebase.
 */
enum GamePlatformAbbreviations {
    PC = "PC",
    // The OG Xbox.
    Xbox = "XBOX",
    XboxOne = "XONE",
    XboxSeriesXS = "Series X|S",
    Xbox360 = "X360",
    PSVita = "Vita",
    PS3 = "PS3",
    PS4 = "PS4",
    PS5 = "PS5",
    Switch = "Switch",
    Linux = "Linux",
    Android = "Android",
    iOS = "iOS",
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
    xseriesx: ["Series X|S"],
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
    EGameStorageSource,
    GamePlatformAbbreviations,
    PlatformToIconMap,
};
