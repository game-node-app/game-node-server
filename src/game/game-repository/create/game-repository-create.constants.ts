import { Game } from "../entities/game.entity";
import { EntityTarget, ObjectLiteral } from "typeorm";
import { GameGenre } from "../entities/game-genre.entity";
import { GamePlatform } from "../entities/game-platform.entity";
import { GameTheme } from "../entities/game-theme.entity";
import { GameFranchise } from "../entities/game-franchise.entity";
import { GameEngine } from "../entities/game-engine.entity";
import { GameInvolvedCompany } from "../entities/game-involved-company.entity";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";
import { GameAlternativeName } from "../entities/game-alternative-name.entity";
import { GameArtwork } from "../entities/game-artwork.entity";
import { GameMode } from "../entities/game-mode.entity";
import { GamePlayerPerspective } from "../entities/game-player-perspective.entity";
import { GameKeyword } from "../entities/game-keyword.entity";
import { GameLocalization } from "../entities/game-localization.entity";
import { GameScreenshot } from "../entities/game-screenshot.entity";
import { GameCover } from "../entities/game-cover.entity";

/**
 * Look-up table between resource names and their respective entities
 * e.g.: Can be used to quickly retrieve the target repository for a resource
 */
export const GamePropertyPathToEntityMap: Partial<
    Record<keyof Game, EntityTarget<ObjectLiteral>>
> = {
    genres: GameGenre,
    platforms: GamePlatform,
    themes: GameTheme,
    franchises: GameFranchise,
    gameEngines: GameEngine,
    involvedCompanies: GameInvolvedCompany,
    externalGames: GameExternalGame,
    alternativeNames: GameAlternativeName,
    artworks: GameArtwork,
    gameModes: GameMode,
    playerPerspectives: GamePlayerPerspective,
    keywords: GameKeyword,
    gameLocalizations: GameLocalization,
    screenshots: GameScreenshot,
    cover: GameCover,
    // Self-referencing entities.
    dlcs: Game,
    expansions: Game,
    expandedGames: Game,
    similarGames: Game,
    remasters: Game,
    remakes: Game,
};

export type GameAllowedResource = keyof typeof GamePropertyPathToEntityMap;
