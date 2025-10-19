import { EConnectionType } from "../connection/connections.constants";
import { EImporterSource } from "./importer.constants";

export const connectionToImporterSource = (connectionType: EConnectionType) => {
    switch (connectionType) {
        case EConnectionType.STEAM:
            return EImporterSource.STEAM;
        case EConnectionType.PSN:
            return EImporterSource.PSN;
        case EConnectionType.XBOX:
            return EImporterSource.XBOX;
    }
};

export const importerToConnectionSource = (
    source: EImporterSource,
): EConnectionType => {
    switch (source) {
        case EImporterSource.STEAM:
            return EConnectionType.STEAM;
        case EImporterSource.PSN:
            return EConnectionType.PSN;
        case EImporterSource.XBOX:
            return EConnectionType.XBOX;
    }
};
