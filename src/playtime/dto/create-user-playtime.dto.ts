import { OmitType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";

export class CreateUserPlaytimeDto extends OmitType(UserPlaytime, [
    "id",
    "profile",
    "game",
    "createdAt",
    "updatedAt",
    "totalPlayCount",
]) {
    totalPlayCount: number | undefined;
}

export class SubmitUserPlaytimeDto extends OmitType(CreateUserPlaytimeDto, [
    "profileUserId",
    "firstPlayedDate",
    "totalPlayCount",
    "recentPlaytimeSeconds",
]) {}
