import { Game } from "./entities/game.entity";
import { GameExternalGame } from "../external-game/entity/game-external-game.entity";
import { DeepPartial } from "typeorm";

interface IGDBExternalGame extends GameExternalGame {
    // Substitute for deprecated field GameExternalGame#category
    externalGameSource?: number;
    // Substitute for deprecated field GameExternalGame#media
    gameReleaseFormat?: number;
}

/**
 * Items are received as pascal_case from IGDB API, and then converted to camelCase.
 * Assume a camelCase option is available if `IgdbSyncProcessor#normalizeIgdbResults` has run.
 */
export type IGDBPartialGame = DeepPartial<Game> & {
    id: number;
    externalGames: IGDBExternalGame[];
    [key: string]: any;
};
