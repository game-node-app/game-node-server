export enum EConnectionType {
    STEAM = "steam",
    PSN = "psn",
    XBOX = "xbox",
    EPIC_GAMES = "epicgames",
    NINTENDO = "nintendo",
    GOG = "gog",
}

export enum EConnectionAuthMode {
    REDIRECT = "redirect",
    PUBLIC_IDENTIFIER = "public_identifier",
    DELEGATED_CODE = "delegated_code",
}

export enum EConnectionAuthStatus {
    CONNECTED = "connected",
    REAUTH_REQUIRED = "reauth_required",
}

export const IMPORTER_VIABLE_CONNECTIONS = [
    EConnectionType.STEAM,
    EConnectionType.PSN,
    EConnectionType.XBOX,
    EConnectionType.EPIC_GAMES,
    EConnectionType.NINTENDO,
    EConnectionType.GOG,
];

export const IMPORTER_WATCH_VIABLE_CONNECTIONS = [
    EConnectionType.STEAM,
    EConnectionType.PSN,
    EConnectionType.XBOX,
    EConnectionType.EPIC_GAMES,
    EConnectionType.NINTENDO,
    EConnectionType.GOG,
];

export const PLAYTIME_IMPORT_VIABLE_CONNECTIONS: EConnectionType[] = [
    EConnectionType.STEAM,
    EConnectionType.PSN,
    EConnectionType.XBOX,
    EConnectionType.EPIC_GAMES,
    EConnectionType.NINTENDO,
    EConnectionType.GOG,
];

export const ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS: EConnectionType[] = [
    EConnectionType.GOG,
    EConnectionType.STEAM,
];
