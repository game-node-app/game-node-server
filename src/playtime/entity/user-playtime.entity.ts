import { Entity, Unique } from "typeorm";
import { UserPlaytimeBase } from "./user-playtime-base.entity";

/**
 * User-provided playtime info. Generally obtained from syncing with third-party
 * stores like Steam and PSN.
 */
@Entity()
@Unique(["profile", "game", "source"])
export class UserPlaytime extends UserPlaytimeBase {}
