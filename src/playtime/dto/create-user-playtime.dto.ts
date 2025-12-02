import { OmitType } from "@nestjs/swagger";
import { UserPlaytime } from "../entity/user-playtime.entity";

export class CreateUserPlaytimeDto extends OmitType(UserPlaytime, [
    "id",
    "profile",
    "game",
    "platform",
    "createdAt",
    "updatedAt",
    "totalPlayCount",
    "recentPlaytimeSeconds",
    "checksum",
]) {
    recentPlaytimeSeconds: number | undefined;
    totalPlayCount: number | undefined;
}

export class SubmitUserPlaytimeDto extends OmitType(CreateUserPlaytimeDto, [
    "profileUserId",
    "firstPlayedDate",
    "totalPlayCount",
    "recentPlaytimeSeconds",
]) {}
