import { Game } from "./entities/game.entity";
import { GameExternalGame } from "../external-game/entity/game-external-game.entity";
import { DeepPartial } from "typeorm";

interface IGDBExternalGame extends GameExternalGame {
    // Substitute for deprecated field {@link GameExternalGame#category}
    externalGameSource?: number;
    // Substitute for deprecated field {@link GameExternalGame#media}
    gameReleaseFormat?: number;
}

/**
 * Items are received as snake_case from IGDB and converted to camelCase by
 * `normalizeIgdbGame` before they enter the transactional catalog importer.
 *
 */
export type IGDBPartialGame = DeepPartial<Game> & {
    id: number;
    externalGames: IGDBExternalGame[];
    /**
     * Substitute for deprecated field {@link Game#category}.
     */
    gameType: number;
    /**
     * Substitute for deprecated field {@link Game#status}.
     */
    gameStatus: number;
    [key: string]: any;
};
