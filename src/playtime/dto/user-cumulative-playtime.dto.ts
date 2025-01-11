import { PickType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";

/**
 * Basically a DTO representing multiple {@link UserPlaytime} combined.
 */
export class UserCumulativePlaytimeDto extends PickType(UserPlaytime, [
    "totalPlaytimeSeconds",
    "totalPlayCount",
    "recentPlaytimeSeconds",
    "lastPlayedDate",
    "firstPlayedDate",
    "gameId",
    "profileUserId",
]) {}
