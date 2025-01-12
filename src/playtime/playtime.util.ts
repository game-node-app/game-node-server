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

export function playtimeSourceToConnection(source: UserPlaytimeSource) {
    switch (source) {
        case UserPlaytimeSource.PSN:
            return EConnectionType.PSN;

        case UserPlaytimeSource.STEAM:
            return EConnectionType.STEAM;
    }
}
