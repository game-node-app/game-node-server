import { Injectable } from "@nestjs/common";
import { GameRepositoryCreateService } from "../../../game/game-repository/create/game-repository-create.service";
import { ensureGameStatistics } from "../../../statistics/statistics.service";
import { IGDBPartialGame } from "../../../game/game-repository/game-repository.types";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import {
    CatalogOwner,
    IgdbCatalogStateService,
} from "./igdb-catalog-state.service";

@Injectable()
export class IgdbCatalogImportService {
    constructor(
        private readonly games: GameRepositoryCreateService,
        private readonly state: IgdbCatalogStateService,
    ) {}
    async persist(
        game: IGDBPartialGame,
        owner: CatalogOwner,
        limiter: AsyncLeafLimiter,
        forceReconciliation: boolean,
    ) {
        await this.state.gameTransaction(owner, async (manager) => {
            await this.games.createOrUpdate(game, {
                manager,
                ownershipGuard: (transaction) =>
                    this.state.assertOwnership(transaction, owner),
                limiter,
                forceReconciliation,
                ensureStatistics: ensureGameStatistics,
            });
        });
    }
}
