import { OmitType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";

export class CreateUserPlaytimeDto extends OmitType(UserPlaytime, [
    "id",
    "profile",
    "game",
    "createdAt",
    "updatedAt",
    "externalGame",
]) {}
