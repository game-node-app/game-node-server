import { EConnectionType } from "../connections.constants";

export class FindAvailableConnectionsResponseDto {
    name: string;
    type: EConnectionType;
    /**
     * If this connection can be used by the importer system to import games
     * e.g.: Steam, PSN
     */
    isImporterViable: boolean;
    /**
     * If this connection can be used by the importer watch system to periodically
     * check for new importable games
     * e.g.: Steam
     */
    isImporterWatchViable: boolean;
    isPlaytimeImportViable: boolean;
    iconName: string;
}
