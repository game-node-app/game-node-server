import { DeepPartial } from "typeorm";
import { Game } from "./entities/game.entity";
import { PickType } from "@nestjs/swagger";

export type PartialGame = DeepPartial<Game> & {
    id: number;
    [key: string]: any;
};
