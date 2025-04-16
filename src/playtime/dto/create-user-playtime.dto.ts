import { OmitType, PickType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";

export class CreateUserPlaytimeDto extends OmitType(UserPlaytime, [
    "id",
    "profile",
    "game",
    "createdAt",
    "updatedAt",
    "recentPlaytimeSeconds",
]) {}

export class SubmitUserPlaytimeDto extends OmitType(CreateUserPlaytimeDto, [
    "profileUserId",
    "firstPlayedDate",
    "totalPlayCount",
]) {}
