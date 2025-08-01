import { EConnectionType } from "../connection/connections.constants";
import { UserPlaytimeSource } from "./playtime.constants";
import { UserCumulativePlaytimeDto } from "./dto/user-cumulative-playtime.dto";
import { UserPlaytime } from "./entity/user-playtime.entity";

export function connectionToPlaytimeImportSource(
    connectionType: EConnectionType,
) {
    switch (connectionType) {
        case EConnectionType.PSN:
            return UserPlaytimeSource.PSN;
        case EConnectionType.STEAM:
            return UserPlaytimeSource.STEAM;
        case EConnectionType.XBOX:
            return UserPlaytimeSource.XBOX;
    }
}

export const toCumulativePlaytime = (
    userId: string,
    gameId: number,
    userPlaytimes: UserPlaytime[],
): UserCumulativePlaytimeDto => {
    const cumulativePlaytime: UserCumulativePlaytimeDto = {
        profileUserId: userId,
        gameId: gameId,
        recentPlaytimeSeconds: 0,
        totalPlayCount: 0,
        totalPlaytimeSeconds: 0,
        lastPlayedDate: undefined,
        firstPlayedDate: undefined,
    };

    if (userPlaytimes == undefined || userPlaytimes.length === 0) {
        return cumulativePlaytime;
    }

    for (const userPlaytime of userPlaytimes) {
        cumulativePlaytime.recentPlaytimeSeconds +=
            userPlaytime.recentPlaytimeSeconds;
        cumulativePlaytime.totalPlaytimeSeconds +=
            userPlaytime.totalPlaytimeSeconds;
        cumulativePlaytime.totalPlayCount += userPlaytime.totalPlayCount;
        if (
            userPlaytime.firstPlayedDate != undefined &&
            (cumulativePlaytime.firstPlayedDate == undefined ||
                cumulativePlaytime.firstPlayedDate.getTime() <
                    userPlaytime.firstPlayedDate.getTime())
        ) {
            cumulativePlaytime.firstPlayedDate = userPlaytime.firstPlayedDate;
        }

        if (
            userPlaytime.lastPlayedDate != undefined &&
            (cumulativePlaytime.lastPlayedDate == undefined ||
                cumulativePlaytime.lastPlayedDate.getTime() <
                    userPlaytime.lastPlayedDate.getTime())
        ) {
            cumulativePlaytime.lastPlayedDate = userPlaytime.lastPlayedDate;
        }
    }

    return cumulativePlaytime;
};
