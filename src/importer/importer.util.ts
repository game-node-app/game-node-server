import { EConnectionType } from "../connections/connections.constants";
import { EImporterSource } from "./importer.constants";

export const connectionToImporterSource = (connectionType: EConnectionType) => {
    switch (connectionType) {
        case EConnectionType.STEAM:
            return EImporterSource.STEAM;
        case EConnectionType.PSN:
            return EImporterSource.PSN;
    }
};