import { OmitType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";

export class UserPlaytimeDto extends OmitType(UserPlaytime, [
    "game",
    "profile",
]) {}
