import { Entity } from "typeorm";
import { UserPlaytimeBase } from "./user-playtime-base.entity";

@Entity()
export class UserPlaytimeHistory extends UserPlaytimeBase {}
