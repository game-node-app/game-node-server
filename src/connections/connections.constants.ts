export enum EConnectionType {
    STEAM = "steam",
    PSN = "psn",
}

export const IMPORTER_VIABLE_CONNECTIONS = [
    EConnectionType.STEAM,
    EConnectionType.PSN,
];

export const IMPORTER_WATCH_VIABLE_CONNECTIONS = [
    EConnectionType.STEAM,
    EConnectionType.PSN,
];

export const PLAYTIME_IMPORT_VIABLE_CONNECTIONS: EConnectionType[] = [
    EConnectionType.STEAM,
    EConnectionType.PSN,
];
