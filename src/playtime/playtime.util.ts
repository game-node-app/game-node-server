import { EConnectionType } from "../connections/connections.constants";
import { UserPlaytimeSource } from "./playtime.constants";

export function connectionToPlaytimeSource(connectionType: EConnectionType) {
    switch (connectionType) {
        case EConnectionType.PSN:
            return UserPlaytimeSource.PSN;
        case EConnectionType.STEAM:
            return UserPlaytimeSource.STEAM;
    }
}
