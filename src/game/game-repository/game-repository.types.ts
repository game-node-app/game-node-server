import { DeepPartial } from "typeorm";
import { Game } from "./entities/game.entity";
import { PickType } from "@nestjs/swagger";

export type PartialGame = DeepPartial<Game> & {
    id: number;
    [key: string]: any;
};

export class GameSyncObject extends PickType(Game, [
    "id",
    "name",
    "status",
    "category",
    "createdAt",
    "updatedAt",
]) {}
