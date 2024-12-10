import { Injectable } from "@nestjs/common";
import { GameRepositoryService } from "../game-repository/game-repository.service";

import { MATURE_THEME_ID } from "./game-filter.constants";

@Injectable()
export class GameFilterService {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    public async isMature(targetGameId: number) {
        const game = await this.gameRepositoryService.findOneById(
            targetGameId,
            {
                relations: {
                    themes: true,
                },
            },
        );

        return game.themes!.some((theme) => theme.id === MATURE_THEME_ID);
    }

    /**
     * Returns a list of gameIds with mature games removed.
     * @param gameIds
     */
    public async removeMature(gameIds: number[]) {
        const games = await this.gameRepositoryService.findAllByIds({
            gameIds: gameIds,
            relations: {
                themes: true,
            },
        });

        const matureGameIds = games
            .filter((game) => {
                if (game.themes == undefined) return true;
                return game.themes.some(
                    (theme) => theme.id === MATURE_THEME_ID,
                );
            })
            .map((game) => game.id);

        // Done this way to preserve ordering
        return gameIds.filter((id) => !matureGameIds.includes(id));
    }
}
