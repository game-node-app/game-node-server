import { DeepPartial } from "typeorm";
import { Game } from "./entities/game.entity";

export type PartialGame = DeepPartial<Game> & {
    id: number;
    [key: string]: any;
};
