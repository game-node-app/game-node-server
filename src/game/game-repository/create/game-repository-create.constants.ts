import { Game } from "../entities/game.entity";

export const MANY_TO_MANY_RELATIONS: (keyof Game)[] = [
    "dlcs",
    "expansions",
    "expandedGames",
    "similarGames",
    "remakes",
    "remasters",
    "gameModes",
    "genres",
    "themes",
    "platforms",
    "playerPerspectives",
    "gameEngines",
];
