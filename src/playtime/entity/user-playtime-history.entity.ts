import { Entity, Index } from "typeorm";
import { UserPlaytimeBase } from "./user-playtime-base.entity";

@Entity()
@Index("IDX_playtime_observation_window", [
    "profileUserId",
    "source",
    "platformId",
    "createdAt",
    "gameId",
    "totalPlaytimeSeconds",
])
@Index("IDX_playtime_observation_previous", [
    "profileUserId",
    "gameId",
    "source",
    "platformId",
    "createdAt",
    "id",
])
export class UserPlaytimeHistory extends UserPlaytimeBase {}
